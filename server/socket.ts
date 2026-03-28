import { Server as SocketIOServer } from "socket.io";
import { createServer } from "http";
import { db } from "./db";
import { hosts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "./auth";

// In-memory: hostUuid -> socketId
const onlineDevices = new Map<string, string>();

let _io: SocketIOServer | null = null;

const SOCKET_PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);

export function getSocketPort(): number {
  return SOCKET_PORT;
}

export function isDeviceOnline(hostUuid: string): boolean {
  return onlineDevices.has(hostUuid);
}

export function getOnlineDevices(): string[] {
  return Array.from(onlineDevices.keys());
}

/** Push an event to a specific device (by hostUuid). */
export function emitToDevice(hostUuid: string, event: string, data: unknown): void {
  _io?.of("/device").to(`device:${hostUuid}`).emit(event, data);
}

/** Broadcast an event to all connected admin panel sockets. */
export function emitToAdmins(event: string, data: unknown): void {
  _io?.of("/admin").emit(event, data);
}

/**
 * Start the standalone Socket.IO server on SOCKET_PORT (default 3001).
 * NOT attached to the admin Express server — runs as its own HTTP server.
 */
export function startSocketServer(): void {
  const socketHttp = createServer();

  const io = new SocketIOServer(socketHttp, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  _io = io;

  // ─── /device namespace ─────────────────────────────────────────────────────
  const deviceNs = io.of("/device");

  deviceNs.use(async (socket, next) => {
    const { hostUuid } = socket.handshake.auth as { hostUuid?: string };
    if (!hostUuid || hostUuid.length < 8 || hostUuid.length > 128) {
      return next(new Error("Invalid hostUuid"));
    }
    const [host] = await db
      .select({ platform: hosts.platform, version: hosts.version })
      .from(hosts)
      .where(eq(hosts.hostUuid, hostUuid))
      .limit(1);
    if (!host) return next(new Error("Unknown host"));
    socket.data.hostUuid = hostUuid;
    socket.data.platform = host.platform;
    socket.data.version = host.version;
    next();
  });

  deviceNs.on("connection", (socket) => {
    const hostUuid: string = socket.data.hostUuid;
    onlineDevices.set(hostUuid, socket.id);
    socket.join(`device:${hostUuid}`);

    console.log(`[socket] device online: ${hostUuid}`);

    io.of("/admin").emit("device:online", {
      hostUuid,
      platform: socket.data.platform,
      version: socket.data.version,
      connectedAt: new Date().toISOString(),
    });

    socket.on("support:message", async (data: { text: string }) => {
      try {
        const { storage } = await import("./storage");
        const message = await storage.addMessage(hostUuid, "device", data.text);
        io.of("/admin").emit("support:message", { hostUuid, message });
        socket.emit("support:message:ack", { messageId: message.id });
      } catch (err) {
        console.error("[socket] support:message error", err);
      }
    });

    socket.on("support:typing", (data: { isTyping: boolean }) => {
      io.of("/admin").emit("support:typing", { hostUuid, isTyping: data.isTyping });
    });

    socket.on("disconnect", () => {
      onlineDevices.delete(hostUuid);
      console.log(`[socket] device offline: ${hostUuid}`);
      io.of("/admin").emit("device:offline", {
        hostUuid,
        disconnectedAt: new Date().toISOString(),
      });
    });
  });

  // ─── /admin namespace ──────────────────────────────────────────────────────
  const adminNs = io.of("/admin");

  adminNs.use((socket, next) => {
    const { token: authToken } = socket.handshake.auth as { token?: string };
    const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "admin_session";
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...rest] = c.trim().split("=");
        return [k.trim(), rest.join("=")];
      }),
    );
    const token = authToken || cookies[ADMIN_COOKIE_NAME];
    if (!token) return next(new Error("Unauthorized"));
    const payload = verifyToken(token);
    if (!payload) return next(new Error("Unauthorized"));
    socket.data.adminId = payload.accountId;
    next();
  });

  adminNs.on("connection", (socket) => {
    console.log(`[socket] admin connected: ${socket.data.adminId}`);

    socket.emit("devices:online_list", { devices: getOnlineDevices() });

    // Track which device threads this admin socket has open (for cleanup on disconnect)
    socket.data.supportRooms = new Set<string>();

    socket.on("support:join", (data: { hostUuid: string }) => {
      socket.join(`support:${data.hostUuid}`);
      (socket.data.supportRooms as Set<string>).add(data.hostUuid);
      io.of("/device").to(`device:${data.hostUuid}`).emit("support:admin_joined", {
        adminId: socket.data.adminId,
      });
    });

    socket.on("support:leave", (data: { hostUuid: string }) => {
      socket.leave(`support:${data.hostUuid}`);
      (socket.data.supportRooms as Set<string>).delete(data.hostUuid);
      io.of("/device").to(`device:${data.hostUuid}`).emit("support:admin_left", {});
    });

    socket.on("support:typing", (data: { hostUuid: string; isTyping: boolean }) => {
      io.of("/device")
        .to(`device:${data.hostUuid}`)
        .emit("support:typing", { isTyping: data.isTyping });
    });

    socket.on("support:resolve", (data: { hostUuid: string }) => {
      io.of("/device").to(`device:${data.hostUuid}`).emit("support:resolved", {});
      socket.to(`support:${data.hostUuid}`).emit("support:resolved", { hostUuid: data.hostUuid });
      socket.emit("support:resolved:ack", { hostUuid: data.hostUuid });
    });

    socket.on("support:message", async (data: { hostUuid: string; text: string }) => {
      try {
        const { storage } = await import("./storage");
        const message = await storage.addMessage(data.hostUuid, "admin", data.text);
        io.of("/device").to(`device:${data.hostUuid}`).emit("support:message", { message });
        socket
          .to(`support:${data.hostUuid}`)
          .emit("support:message", { hostUuid: data.hostUuid, message });
        socket.emit("support:message:ack", { hostUuid: data.hostUuid, messageId: message.id });
      } catch (err) {
        console.error("[socket] admin support:message error", err);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[socket] admin disconnected: ${socket.data.adminId}`);
      // Auto-close any support threads this admin had open so devices go offline immediately
      const rooms = socket.data.supportRooms as Set<string>;
      if (rooms && rooms.size > 0) {
        for (const hostUuid of rooms) {
          io.of("/device").to(`device:${hostUuid}`).emit("support:admin_left", {});
          io.of("/device").to(`device:${hostUuid}`).emit("support:typing", { isTyping: false });
        }
      }
    });
  });

  socketHttp.listen(SOCKET_PORT, () => {
    console.log(`[socket] Standalone Socket.IO server running on port ${SOCKET_PORT}`);
  });
}
