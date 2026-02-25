import type { Express } from "express";
import type { Server } from "http";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import {
  heartbeatPayloadSchema,
  logsBatchPayloadSchema,
  newMessagePayloadSchema,
  hostRegisterPayloadSchema,
  hostHeartbeatPayloadSchema,
  authRegisterSchema,
  authLoginSchema,
  licenseActivateSchema,
  usageReportSchema,
  signedLicensePayloadSchema,
} from "@shared/schema";
import { signToken, requireAuth, authRateLimit } from "./auth";
import { signLicense, verifyLicenseSignature } from "./license-sign";
import { sendLicenseGrantEmail } from "./mailer";
import Stripe from "stripe";
import { handleStripeWebhook } from "./stripe-webhook";
import { verifyRazorpaySignature, handleRazorpayWebhook } from "./razorpay-webhook";

const ADMIN_VERSION = "1.0.0";

/** Trial duration in days for first-time sign-in (configurable via TRIAL_DAYS env, default 7). */
const TRIAL_DAYS = Math.max(1, parseInt(process.env.TRIAL_DAYS || "7", 10) || 7);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // === EXISTING TELEMETRY ENDPOINTS (unchanged) ===
  
  // Telemetry Ingestion Endpoint
  app.post(api.telemetry.ingest.path, async (req, res) => {
    try {
      const payload = api.telemetry.ingest.input.parse(req.body);
      await storage.ingestTelemetry(payload);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error("Telemetry error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Admin Dashboard Stats Endpoint
  app.get(api.admin.stats.path, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (err) {
      console.error("Dashboard stats error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // CSV Export Endpoint
  app.get("/api/admin/export", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      const daily = stats.dailyActivity;
      
      const headers = ["Date", "Active Users", "Avg Uptime (Hours)", "Files Uploaded", "Files Downloaded", "Data Processed (Bytes)", "Shares Created"];
      const rows = daily.map(d => [
        d.date,
        d.activeUsers,
        d.avgUptimeHours.toFixed(2),
        d.filesUploaded,
        d.filesDownloaded,
        d.dataProcessedBytes,
        d.sharesCreated
      ]);

      const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=telemetry_export_${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csvContent);
    } catch (err) {
      console.error("Export error:", err);
      res.status(500).send("Export failed");
    }
  });

  // === PHASE 1: HOST REGISTRATION & HEARTBEAT ===

  // Host Registration
  app.post("/api/v1/hosts/register", async (req, res) => {
    try {
      const payload = hostRegisterPayloadSchema.parse(req.body);
      const host = await storage.registerHost(payload);
      console.log(`Host registered: ${payload.host_uuid} (${payload.platform}/${payload.arch})`);
      res.json({ status: "registered", server_time: Math.floor(Date.now() / 1000) });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error("Host registration error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Host Heartbeat
  app.post("/api/v1/hosts/heartbeat", async (req, res) => {
    try {
      const payload = hostHeartbeatPayloadSchema.parse(req.body);
      await storage.hostHeartbeat(payload);
      console.log(`Host heartbeat: ${payload.host_uuid} v${payload.version}`);
      res.status(200).json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error("Host heartbeat error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Admin: List all hosts (paginated, filterable, sortable)
  app.get("/api/admin/hosts", async (req, res) => {
    try {
      const filters = {
        platform: req.query.platform as string | undefined,
        version: req.query.version as string | undefined,
        sortBy: req.query.sortBy as string | undefined,
        sortOrder: req.query.sortOrder as string | undefined,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      };
      const result = await storage.getHosts(filters);
      res.json(result);
    } catch (err) {
      console.error("Hosts list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Admin: Get host filter options (distinct versions and platforms)
  app.get("/api/admin/hosts/filters", async (req, res) => {
    try {
      const result = await storage.getHosts({ limit: 1000 });
      const platforms = Array.from(new Set(result.hosts.map(h => h.platform))).sort();
      const versions = Array.from(new Set(result.hosts.map(h => h.version))).sort();
      res.json({ platforms, versions });
    } catch (err) {
      console.error("Hosts filters error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === PHASE 1: CONTROL PLANE ENDPOINTS ===

  // Health Check Endpoint
  app.get("/health", (req, res) => {
    res.json({
      reachable: true,
      serverTime: new Date().toISOString(),
      adminVersion: ADMIN_VERSION,
    });
  });

  // Heartbeat Endpoint
  app.post("/heartbeat", async (req, res) => {
    try {
      const payload = heartbeatPayloadSchema.parse(req.body);
      await storage.recordHeartbeat(payload);
      res.status(200).json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error("Heartbeat error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Device Registration (optional explicit endpoint, also happens on first telemetry/heartbeat)
  app.post("/install/register", async (req, res) => {
    try {
      const payload = heartbeatPayloadSchema.parse(req.body);
      await storage.recordHeartbeat(payload);
      const device = await storage.getDevice(payload.deviceUUID);
      res.status(200).json({ 
        success: true, 
        deviceIndex: device?.deviceIndex 
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error("Registration error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Get all devices (admin) with account email and license info
  app.get("/api/admin/devices", async (req, res) => {
    try {
      const devices = await storage.getDevicesWithAccountInfo();
      res.json(devices);
    } catch (err) {
      console.error("Devices list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Get single device
  app.get("/api/admin/devices/:deviceUUID", async (req, res) => {
    try {
      const device = await storage.getDevice(req.params.deviceUUID);
      if (!device) {
        res.status(404).json({ message: "Device not found" });
        return;
      }
      res.json(device);
    } catch (err) {
      console.error("Device fetch error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === SUPPORT MESSAGING ===

  // Get all support threads (admin)
  app.get("/api/admin/threads", async (req, res) => {
    try {
      const threads = await storage.getAllThreads();
      res.json(threads);
    } catch (err) {
      console.error("Threads list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Get messages for a device
  app.get("/api/messages/:deviceUUID", async (req, res) => {
    try {
      const thread = await storage.getThreadByDevice(req.params.deviceUUID);
      if (!thread) {
        res.json({ messages: [] });
        return;
      }
      res.json({ messages: thread.messages });
    } catch (err) {
      console.error("Messages fetch error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Send message to a device thread (admin reply or device message)
  app.post("/api/messages/:deviceUUID/reply", async (req, res) => {
    try {
      const payload = newMessagePayloadSchema.parse(req.body);
      const message = await storage.addMessage(
        req.params.deviceUUID, 
        payload.sender, 
        payload.text
      );
      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error("Message send error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // === LOGS INGESTION ===

  // Batch log ingestion
  app.post("/logs/batch", async (req, res) => {
    try {
      const payload = logsBatchPayloadSchema.parse(req.body);
      await storage.ingestLogs(payload);
      res.status(200).json({ success: true, count: payload.logs.length });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error("Logs ingestion error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // === UI RESTRUCTURE ENDPOINTS ===

  // User stats (per-user analytics)
  app.get("/api/admin/users/:deviceUUID/stats", async (req, res) => {
    try {
      const stats = await storage.getUserStats(req.params.deviceUUID);
      if (!stats) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json(stats);
    } catch (err) {
      console.error("User stats error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Leaderboard
  app.get("/api/admin/leaderboard", async (req, res) => {
    try {
      const leaderboard = await storage.getLeaderboard();
      res.json(leaderboard);
    } catch (err) {
      console.error("Leaderboard error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Support thread previews (inbox view)
  app.get("/api/admin/support/threads", async (req, res) => {
    try {
      const threads = await storage.getSupportThreadPreviews();
      res.json(threads);
    } catch (err) {
      console.error("Support threads error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Delete (resolve) a support thread — removes thread and all messages; device will see empty list on next fetch
  app.delete("/api/admin/support/threads/:deviceUUID", async (req, res) => {
    try {
      const deleted = await storage.deleteThreadByDevice(req.params.deviceUUID);
      if (!deleted) {
        res.status(404).json({ message: "Thread not found" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Support thread delete error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === CORS for joincloud-web (auth + account/summary) ===
  const setCors = (req: { headers: { origin?: string } }, res: { setHeader: (name: string, value: string) => void; sendStatus: (code: number) => void }) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  };
  app.options("/api/v1/auth/register", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/auth/login", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/auth/desktop-token", (req, res) => { setCors(req, res); res.sendStatus(204); });

  // === PHASE 2: AUTH ===
  app.post("/api/v1/auth/register", authRateLimit, async (req, res) => {
    setCors(req, res);
    try {
      const { email, password } = authRegisterSchema.parse(req.body);
      const existing = await storage.getAccountByEmail(email);
      if (existing) {
        res.status(400).json({ message: "Email already registered" });
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      const id = crypto.randomUUID();
      const account = await storage.createAccount(id, email, hash);
      const token = signToken({ accountId: account.id, email: account.email });
      res.status(201).json({
        user: { id: account.id, email: account.email },
        token,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
        return;
      }
      console.error("Register error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/v1/auth/login", authRateLimit, async (req, res) => {
    setCors(req, res);
    try {
      const { email, password } = authLoginSchema.parse(req.body);
      const account = await storage.getAccountByEmail(email);
      if (!account) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const passwordHash = storage.getPasswordHash(account.id);
      if (!passwordHash) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const ok = await bcrypt.compare(password, passwordHash);
      if (!ok) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const token = signToken({ accountId: account.id, email: account.email });
      res.json({
        user: { id: account.id, email: account.email },
        token,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
        return;
      }
      console.error("Login error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === DESKTOP AUTH: Website-to-Desktop deep-link login ===
  // In-memory store for one-time desktop auth tokens (60 s TTL).
  const desktopAuthTokens = new Map<string, { accountId: string; email: string; deviceId: string; expiresAt: number }>();

  app.post("/api/v1/auth/desktop-token", requireAuth, (req, res) => {
    setCors(req, res);
    try {
      const { deviceId } = z.object({ deviceId: z.string().min(1).max(256) }).parse(req.body);
      const auth = (req as any).auth as { accountId: string; email: string };
      const token = crypto.randomUUID();
      const expiresAt = Date.now() + 60_000;
      desktopAuthTokens.set(token, { accountId: auth.accountId, email: auth.email, deviceId, expiresAt });
      setTimeout(() => desktopAuthTokens.delete(token), 60_000);
      res.json({ token });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/desktop/verify", async (req, res) => {
    try {
      const { token } = z.object({ token: z.string().uuid() }).parse(req.body);
      const entry = desktopAuthTokens.get(token);
      if (!entry || entry.expiresAt < Date.now()) {
        desktopAuthTokens.delete(token);
        res.status(401).json({ message: "Invalid or expired desktop auth token" });
        return;
      }
      desktopAuthTokens.delete(token);
      const { accountId, email, deviceId } = entry;
      if (!deviceId || deviceId.length < 8 || deviceId.length > 128 || deviceId === "host") {
        res.status(400).json({ message: "Invalid device ID. Open JoinCloud on this computer and click Sign In from the app to get a valid link." });
        return;
      }
      await storage.ensureHostRow(deviceId);
      const account = await storage.getAccountById(accountId);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }

      let license = await storage.getLicenseForHost(deviceId);

      if (!license) {
        license = await storage.getActiveLicenseForAccount(accountId);

        if (!license && !account.trialUsed) {
          const now = Math.floor(Date.now() / 1000);
          const licenseId = `LIC-${Date.now()}-${accountId.slice(0, 8)}`;
          const payload = {
            license_id: licenseId,
            account_id: accountId,
            tier: "trial",
            device_limit: 5,
            issued_at: now,
            expires_at: now + TRIAL_DAYS * 24 * 3600,
            state: "trial_active",
            features: { smart_workspaces: true, activity_feed: true },
          };
          const signature = signLicense(payload);
          await storage.createLicense({
            id: licenseId,
            accountId,
            tier: "trial",
            deviceLimit: 5,
            issuedAt: now,
            expiresAt: payload.expires_at,
            state: "trial_active",
            signature,
          });
          await storage.setAccountTrialUsed(accountId);
          license = await storage.getLicenseById(licenseId);
        }

        if (license) {
          const hostCount = storage.getLicenseHostsCount(license.id);
          if (hostCount >= license.deviceLimit) {
            res.status(403).json({
              code: "DEVICE_LIMIT_REACHED",
              message: `Device limit reached (${license.deviceLimit} devices on this plan). Remove a device or upgrade.`,
            });
            return;
          }
          await storage.addLicenseHost(license.id, deviceId);
        }
      }

      const jwt = signToken({ accountId, email });
      const responsePayload: Record<string, unknown> = { jwt, accountId, email };
      if (license) {
        const signedLicense: Record<string, unknown> = {
          license_id: license.id,
          account_id: license.accountId,
          tier: license.tier,
          device_limit: license.deviceLimit,
          issued_at: license.issuedAt,
          expires_at: license.expiresAt,
          state: license.state,
          features: { smart_workspaces: true, activity_feed: true },
          signature: license.signature,
        };
        if (license.graceEndsAt != null) signedLicense.grace_ends_at = license.graceEndsAt;
        responsePayload.license = signedLicense;
      }
      res.json(responsePayload);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Desktop verify error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === PHASE 2: LICENSE (device-only activation, no email) ===
  app.post("/api/v1/license/activate-device", async (req, res) => {
    try {
      const { host_uuid } = z.object({ host_uuid: z.string().min(8).max(128) }).parse(req.body);
      await storage.ensureHostRow(host_uuid);

      const now = Math.floor(Date.now() / 1000);
      let license = await storage.getLicenseForHost(host_uuid);
      const inGrace = license?.state === "grace" && (license?.graceEndsAt != null && now <= (license.graceEndsAt ?? 0));
      const hasValidState = license && (license.state === "trial_active" || license.state === "active" || inGrace) && license.expiresAt > now;
      if (hasValidState && license) {
        await storage.addLicenseHost(license.id, host_uuid);
        const licenseRow = await storage.getLicenseById(license.id);
        const signedPayload: Record<string, unknown> = {
          license_id: licenseRow!.id,
          account_id: licenseRow!.accountId,
          tier: licenseRow!.tier,
          device_limit: licenseRow!.deviceLimit,
          issued_at: licenseRow!.issuedAt,
          expires_at: licenseRow!.expiresAt,
          state: licenseRow!.state,
          features: { smart_workspaces: true, activity_feed: true },
          signature: licenseRow!.signature,
        };
        if (licenseRow!.graceEndsAt != null) signedPayload.grace_ends_at = licenseRow!.graceEndsAt;
        res.json(signedPayload);
        return;
      }

      if (storage.isDeviceTrialUsed(host_uuid)) {
        res.status(403).json({
          code: "TRIAL_ALREADY_USED",
          message: "This device has already used its trial. Please upgrade to Pro.",
        });
        return;
      }

      await storage.ensureDeviceAccount(host_uuid);
      const licenseId = `LIC-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const issuedAt = now;
      const expiresAt = issuedAt + TRIAL_DAYS * 24 * 3600;
      const state = "trial_active";
      const payload = {
        license_id: licenseId,
        account_id: host_uuid,
        tier: "trial",
        device_limit: 5,
        issued_at: issuedAt,
        expires_at: expiresAt,
        state,
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.createLicense({
        id: licenseId,
        accountId: host_uuid,
        tier: payload.tier,
        deviceLimit: 5,
        issuedAt,
        expiresAt,
        state,
        signature,
      });
      await storage.addLicenseHost(licenseId, host_uuid);
      storage.setDeviceTrialUsed(host_uuid);
      license = await storage.getLicenseById(licenseId)!;
      const signedPayload: Record<string, unknown> = {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: license.expiresAt,
        state: license.state,
        features: { smart_workspaces: true, activity_feed: true },
        signature: license.signature,
      };
      if (license.graceEndsAt != null) signedPayload.grace_ends_at = license.graceEndsAt;
      res.json(signedPayload);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
        return;
      }
      console.error("License activate-device error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === PHASE 2: LICENSE (activate with auth – legacy/optional) ===
  app.post("/api/v1/license/activate", requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth as { accountId: string; email: string };
      const { host_uuid } = licenseActivateSchema.parse(req.body);

      await storage.ensureHostRow(host_uuid);

      let license = await storage.getActiveLicenseForAccount(auth.accountId);
      const account = await storage.getAccountById(auth.accountId);
      if (!account) {
        res.status(401).json({ message: "Account not found" });
        return;
      }

      if (!license) {
        if (!account.trialUsed) {
          const licenseId = `LIC-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
          const issuedAt = Math.floor(Date.now() / 1000);
          const expiresAt = issuedAt + TRIAL_DAYS * 24 * 3600;
          const state = "trial_active";
          const payload = {
            license_id: licenseId,
            account_id: auth.accountId,
            tier: "trial",
            device_limit: 5,
            issued_at: issuedAt,
            expires_at: expiresAt,
            state,
            features: { smart_workspaces: true, activity_feed: true },
          };
          const signature = signLicense(payload);
          await storage.createLicense({
            id: licenseId,
            accountId: auth.accountId,
            tier: payload.tier,
            deviceLimit: payload.device_limit,
            issuedAt,
            expiresAt,
            state,
            signature,
          });
          await storage.setAccountTrialUsed(auth.accountId);
          license = await storage.getLicenseById(licenseId);
        } else {
          res.status(403).json({
            code: "NO_LICENSE",
            message: "No active license. Please upgrade or purchase a license.",
          });
          return;
        }
      }

      if (!license) {
        res.status(403).json({ code: "NO_LICENSE", message: "No active license." });
        return;
      }

      const count = storage.getLicenseHostsCount(license.id);
      if (count >= license.deviceLimit) {
        res.status(403).json({
          code: "DEVICE_LIMIT_REACHED",
          message: "Device limit reached. Remove a device in the admin panel to add this one.",
        });
        return;
      }

      await storage.addLicenseHost(license.id, host_uuid);

      const licenseRow = await storage.getLicenseById(license.id);
      const signedPayload = {
        license_id: licenseRow!.id,
        account_id: licenseRow!.accountId,
        tier: licenseRow!.tier,
        device_limit: licenseRow!.deviceLimit,
        issued_at: licenseRow!.issuedAt,
        expires_at: licenseRow!.expiresAt,
        state: licenseRow!.state,
        features: { smart_workspaces: true, activity_feed: true },
        signature: licenseRow!.signature,
      };
      res.json(signedPayload);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
        return;
      }
      console.error("License activate error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/v1/license/validate", async (req, res) => {
    try {
      const body = z.object({
        license: signedLicensePayloadSchema,
        host_uuid: z.string().min(8).max(128),
      }).parse(req.body);
      const valid = verifyLicenseSignature(
        {
          license_id: body.license.license_id,
          account_id: body.license.account_id,
          tier: body.license.tier,
          device_limit: body.license.device_limit,
          issued_at: body.license.issued_at,
          expires_at: body.license.expires_at,
          state: body.license.state,
          grace_ends_at: body.license.grace_ends_at,
          features: body.license.features,
          custom_quota: body.license.custom_quota,
        },
        body.license.signature
      );
      if (!valid) {
        res.json({ valid: false, state: "REVOKED" });
        return;
      }
      const license = await storage.getLicenseById(body.license.license_id);
      if (!license) {
        res.json({ valid: false, state: "REVOKED" });
        return;
      }
      if (!storage.isHostInLicense(body.license.license_id, body.host_uuid)) {
        res.json({ valid: false, state: "REVOKED" });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      let state = license.state;
      if (license.expiresAt < now && state !== "revoked") state = "expired";
      const graceEndsAt = license.graceEndsAt ?? body.license.grace_ends_at;
      const inGrace = state === "grace" && graceEndsAt != null && now <= graceEndsAt;
      const isValid = state === "trial_active" || state === "active" || inGrace;
      const fullLicense = isValid ? {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: license.expiresAt,
        state: state === "grace" && inGrace ? "grace" : state,
        grace_ends_at: graceEndsAt ?? undefined,
        features: { smart_workspaces: true, activity_feed: true },
        signature: license.signature,
      } : null;
      res.json({
        valid: isValid,
        state: state === "grace" && !inGrace ? "expired" : state,
        expires_at: license.expiresAt,
        device_limit: license.deviceLimit,
        license: fullLicense,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
        return;
      }
      console.error("License validate error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === RAZORPAY WEBHOOK ===
  app.post("/api/v1/webhooks/razorpay", async (req, res) => {
    const rawBody = (req as any).rawBody;
    const sig = req.headers["x-razorpay-signature"] as string | undefined;
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!rawBody || !sig || !secret) {
      res.status(400).json({ message: "Missing raw body, signature, or RAZORPAY_WEBHOOK_SECRET" });
      return;
    }
    const bodyStr = typeof rawBody === "string" ? rawBody : (rawBody as Buffer).toString("utf8");
    if (!verifyRazorpaySignature(bodyStr, sig, secret)) {
      res.status(400).json({ message: "Webhook signature verification failed" });
      return;
    }
    try {
      const event = JSON.parse(bodyStr);
      await handleRazorpayWebhook(event);
      res.json({ received: true });
    } catch (err: any) {
      console.error("Razorpay webhook error:", err?.message ?? err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Manual Razorpay payment verification (called from joincloud-web after checkout)
  app.post("/api/v1/webhooks/razorpay-manual", async (req, res) => {
    try {
      const { razorpay_payment_id, razorpay_order_id, razorpay_signature, account_id, device_id, plan, device_limit } = req.body as Record<string, string>;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      if (!secret) {
        res.status(503).json({ message: "Razorpay not configured" });
        return;
      }
      const expected = crypto.createHmac("sha256", secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");
      const valid = (() => {
        try { return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(razorpay_signature ?? "", "hex")); }
        catch { return false; }
      })();
      if (!valid) {
        res.status(400).json({ message: "Payment signature verification failed" });
        return;
      }
      if (!account_id) {
        res.status(400).json({ message: "account_id required" });
        return;
      }
      const account = await storage.getAccountById(account_id);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      const proLimit = parseInt(process.env.JOINCLOUD_PRO_DEVICE_LIMIT ?? "5", 10);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 30 * 24 * 3600;
      let license = await storage.getActiveLicenseForAccount(account_id);
      const licenseId = license?.id ?? `LIC-${Date.now()}-${razorpay_payment_id.slice(-8)}`;
      const tierName = plan ?? "pro";
      const limit = device_limit ? Math.max(1, parseInt(device_limit, 10) || proLimit) : proLimit;
      const payload = {
        license_id: licenseId,
        account_id,
        tier: tierName,
        device_limit: limit,
        issued_at: license?.issuedAt ?? now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const { signLicense } = await import("./license-sign");
      const signature = signLicense(payload);
      if (!license) {
        await storage.createLicense({ id: licenseId, accountId: account_id, tier: tierName, deviceLimit: limit, issuedAt: now, expiresAt, state: "active", signature, planInterval: "monthly" });
      } else {
        await storage.updateLicense(licenseId, { state: "active", expiresAt, signature, deviceLimit: limit, tier: tierName });
      }
      res.json({ success: true, license_id: licenseId });
    } catch (err) {
      console.error("Razorpay manual verify error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === PHASE 3: STRIPE WEBHOOK ===
  app.post("/api/v1/webhooks/stripe", async (req, res) => {
    const rawBody = (req as any).rawBody;
    const sig = req.headers["stripe-signature"] as string | undefined;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!rawBody || !sig || !secret) {
      res.status(400).json({ message: "Missing raw body, signature, or STRIPE_WEBHOOK_SECRET" });
      return;
    }
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
      const event = stripe.webhooks.constructEvent(
        typeof rawBody === "string" ? rawBody : (rawBody as Buffer).toString("utf8"),
        sig,
        secret
      );
      await handleStripeWebhook(event);
      res.json({ received: true });
    } catch (err: any) {
      console.error("Stripe webhook error:", err?.message ?? err);
      res.status(400).json({ message: "Webhook signature verification failed" });
    }
  });

  // === PHASE 2: USAGE REPORT ===
  app.post("/api/v1/usage/report", async (req, res) => {
    try {
      const { host_uuid, aggregates } = usageReportSchema.parse(req.body);
      await storage.reportUsageAggregates(host_uuid, aggregates);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
        return;
      }
      console.error("Usage report error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === PHASE 2: ADMIN (accounts, licenses, usage aggregates, revoke, extend) ===
  app.get("/api/admin/accounts", async (req, res) => {
    try {
      const accounts = await storage.listAccounts();
      res.json(accounts);
    } catch (err) {
      console.error("Accounts list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/admin/licenses", async (req, res) => {
    try {
      const licenses = await storage.listLicensesWithHostCounts();
      const withEmail = await Promise.all(
        licenses.map(async (l) => {
          const account = await storage.getAccountById(l.accountId);
          return { ...l, accountEmail: account?.email ?? null };
        })
      );
      res.json(withEmail);
    } catch (err) {
      console.error("Licenses list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/admin/usage-aggregates", async (req, res) => {
    try {
      const hostUuid = req.query.host_uuid as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const aggregates = await storage.getUsageAggregates({ hostUuid, limit });
      res.json(aggregates);
    } catch (err) {
      console.error("Usage aggregates error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/grant", async (req, res) => {
    try {
      const body = z.object({
        email: z.string().email(),
        tier: z.enum(["pro", "teams"]),
      }).parse(req.body);
      let account = await storage.getAccountByEmail(body.email);
      if (!account) {
        const id = crypto.randomUUID();
        await storage.createAccount(id, body.email, ".");
        account = await storage.getAccountById(id);
        if (!account) {
          res.status(500).json({ message: "Failed to create account" });
          return;
        }
      }
      const existingLicense = await storage.getActiveLicenseForAccount(account.id);
      if (existingLicense) {
        res.status(200).json({
          alreadyHasLicense: true,
          licenseId: existingLicense.id,
          tier: existingLicense.tier,
          expiresAt: existingLicense.expiresAt,
        });
        return;
      }
      const deviceLimit = body.tier === "teams" ? 5 : 5;
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 365 * 24 * 3600;
      const licenseId = `LIC-${Date.now()}-${account.id.slice(0, 8)}`;
      const payload = {
        license_id: licenseId,
        account_id: account.id,
        tier: body.tier,
        device_limit: deviceLimit,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.createLicense({
        id: licenseId,
        accountId: account.id,
        tier: body.tier,
        deviceLimit,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
      });
      sendLicenseGrantEmail({ to: account.email, tier: body.tier, licenseId, deviceLimit, expiresAt }).catch(() => {});
      res.status(201).json({ success: true, licenseId, accountId: account.id, email: account.email });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Grant license error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/grant-replace", async (req, res) => {
    try {
      const body = z.object({
        email: z.string().email(),
        tier: z.enum(["pro", "teams"]),
      }).parse(req.body);
      const account = await storage.getAccountByEmail(body.email);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      const deviceLimit = body.tier === "teams" ? 5 : 5;
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 365 * 24 * 3600;
      const existingLicense = await storage.getActiveLicenseForAccount(account.id);
      if (existingLicense) {
        const payload = {
          license_id: existingLicense.id,
          account_id: existingLicense.accountId,
          tier: body.tier,
          device_limit: deviceLimit,
          issued_at: existingLicense.issuedAt,
          expires_at: expiresAt,
          state: "active",
          features: { smart_workspaces: true, activity_feed: true },
        };
        const signature = signLicense(payload);
        await storage.updateLicense(existingLicense.id, { tier: body.tier, deviceLimit, expiresAt, signature });
        sendLicenseGrantEmail({ to: account.email, tier: body.tier, licenseId: existingLicense.id, deviceLimit, expiresAt }).catch(() => {});
        res.status(200).json({ success: true, updated: true, licenseId: existingLicense.id, accountId: account.id, email: account.email });
        return;
      }
      const licenseId = `LIC-${Date.now()}-${account.id.slice(0, 8)}`;
      const payload = {
        license_id: licenseId,
        account_id: account.id,
        tier: body.tier,
        device_limit: deviceLimit,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.createLicense({
        id: licenseId,
        accountId: account.id,
        tier: body.tier,
        deviceLimit,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
      });
      sendLicenseGrantEmail({ to: account.email, tier: body.tier, licenseId, deviceLimit, expiresAt }).catch(() => {});
      res.status(201).json({ success: true, licenseId, accountId: account.id, email: account.email });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Grant-replace license error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/grant-custom", async (req, res) => {
    try {
      const body = z.object({
        email: z.string().email(),
        usersOrStorage: z.number().int().min(1).max(1000),
        pairingDevices: z.number().int().min(1).max(100),
      }).parse(req.body);
      let account = await storage.getAccountByEmail(body.email);
      if (!account) {
        const id = crypto.randomUUID();
        await storage.createAccount(id, body.email, ".");
        account = await storage.getAccountById(id);
        if (!account) {
          res.status(500).json({ message: "Failed to create account" });
          return;
        }
      }
      const existingLicense = await storage.getActiveLicenseForAccount(account.id);
      if (existingLicense) {
        res.status(200).json({
          alreadyHasLicense: true,
          licenseId: existingLicense.id,
          tier: existingLicense.tier,
          expiresAt: existingLicense.expiresAt,
        });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 365 * 24 * 3600;
      const licenseId = `LIC-${Date.now()}-${account.id.slice(0, 8)}`;
      const payload = {
        license_id: licenseId,
        account_id: account.id,
        tier: "custom",
        device_limit: body.pairingDevices,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
        custom_quota: body.usersOrStorage,
      };
      const signature = signLicense(payload);
      await storage.createLicense({
        id: licenseId,
        accountId: account.id,
        tier: "custom",
        deviceLimit: body.pairingDevices,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
        customQuota: body.usersOrStorage,
      });
      sendLicenseGrantEmail({
        to: account.email,
        tier: "custom",
        licenseId,
        deviceLimit: body.pairingDevices,
        expiresAt,
        customQuota: body.usersOrStorage,
      }).catch(() => {});
      res.status(201).json({ success: true, licenseId, accountId: account.id, email: account.email });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Grant-custom license error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/grant-custom-replace", async (req, res) => {
    try {
      const body = z.object({
        email: z.string().email(),
        usersOrStorage: z.number().int().min(1).max(1000),
        pairingDevices: z.number().int().min(1).max(100),
      }).parse(req.body);
      const account = await storage.getAccountByEmail(body.email);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 365 * 24 * 3600;
      const existingLicense = await storage.getActiveLicenseForAccount(account.id);
      if (existingLicense) {
        const payload = {
          license_id: existingLicense.id,
          account_id: existingLicense.accountId,
          tier: "custom",
          device_limit: body.pairingDevices,
          issued_at: existingLicense.issuedAt,
          expires_at: expiresAt,
          state: "active",
          features: { smart_workspaces: true, activity_feed: true },
          custom_quota: body.usersOrStorage,
        };
        const signature = signLicense(payload);
        await storage.updateLicense(existingLicense.id, {
          tier: "custom",
          deviceLimit: body.pairingDevices,
          expiresAt,
          signature,
          customQuota: body.usersOrStorage,
        });
        sendLicenseGrantEmail({
          to: account.email,
          tier: "custom",
          licenseId: existingLicense.id,
          deviceLimit: body.pairingDevices,
          expiresAt,
          customQuota: body.usersOrStorage,
        }).catch(() => {});
        res.status(200).json({ success: true, updated: true, licenseId: existingLicense.id, accountId: account.id, email: account.email });
        return;
      }
      const licenseId = `LIC-${Date.now()}-${account.id.slice(0, 8)}`;
      const payload = {
        license_id: licenseId,
        account_id: account.id,
        tier: "custom",
        device_limit: body.pairingDevices,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
        custom_quota: body.usersOrStorage,
      };
      const signature = signLicense(payload);
      await storage.createLicense({
        id: licenseId,
        accountId: account.id,
        tier: "custom",
        deviceLimit: body.pairingDevices,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
        customQuota: body.usersOrStorage,
      });
      sendLicenseGrantEmail({
        to: account.email,
        tier: "custom",
        licenseId,
        deviceLimit: body.pairingDevices,
        expiresAt,
        customQuota: body.usersOrStorage,
      }).catch(() => {});
      res.status(201).json({ success: true, licenseId, accountId: account.id, email: account.email });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Grant-custom-replace license error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/admin/licenses/:licenseId/members", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      const primaryAccount = await storage.getAccountById(license.accountId);
      const members = await storage.getLicenseMembers(licenseId);
      res.json({
        primary: primaryAccount ? { accountId: primaryAccount.id, email: primaryAccount.email } : null,
        members,
      });
    } catch (err) {
      console.error("License members error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/teams/add-member", async (req, res) => {
    try {
      const body = z.object({
        primaryEmail: z.string().email(),
        memberEmail: z.string().email(),
      }).parse(req.body);
      const primaryAccount = await storage.getAccountByEmail(body.primaryEmail);
      if (!primaryAccount) {
        res.status(404).json({ message: "Primary account not found" });
        return;
      }
      const license = await storage.getActiveLicenseForAccount(primaryAccount.id);
      if (!license || license.tier !== "teams") {
        res.status(400).json({ message: "No active Teams license found for this email" });
        return;
      }
      const userCount = storage.getTeamsLicenseUserCount(license.id);
      if (userCount >= 5) {
        res.status(400).json({ message: "Teams license already has maximum 5 users" });
        return;
      }
      let memberAccount = await storage.getAccountByEmail(body.memberEmail);
      if (!memberAccount) {
        const id = crypto.randomUUID();
        await storage.createAccount(id, body.memberEmail, ".");
        memberAccount = await storage.getAccountById(id);
        if (!memberAccount) {
          res.status(500).json({ message: "Failed to create member account" });
          return;
        }
      }
      if (memberAccount.id === primaryAccount.id) {
        res.status(400).json({ message: "Member email cannot be the same as primary" });
        return;
      }
      const existing = await storage.getLicenseMembers(license.id);
      if (existing.some((m) => m.accountId === memberAccount!.id)) {
        res.status(400).json({ message: "User is already a member of this team" });
        return;
      }
      await storage.addLicenseMember(license.id, memberAccount.id);
      res.status(201).json({ success: true, licenseId: license.id, memberEmail: memberAccount.email });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Add team member error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.delete("/api/admin/licenses/:licenseId/members/:accountId", async (req, res) => {
    try {
      const { licenseId, accountId } = req.params;
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      if (license.tier !== "teams") {
        res.status(400).json({ message: "Only Teams licenses have removable members" });
        return;
      }
      if (license.accountId === accountId) {
        res.status(400).json({ message: "Cannot remove primary account from team" });
        return;
      }
      await storage.removeLicenseMember(licenseId, accountId);
      res.json({ success: true });
    } catch (err) {
      console.error("Remove team member error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/:licenseId/revoke", async (req, res) => {
    try {
      const { licenseId } = req.params;
      await storage.revokeLicense(licenseId);
      res.json({ success: true });
    } catch (err) {
      console.error("Revoke license error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/:licenseId/extend", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const body = z.object({
        expires_at: z.number().int().positive(),
        grace_ends_at: z.number().int().nonnegative().optional(),
      }).parse(req.body);
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      const payload = {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: body.expires_at,
        state: "active",
        grace_ends_at: body.grace_ends_at,
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.updateLicense(licenseId, {
        expiresAt: body.expires_at,
        state: "active",
        signature,
        graceEndsAt: body.grace_ends_at ?? null,
      });
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
        return;
      }
      console.error("Extend license error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/admin/licenses/:licenseId/hosts", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      const hosts = await storage.getHostsForLicense(licenseId);
      res.json({ hosts });
    } catch (err) {
      console.error("License hosts error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/:licenseId/upgrade-pro", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      await storage.upgradeLicenseToPro(licenseId);
      res.json({ success: true });
    } catch (err) {
      console.error("Upgrade to Pro error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.delete("/api/admin/licenses/:licenseId/hosts/:hostUuid", async (req, res) => {
    try {
      const { licenseId, hostUuid } = req.params;
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      if (license.tier !== "pro" && license.tier !== "teams") {
        res.status(403).json({ message: "Device removal is only available for Pro and Teams licenses." });
        return;
      }
      if (!storage.isHostInLicense(licenseId, hostUuid)) {
        res.status(404).json({ message: "Device not found on this license." });
        return;
      }
      await storage.removeLicenseHost(licenseId, hostUuid);
      res.json({ success: true });
    } catch (err) {
      console.error("Remove device error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/devices/:hostUuid/logout", async (req, res) => {
    try {
      const hostUuid = req.params.hostUuid;
      if (!hostUuid || hostUuid.length < 8 || hostUuid.length > 128) {
        res.status(400).json({ message: "Invalid host UUID" });
        return;
      }
      storage.setLogoutRequested(hostUuid);
      res.json({ success: true, message: "Device will be signed out on next config check." });
    } catch (err) {
      console.error("Device logout request error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === PHASE 2: CONFIG (for JoinCloud server, host_uuid in query or header) ===
  app.get("/api/v1/config", async (req, res) => {
    try {
      const hostUuid = (req.query.host_uuid as string) || (req.headers["x-host-uuid"] as string);
      const logoutRequested = hostUuid && hostUuid.length >= 8 && hostUuid.length <= 128 && storage.consumeLogoutRequested(hostUuid);
      let license = null;
      if (hostUuid && hostUuid.length >= 8 && hostUuid.length <= 128) {
        license = await storage.getLicenseForHost(hostUuid);
      }
      const now = Math.floor(Date.now() / 1000);
      if (!license || logoutRequested) {
        res.json({
          license: { state: "UNREGISTERED", tier: "", device_limit: 0, expires_at: 0, features: {} },
          activation: { required: true },
          telemetry: { default_enabled: true },
          trial_days: TRIAL_DAYS,
          logout_requested: !!logoutRequested,
        });
        return;
      }
      let state = license.state;
      if (license.expiresAt < now && state !== "revoked") state = "expired";
      let subscription: { status?: string; renewal_at?: string; plan_interval?: string } | null = null;
      try {
        const account = await storage.getAccountById(license.accountId);
        if (account?.subscriptionId || account?.subscriptionStatus) {
          subscription = {
            status: account.subscriptionStatus ?? undefined,
            renewal_at: account.renewalAt ?? undefined,
            plan_interval: undefined,
          };
          const lic = await storage.getLicenseById(license.id);
          if (lic?.planInterval) subscription.plan_interval = lic.planInterval;
        }
      } catch (_) {}
      let accountEmail: string | undefined;
      try {
        const account = await storage.getAccountById(license.accountId);
        if (account?.email) accountEmail = account.email;
        // For device-only accounts (no email), synthesise a display identifier
        else accountEmail = "Device " + license.accountId.slice(0, 12);
      } catch (_) {}
      res.json({
        license: {
          state,
          tier: license.tier,
          device_limit: license.deviceLimit,
          expires_at: license.expiresAt,
          grace_ends_at: license.graceEndsAt ?? undefined,
          features: { smart_workspaces: true, activity_feed: true },
          account_id: license.accountId,
        },
        activation: { required: false },
        telemetry: { default_enabled: true },
        trial_days: TRIAL_DAYS,
        subscription: subscription ?? undefined,
        account_id: license.accountId,
        account_email: accountEmail,
      });
    } catch (err) {
      console.error("Config error:", err);
      res.status(500).json({
        license: { state: "UNREGISTERED", tier: "", device_limit: 0, expires_at: 0, features: {} },
        activation: { required: true },
        telemetry: { default_enabled: true },
      });
    }
  });

  // === ACCOUNT SUMMARY (for joincloud-web dashboard; no auth) ===
  // CORS preflight for browser-based dashboard
  app.options("/api/v1/account/summary", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
  });
  app.get("/api/v1/account/summary", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    try {
      const hostUuid = (req.query.host_uuid as string)?.trim();
      const accountIdParam = (req.query.account_id as string)?.trim();
      let license = null;
      let account = null;
      if (hostUuid && hostUuid.length >= 8 && hostUuid.length <= 128) {
        license = await storage.getLicenseForHost(hostUuid);
        if (license) account = await storage.getAccountById(license.accountId);
      }
      if (!license && accountIdParam && accountIdParam.length >= 8 && accountIdParam.length <= 128) {
        account = await storage.getAccountById(accountIdParam);
        license = await storage.getActiveLicenseForAccount(accountIdParam) ?? await storage.getLatestLicenseForAccount(accountIdParam);
      }
      if (!license) {
        res.status(404).json({ message: "No license found for this device or account." });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      let state = license.state;
      if (license.expiresAt < now && state !== "revoked") state = "expired";
      let subscription: { status?: string; renewal_at?: string; plan_interval?: string; grace_ends_at?: string } | null = null;
      if (account?.subscriptionId || account?.subscriptionStatus) {
        subscription = {
          status: account.subscriptionStatus ?? undefined,
          renewal_at: account.renewalAt ?? undefined,
          plan_interval: undefined,
          grace_ends_at: account.graceEndsAt ?? undefined,
        };
        const lic = await storage.getLicenseById(license.id);
        if (lic?.planInterval) subscription!.plan_interval = lic.planInterval;
      }
      const members = license.tier === "teams" ? await storage.getLicenseMembers(license.id) : [];
      res.json({
        account: account ? { id: account.id, email: account.email || null } : null,
        license: {
          id: license.id,
          tier: license.tier,
          device_limit: license.deviceLimit,
          state,
          expires_at: license.expiresAt,
          grace_ends_at: license.graceEndsAt ?? undefined,
          members: license.tier === "teams" ? { primary: account ? { accountId: account.id, email: account.email } : null, members } : undefined,
        },
        subscription: subscription ?? undefined,
      });
    } catch (err) {
      console.error("Account summary error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === V1 TEAMS: add/remove members from JoinCloud web (password-authenticated) ===
  app.options("/api/v1/teams/add-member", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/teams/remove-member", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
  });
  app.post("/api/v1/teams/add-member", authRateLimit, async (req, res) => {
    setCors(req, res);
    try {
      const body = z.object({
        primary_email: z.string().email(),
        password: z.string().min(1),
        member_email: z.string().email(),
      }).parse(req.body);
      const primaryAccount = await storage.getAccountByEmail(body.primary_email);
      if (!primaryAccount) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const passwordHash = storage.getPasswordHash(primaryAccount.id);
      if (!passwordHash) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const ok = await bcrypt.compare(body.password, passwordHash);
      if (!ok) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const license = await storage.getActiveLicenseForAccount(primaryAccount.id);
      if (!license || license.tier !== "teams") {
        res.status(400).json({ message: "No active Teams license found for this account" });
        return;
      }
      const userCount = storage.getTeamsLicenseUserCount(license.id);
      if (userCount >= 5) {
        res.status(400).json({ message: "Teams license already has maximum 5 users" });
        return;
      }
      let memberAccount = await storage.getAccountByEmail(body.member_email);
      if (!memberAccount) {
        const id = crypto.randomUUID();
        await storage.createAccount(id, body.member_email, ".");
        memberAccount = await storage.getAccountById(id);
        if (!memberAccount) {
          res.status(500).json({ message: "Failed to create member account" });
          return;
        }
      }
      if (memberAccount.id === primaryAccount.id) {
        res.status(400).json({ message: "Member email cannot be the same as primary" });
        return;
      }
      const existing = await storage.getLicenseMembers(license.id);
      if (existing.some((m) => m.accountId === memberAccount!.id)) {
        res.status(400).json({ message: "User is already a member of this team" });
        return;
      }
      await storage.addLicenseMember(license.id, memberAccount.id);
      res.status(201).json({ success: true, licenseId: license.id, memberEmail: memberAccount.email });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("V1 teams add-member error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
  app.delete("/api/v1/teams/remove-member", authRateLimit, async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", (req as any).headers?.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    try {
      const body = z.object({
        primary_email: z.string().email(),
        password: z.string().min(1),
        member_email: z.string().email(),
      }).parse(req.body);
      const primaryAccount = await storage.getAccountByEmail(body.primary_email);
      if (!primaryAccount) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const passwordHash = storage.getPasswordHash(primaryAccount.id);
      if (!passwordHash) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const ok = await bcrypt.compare(body.password, passwordHash);
      if (!ok) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const license = await storage.getActiveLicenseForAccount(primaryAccount.id);
      if (!license || license.tier !== "teams") {
        res.status(400).json({ message: "No active Teams license found for this account" });
        return;
      }
      const memberAccount = await storage.getAccountByEmail(body.member_email);
      if (!memberAccount) {
        res.status(404).json({ message: "Member not found" });
        return;
      }
      if (license.accountId === memberAccount.id) {
        res.status(400).json({ message: "Cannot remove primary account from team" });
        return;
      }
      await storage.removeLicenseMember(license.id, memberAccount.id);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("V1 teams remove-member error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === BILLING INVOICES (past payments for user panel) ===
  app.options("/api/v1/billing/invoices", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
  });
  app.get("/api/v1/billing/invoices", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", (req as any).headers?.origin || "*");
    try {
      const hostUuid = (req.query.host_uuid as string) || (req.headers["x-host-uuid"] as string) || undefined;
      const accountIdParam = (req.query.account_id as string) || undefined;
      let license = null;
      if (hostUuid && hostUuid.length >= 8 && hostUuid.length <= 128) {
        license = await storage.getLicenseForHost(hostUuid);
      }
      if (!license && accountIdParam && accountIdParam.length >= 8) {
        license = await storage.getActiveLicenseForAccount(accountIdParam) ?? await storage.getLatestLicenseForAccount(accountIdParam);
      }
      if (!license) {
        res.json([]);
        return;
      }
      const account = await storage.getAccountById(license.accountId);
      const customerId = account?.stripeCustomerId;
      if (!customerId || !process.env.STRIPE_SECRET_KEY) {
        res.json([]);
        return;
      }
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const invoices = await stripe.invoices.list({ customer: customerId, limit: 50 });
      const list = invoices.data.map((inv) => ({
        id: inv.id,
        created: inv.created,
        amount_paid: inv.amount_paid ?? 0,
        currency: (inv.currency || "usd").toUpperCase(),
        status: inv.status ?? "draft",
        description: inv.description || inv.lines?.data?.[0]?.description || "Invoice",
        invoice_pdf: inv.invoice_pdf ?? null,
        hosted_invoice_url: inv.hosted_invoice_url ?? null,
      }));
      res.json(list);
    } catch (err) {
      console.error("Billing invoices error:", err);
      res.status(502).json({ message: "Failed to load invoice history" });
    }
  });

  // === BILLING PORTAL (for user panel: manage subscription / payment) ===
  app.post("/api/v1/billing/portal", async (req, res) => {
    try {
      const body = z.object({
        host_uuid: z.string().min(8).max(128),
        return_url: z.string().url().optional(),
      }).parse(req.body);
      const license = await storage.getLicenseForHost(body.host_uuid);
      if (!license) {
        res.status(404).json({ message: "No license found for this device" });
        return;
      }
      const account = await storage.getAccountById(license.accountId);
      const customerId = account?.stripeCustomerId;
      if (!customerId || !process.env.STRIPE_SECRET_KEY) {
        res.status(400).json({ message: "Billing portal not available for this account" });
        return;
      }
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const returnUrl = body.return_url ?? (process.env.JOINCLOUD_UPGRADE_URL || "https://joincloud.app");
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      res.json({ url: session.url });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Billing portal error:", err);
      res.status(500).json({ message: "Failed to create billing portal session" });
    }
  });

  // === RETENTION CLEANUP ===
  
  // Periodically enforce retention (once a day)
  setInterval(() => {
    storage.enforceRetention().catch(console.error);
  }, 24 * 60 * 60 * 1000);

  return httpServer;
}
