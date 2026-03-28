/**
 * useAdminSocket.ts
 *
 * Connects the admin panel to the Socket.IO /admin namespace.
 * Provides real-time device online/offline status and support chat.
 *
 * Usage:
 *   const { onlineDevices, isDeviceOnline } = useAdminSocket(token);
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import type { SupportMessage } from "@shared/schema";

interface DeviceOnlineEvent {
  hostUuid: string;
  platform: string;
  version: string;
  connectedAt: string;
}

interface SupportMessageEvent {
  hostUuid: string;
  message: SupportMessage;
}

interface SupportTypingEvent {
  hostUuid: string;
  isTyping: boolean;
}

interface UseAdminSocketReturn {
  /** Set of hostUuids currently online */
  onlineDevices: Set<string>;
  isDeviceOnline: (hostUuid: string) => boolean;
  /** Join a support thread room to receive its messages in real-time */
  joinSupportThread: (hostUuid: string) => void;
  leaveSupportThread: (hostUuid: string) => void;
  sendSupportMessage: (hostUuid: string, text: string) => void;
  sendTypingIndicator: (hostUuid: string, isTyping: boolean) => void;
  /** Emit support:resolve so device gets real-time resolved notification */
  resolveThread: (hostUuid: string) => void;
  /** Per-thread typing state: hostUuid -> isTyping */
  typingDevices: Map<string, boolean>;
  connected: boolean;
}

let _socket: Socket | null = null;

/** Pass `enabled=false` to skip connecting (e.g. while auth is loading). */
export function useAdminSocket(enabled = true): UseAdminSocketReturn {
  const queryClient = useQueryClient();
  const [onlineDevices, setOnlineDevices] = useState<Set<string>>(new Set());
  const [typingDevices, setTypingDevices] = useState<Map<string, boolean>>(new Map());
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let isOwner = false;
    let socket: Socket;

    if (_socket && (_socket.connected || _socket.connecting)) {
      // Reuse the existing socket — but still register our own handlers below
      socket = _socket;
    } else {
      // Socket.IO runs on a standalone port (VITE_SOCKET_PORT, default 3001), separate from the Express server
      const socketPort = (import.meta.env.VITE_SOCKET_PORT as string) || "3001";
      const socketUrl = `${window.location.protocol}//${window.location.hostname}:${socketPort}`;
      socket = io(`${socketUrl}/admin`, {
        withCredentials: true,
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 2000,
      });
      _socket = socket;
      isOwner = true;
    }

    socketRef.current = socket;
    setConnected(socket.connected);

    // Named handlers so they can be cleanly removed on unmount
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onOnlineList = (data: { devices: string[] }) => {
      setOnlineDevices(new Set(data.devices));
    };

    const onDeviceOnline = (data: DeviceOnlineEvent) => {
      setOnlineDevices((prev) => new Set(Array.from(prev).concat(data.hostUuid)));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/hosts"] });
    };

    const onDeviceOffline = (data: { hostUuid: string }) => {
      setOnlineDevices((prev) => {
        const next = new Set(prev);
        next.delete(data.hostUuid);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/hosts"] });
    };

    const onSupportMessage = (data: SupportMessageEvent) => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", data.hostUuid] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support/threads"] });
    };

    const onSupportTyping = (data: SupportTypingEvent) => {
      setTypingDevices((prev) => {
        const next = new Map(prev);
        next.set(data.hostUuid, data.isTyping);
        return next;
      });
    };

    const onLicenseUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/hosts"] });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("devices:online_list", onOnlineList);
    socket.on("device:online", onDeviceOnline);
    socket.on("device:offline", onDeviceOffline);
    socket.on("support:message", onSupportMessage);
    socket.on("support:typing", onSupportTyping);
    socket.on("license:updated", onLicenseUpdated);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("devices:online_list", onOnlineList);
      socket.off("device:online", onDeviceOnline);
      socket.off("device:offline", onDeviceOffline);
      socket.off("support:message", onSupportMessage);
      socket.off("support:typing", onSupportTyping);
      socket.off("license:updated", onLicenseUpdated);
      // Only disconnect if this hook instance created the socket
      if (isOwner) {
        socket.disconnect();
        _socket = null;
      }
    };
  }, [enabled, queryClient]);

  const joinSupportThread = useCallback((hostUuid: string) => {
    socketRef.current?.emit("support:join", { hostUuid });
  }, []);

  const leaveSupportThread = useCallback((hostUuid: string) => {
    socketRef.current?.emit("support:leave", { hostUuid });
  }, []);

  const sendSupportMessage = useCallback((hostUuid: string, text: string) => {
    socketRef.current?.emit("support:message", { hostUuid, text });
  }, []);

  const sendTypingIndicator = useCallback((hostUuid: string, isTyping: boolean) => {
    socketRef.current?.emit("support:typing", { hostUuid, isTyping });
  }, []);

  const resolveThread = useCallback((hostUuid: string) => {
    socketRef.current?.emit("support:resolve", { hostUuid });
  }, []);

  const isDeviceOnline = useCallback(
    (hostUuid: string) => onlineDevices.has(hostUuid),
    [onlineDevices],
  );

  return {
    onlineDevices,
    isDeviceOnline,
    joinSupportThread,
    leaveSupportThread,
    sendSupportMessage,
    sendTypingIndicator,
    resolveThread,
    typingDevices,
    connected,
  };
}
