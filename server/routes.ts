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
  signedLicensePayloadSchema,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { tunnels, publicShareLinks } from "@shared/schema";
import { signToken, requireAuth, authRateLimit, signAdminToken, signAccessToken, signRefreshToken, verifyRefreshToken, requireAdminAuth, requireRole, type Role } from "./auth";
import { cfRequest } from "./cloudflare";
import { signLicense, verifyLicenseSignature } from "./license-sign";
import {
  type EntitlementsResponse,
  type LicenseState,
  type Tier,
  TIER_DEFAULTS,
  mergeEntitlements,
  resolveEntitlementsByState,
} from "./entitlements";
import { sendLicenseGrantEmail } from "./mailer";
import Stripe from "stripe";
import { handleStripeWebhook } from "./stripe-webhook";
import { verifyRazorpaySignature, handleRazorpayWebhook } from "./razorpay-webhook";
import { getTimeUnitSeconds, getLicenseTimeMode } from "./license-time";
import { emitLicenseUpdated } from "./license-events";
import { emitToDevice, emitToAdmins } from "./socket";

const ADMIN_VERSION = "1.0.0";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;
const GOOGLE_ALLOWED_DOMAIN = process.env.GOOGLE_ALLOWED_DOMAIN;
const ADMIN_SESSION_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "admin_session";
const ADMIN_REFRESH_COOKIE_NAME = process.env.ADMIN_REFRESH_COOKIE_NAME || "admin_refresh";
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "rishabh@arevei.com").toLowerCase();

function getRequestOrigin(req: any): string {
  const host = (req.headers?.host || "").toString();
  const protoHeader = (req.headers?.["x-forwarded-proto"] || "").toString();
  const proto = protoHeader ? protoHeader.split(",")[0].trim() : (req.secure ? "https" : "http");
  return host ? `${proto}://${host}` : "http://localhost:5000";
}

/** Trial duration in days for first-time sign-in (configurable via TRIAL_DAYS env, default 7). */
const TRIAL_DAYS = Math.max(1, parseInt(process.env.TRIAL_DAYS || "7", 10) || 7);

/**
 * Time unit in seconds for all license-related \"day\" calculations.
 * Backed by LICENSE_TIME_MODE (dev|production) via the license-time helper.
 */
const TIME_UNIT_SECS = getTimeUnitSeconds();

/** True when running in dev time mode (1 day = 60s). Used for config and UI. */
const IS_DEV = getLicenseTimeMode() === "dev";

/** Free tier has no expiration; use far-future Unix timestamp (year 2038 safe). */
const FREE_TIER_NO_EXPIRY = 2147483647;

const DEV_TRIAL_MINUTES_DEFAULT = 7;
const DEV_TRIAL_MINUTES_MIN = 1;
const DEV_TRIAL_MINUTES_MAX = 60;
const DEV_EXPIRY_WARNING_MINUTES_DEFAULT = 2;
const pendingInitialDeviceLicense = new Map<string, Promise<void>>();

/** Trial duration in seconds for new trials. In dev uses admin-setting dev_trial_minutes; in prod uses TRIAL_DAYS * TIME_UNIT_SECS. */
async function getTrialDurationSeconds(): Promise<number> {
  if (getLicenseTimeMode() !== "dev") {
    return TRIAL_DAYS * TIME_UNIT_SECS;
  }
  const raw = await storage.getSetting("dev_trial_minutes");
  const mins = Math.min(DEV_TRIAL_MINUTES_MAX, Math.max(DEV_TRIAL_MINUTES_MIN, parseInt(raw || String(DEV_TRIAL_MINUTES_DEFAULT), 10) || DEV_TRIAL_MINUTES_DEFAULT));
  return mins * 60;
}

/** For getOrCreateDeviceTrial: in dev pass minutes (storage treats 1 "day" = 1 min); in prod pass TRIAL_DAYS. */
async function getTrialDurationDaysForStorage(): Promise<number> {
  if (getLicenseTimeMode() !== "dev") {
    return TRIAL_DAYS;
  }
  const raw = await storage.getSetting("dev_trial_minutes");
  return Math.min(DEV_TRIAL_MINUTES_MAX, Math.max(DEV_TRIAL_MINUTES_MIN, parseInt(raw || String(DEV_TRIAL_MINUTES_DEFAULT), 10) || DEV_TRIAL_MINUTES_DEFAULT));
}

async function getDevTrialMinutes(): Promise<number> {
  const raw = await storage.getSetting("dev_trial_minutes");
  return Math.min(DEV_TRIAL_MINUTES_MAX, Math.max(DEV_TRIAL_MINUTES_MIN, parseInt(raw || String(DEV_TRIAL_MINUTES_DEFAULT), 10) || DEV_TRIAL_MINUTES_DEFAULT));
}

async function getDevExpiryWarningMinutes(): Promise<number> {
  const raw = await storage.getSetting("dev_expiry_warning_minutes");
  const n = parseInt(raw || String(DEV_EXPIRY_WARNING_MINUTES_DEFAULT), 10);
  return Number.isFinite(n) && n >= 0 ? n : DEV_EXPIRY_WARNING_MINUTES_DEFAULT;
}

async function ensureInitialDeviceLicense(hostUuid: string): Promise<void> {
  const existingPending = pendingInitialDeviceLicense.get(hostUuid);
  if (existingPending) {
    await existingPending;
    return;
  }

  const work = (async () => {
    await storage.ensureHostRow(hostUuid);

    let license = await storage.getLicenseForHost(hostUuid);
    if (license) return;

    const existingForAccount = await storage.getActiveLicenseForAccount(hostUuid);
    if (existingForAccount) {
      try { await storage.addLicenseHost(existingForAccount.id, hostUuid); } catch (_) {}
      return;
    }

    if (!(await storage.isDeviceTrialUsed(hostUuid))) {
      await storage.ensureDeviceAccount(hostUuid);
      const licenseId = await storage.getNextLicenseId();
      const issuedAt = Math.floor(Date.now() / 1000);
      const trial = await storage.getOrCreateDeviceTrial(hostUuid, await getTrialDurationDaysForStorage());
      const expiresAt = Math.floor(new Date(trial.trialEndsAt).getTime() / 1000);
      const signature = signLicense({
        license_id: licenseId,
        account_id: hostUuid,
        tier: "trial",
        device_limit: 5,
        issued_at: issuedAt,
        expires_at: expiresAt,
        state: "trial_active",
        features: { smart_workspaces: true, activity_feed: true },
      });
      await storage.createLicense({
        id: licenseId,
        accountId: hostUuid,
        tier: "trial",
        deviceLimit: 5,
        issuedAt,
        expiresAt,
        state: "trial_active",
        signature,
      });
      await storage.addLicenseHost(licenseId, hostUuid);
      await storage.setDeviceTrialUsed(hostUuid);
      return;
    }

    const licenseId = await storage.getNextLicenseId();
    const nowSec = Math.floor(Date.now() / 1000);
    const signature = signLicense({
      license_id: licenseId,
      account_id: hostUuid,
      tier: "FREE",
      device_limit: 1,
      issued_at: nowSec,
      expires_at: FREE_TIER_NO_EXPIRY,
      state: "active",
    });
    await storage.createDeviceOnlyLicense(hostUuid, "FREE", FREE_TIER_NO_EXPIRY, signature, licenseId);
  })();

  pendingInitialDeviceLicense.set(hostUuid, work);
  try {
    await work;
  } finally {
    pendingInitialDeviceLicense.delete(hostUuid);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Public: versions manifest for desktop apps (no auth)
  app.get("/versions.json", async (_req, res) => {
    try {
      const rows = await storage.listUpdateManifestEntries();
      const payload = rows.map((r) => ({
        version: r.version,
        releaseDate: r.releaseDate,
        channel: r.channel,
        changelog: Array.isArray(r.changelog) ? r.changelog : [],
        downloads: r.downloads || {},
      }));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(payload);
    } catch (err) {
      console.error("versions.json error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  function setAdminSessionCookie(res: import("express").Response, accessToken: string, refreshToken?: string) {
    const isProd = process.env.NODE_ENV === "production";
    res.cookie(ADMIN_SESSION_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60 * 1000,  // 15 minutes
    });
    if (refreshToken) {
      res.cookie(ADMIN_REFRESH_COOKIE_NAME, refreshToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",  // broad path so it is sent to /auth/refresh
        maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 days
      });
    }
  }

  // Token refresh endpoint: reads refresh cookie, issues new access token
  app.post("/auth/refresh", (req, res) => {
    const cookieHeader = req.headers.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...rest] = c.trim().split("=");
        return [k, rest.join("=")];
      })
    );
    const refreshToken = cookies[ADMIN_REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      res.status(401).json({ message: "No refresh token" });
      return;
    }
    const payload = verifyRefreshToken(refreshToken);
    if (!payload || !payload.accountId || !payload.email) {
      res.clearCookie(ADMIN_REFRESH_COOKIE_NAME, { path: "/" });
      res.status(401).json({ message: "Invalid or expired refresh token" });
      return;
    }
    const role: Role =
      payload.role === "super_admin" || payload.role === "admin" || payload.role === "user"
        ? payload.role
        : "user";
    const newAccessToken = signAccessToken({ accountId: payload.accountId, email: payload.email, role });
    const isProd = process.env.NODE_ENV === "production";
    res.cookie(ADMIN_SESSION_COOKIE_NAME, newAccessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60 * 1000,
    });
    res.json({ ok: true });
  });

  // Require authenticated admin session for all /api/admin routes
  app.use("/api/admin", requireAdminAuth);

  // Require at least 'admin' role for all mutating requests on /api/admin/*
  app.use("/api/admin", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      return requireRole("admin")(req, res, next);
    }
    next();
  });

  // === ADMIN: IN-APP UPDATE MANIFEST (super_admin only) ===
  app.get("/api/admin/updates/manifest", requireRole("super_admin"), async (_req, res) => {
    try {
      const rows = await storage.listUpdateManifestEntries();
      res.json({ versions: rows });
    } catch (err) {
      console.error("updates manifest list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/updates/manifest", requireRole("super_admin"), async (req, res) => {
    try {
      const body = z.object({
        version: z.string().min(1),
        releaseDate: z.string().min(1),
        channel: z.string().min(1).default("stable"),
        changelog: z.array(z.string()).default([]),
        downloads: z.object({
          win: z.string().url().optional(),
          mac: z.string().url().optional(),
          linux: z.string().url().optional(),
        }).default({}),
      }).parse(req.body);
      const out = await storage.upsertUpdateManifestEntry(body);
      res.json(out);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
        return;
      }
      console.error("updates manifest upsert error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.delete("/api/admin/updates/manifest/:version", requireRole("super_admin"), async (req, res) => {
    try {
      const version = req.params.version;
      const ok = await storage.deleteUpdateManifestEntry(version);
      res.json({ success: ok });
    } catch (err) {
      console.error("updates manifest delete error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Google OAuth for admin panel (optional; enabled only when env vars present)
  app.get("/auth/google", (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CALLBACK_URL) {
      res.status(501).send("Google auth not configured");
      return;
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_CALLBACK_URL,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/auth/google/callback", async (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
      res.status(501).send("Google auth not configured");
      return;
    }
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).send("Missing code");
      return;
    }
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_CALLBACK_URL,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error("Google token error:", text);
        res.status(502).send("Google auth failed");
        return;
      }
      const tokenJson: any = await tokenRes.json();
      const idToken = tokenJson.id_token as string;
      if (!idToken) {
        res.status(502).send("Google auth failed");
        return;
      }
      const [, payloadB64] = idToken.split(".");
      const payloadJson = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
      const email = payloadJson.email as string | undefined;
      const emailVerified = !!payloadJson.email_verified;

      if (!email || !emailVerified) {
        res.status(403).send("Email not verified");
        return;
      }
      if (GOOGLE_ALLOWED_DOMAIN && !email.toLowerCase().endsWith(`@${GOOGLE_ALLOWED_DOMAIN.toLowerCase()}`)) {
        res.status(403).send("Unauthorized domain");
        return;
      }

      let account = await storage.getAccountByEmail(email);
      if (!account) {
        const id = crypto.randomUUID();
        account = await storage.createAccount(id, email, ".");
      }

      // Determine role: super_admin email always wins; otherwise use existing adminRole
      const isSuperAdmin = email.toLowerCase() === SUPER_ADMIN_EMAIL;
      const existingAdminRole = account.adminRole as Role | null | undefined;
      const assignedRole: Role | null = isSuperAdmin
        ? "super_admin"
        : (existingAdminRole === "super_admin" || existingAdminRole === "admin" || existingAdminRole === "user")
          ? existingAdminRole
          : null;

      if (!assignedRole) {
        // Not a whitelisted admin — block access
        const ip = (req.ip || req.socket?.remoteAddress || "unknown").toString();
        console.warn(`[AUTH WARN] Blocked unauthorized admin login attempt: ${email} from IP ${ip}`);
        const redirectUrl = getRequestOrigin(req);
        res.redirect(`${redirectUrl}/unauthorized`);
        return;
      }

      // Persist the role so it's always current
      if (account.adminRole !== assignedRole) {
        await storage.updateAccountAdminRole(account.id, assignedRole);
      }

      const accessToken = signAccessToken({ accountId: account.id, email: account.email, role: assignedRole });
      const refreshToken = signRefreshToken({ accountId: account.id, email: account.email, role: assignedRole });
      setAdminSessionCookie(res, accessToken, refreshToken);
      console.log(`[AUTH] Admin login: ${email} (${assignedRole})`);

      const redirectUrl = getRequestOrigin(req);
      res.redirect(redirectUrl);
    } catch (err) {
      console.error("Google callback error:", err);
      res.status(500).send("Authentication failed");
    }
  });

  app.post("/auth/logout", requireAdminAuth, (req, res) => {
    res.clearCookie(ADMIN_SESSION_COOKIE_NAME, { path: "/" });
    res.clearCookie(ADMIN_REFRESH_COOKIE_NAME, { path: "/" });
    const admin = (req as any).admin as { email: string } | undefined;
    if (admin) console.log(`[AUTH] Admin logout: ${admin.email}`);
    res.status(204).end();
  });

  // Lightweight health endpoint for Worker and desktop app status checks.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Current admin identity for the admin panel
  app.get("/api/me", requireAdminAuth, (req, res) => {
    const admin = (req as any).admin as { accountId: string; email: string; role: Role };
    res.json({
      accountId: admin.accountId,
      email: admin.email,
      role: admin.role,
    });
  });

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
        search: req.query.search as string | undefined,
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
      const deviceUUID = req.params.deviceUUID;
      const devices = await storage.getDevicesWithAccountInfo();
      const enrichedDevice = devices.find((d) => d.deviceUUID === deviceUUID);
      if (enrichedDevice) {
        res.json(enrichedDevice);
        return;
      }
      const device = await storage.getDevice(deviceUUID);
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

  // app.delete("/api/admin/devices/:deviceUUID", async (req, res) => {
  //   try {
  //     const deleted = await storage.deleteDevice(req.params.deviceUUID);
  //     if (!deleted) {
  //       res.status(404).json({ message: "Device not found" });
  //       return;
  //     }
  //     res.json({ success: true });
  //   } catch (err) {
  //     console.error("Device delete error:", err);
  //     res.status(500).json({ message: "Internal Server Error" });
  //   }
  // });

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
      // Push to device in real-time if sender is admin
      if (payload.sender === "admin") {
        emitToDevice(req.params.deviceUUID, "support:message", { message });
      }
      // Notify admin panel sockets so other tabs refresh instantly
      emitToAdmins("support:message", { hostUuid: req.params.deviceUUID, message });
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
  app.options("/api/v1/dev/activate-plan", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/public/billing-mode", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/devices/bootstrap-trial", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/devices/usage/shares/increment", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/trial/extend-token", (req, res) => { setCors(req, res); res.sendStatus(204); });
  app.options("/api/v1/subscription/requests", (req, res) => { setCors(req, res); res.sendStatus(204); });

  // === PHASE 2: AUTH ===
  app.post("/api/v1/auth/register", authRateLimit, async (req, res) => {
    setCors(req, res);
    try {
      const { email, password, referralCode, deviceId } = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        referralCode: z.string().optional(),
        deviceId: z.string().optional(),
      }).parse(req.body);
      
      const existing = await storage.getAccountByEmail(email);
      if (existing) {
        res.status(400).json({ message: "Email already registered" });
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      const id = crypto.randomUUID();
      const account = await storage.createAccount(id, email, hash);
      
      // Generate unique referral code for this account
      const userReferralCode = 'JC-' + crypto.createHash('sha256')
        .update(email + Date.now())
        .digest('hex')
        .substring(0, 5)
        .toUpperCase();
      await storage.updateAccountReferral(account.id, { referralCode: userReferralCode });
      
      // Process referral code if provided
      let referralApplied = false;
      let referralDaysAdded = 0;
      if (referralCode) {
        const referrer = await storage.getAccountByReferralCode(referralCode);
        if (referrer && referrer.id !== account.id) {
          const REFERRAL_DAYS = 10;
          
          // Create referral record
          await storage.createReferral({
            id: crypto.randomUUID(),
            referrerAccountId: referrer.id,
            referredAccountId: account.id,
            referralCode: referralCode,
            daysGranted: REFERRAL_DAYS,
            status: 'completed',
          });
          
          // Update referrer stats
          await storage.updateAccountReferral(referrer.id, {
            referralCount: (referrer.referralCount || 0) + 1,
            referralDaysEarned: (referrer.referralDaysEarned || 0) + REFERRAL_DAYS,
          });
          
          // Mark new user as referred
          await storage.updateAccountReferral(account.id, { referredBy: referralCode });
          
          // Extend referrer's license by 10 days
          const referrerLicense = await storage.getActiveLicenseForAccount(referrer.id);
          if (referrerLicense) {
            const newExpiry = referrerLicense.expiresAt + (REFERRAL_DAYS * 24 * 60 * 60);
            const newSignature = signLicense({
              license_id: referrerLicense.id,
              account_id: referrerLicense.accountId,
              tier: referrerLicense.tier,
              device_limit: referrerLicense.deviceLimit,
              issued_at: referrerLicense.issuedAt,
              expires_at: newExpiry,
              state: referrerLicense.state,
            });
            await storage.updateLicense(referrerLicense.id, {
              expiresAt: newExpiry,
              signature: newSignature,
            });
          }
          
          referralApplied = true;
          referralDaysAdded = REFERRAL_DAYS;
        }
      }
      
      // If deviceId provided, link any existing device license to this account
      if (deviceId) {
        const deviceLicense = await storage.getLicenseForHost(deviceId);
        if (deviceLicense && deviceLicense.accountId.includes('@device.local')) {
          await storage.linkLicenseToAccount(deviceLicense.id, account.id);
          
          // If referral was applied, also extend this license
          if (referralApplied && referralDaysAdded > 0) {
            const newExpiry = deviceLicense.expiresAt + (referralDaysAdded * 24 * 60 * 60);
            const newSignature = signLicense({
              license_id: deviceLicense.id,
              account_id: account.id,
              tier: deviceLicense.tier,
              device_limit: deviceLicense.deviceLimit,
              issued_at: deviceLicense.issuedAt,
              expires_at: newExpiry,
              state: deviceLicense.state,
            });
            await storage.updateLicense(deviceLicense.id, {
              expiresAt: newExpiry,
              signature: newSignature,
            });
          }
        }
      }
      
      // Check for pending team invitation for this email
      const pendingInvitation = await storage.getTeamInvitationByEmail(email);
      let teamInfo: { licenseId: string; teamOwnerEmail: string } | null = null;
      
      if (pendingInvitation) {
        try {
          // Accept the invitation and add user to team
          await storage.acceptTeamInvitation(pendingInvitation.id, account.id);
          
          // Get team owner info for response
          const license = await storage.getLicenseById(pendingInvitation.licenseId);
          if (license) {
            const ownerAccount = await storage.getAccountById(license.accountId);
            if (ownerAccount) {
              teamInfo = {
                licenseId: pendingInvitation.licenseId,
                teamOwnerEmail: ownerAccount.email,
              };
            }
          }
          console.log(`User ${email} auto-joined team from invitation ${pendingInvitation.id}`);
        } catch (invErr) {
          console.error("Failed to process team invitation:", invErr);
        }
      }
      
      const token = signToken({ accountId: account.id, email: account.email });
      res.status(201).json({
        user: { id: account.id, email: account.email, referralCode: userReferralCode },
        token,
        team: teamInfo,
        referral: referralApplied ? {
          applied: true,
          daysAdded: referralDaysAdded,
          message: `Referral applied! You got ${referralDaysAdded} extra days.`,
        } : null,
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
      const passwordHash = await storage.getPasswordHash(account.id);
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

  // === DEVICE BOOTSTRAP TRIAL (no auth) ===
  app.post("/api/v1/devices/bootstrap-trial", async (req, res) => {
    setCors(req, res);
    try {
      const { deviceId } = z.object({ deviceId: z.string().min(8).max(128) }).parse(req.body);
      const trial = await storage.getOrCreateDeviceTrial(deviceId, await getTrialDurationDaysForStorage());
      const now = new Date();
      const trialEnds = new Date(trial.trialEndsAt);
      const isExpired = now >= trialEnds;

      if (!isExpired) {
        let license = await storage.getLicenseForHost(deviceId);
        if (!license) {
          const accountId = `device_${deviceId}`;
          const existingAccount = await storage.getAccountById(accountId);
          if (!existingAccount) {
            await storage.createAccount(accountId, `Device ${deviceId.slice(0, 12)}…`, ".");
          }
          const nowSec = Math.floor(Date.now() / 1000);
          const expiresAt = Math.floor(trialEnds.getTime() / 1000);
          const licenseId = await storage.getNextLicenseId();
          const { signLicense } = await import("./license-sign");
          const signature = signLicense({
            license_id: licenseId,
            account_id: accountId,
            tier: "trial",
            device_limit: 5,
            issued_at: nowSec,
            expires_at: expiresAt,
            state: "trial_active",
          });
          await storage.createLicense({
            id: licenseId,
            accountId,
            tier: "trial",
            deviceLimit: 5,
            issuedAt: nowSec,
            expiresAt,
            state: "trial_active",
            signature,
          });
          await storage.ensureHostRow(deviceId);
          await storage.addLicenseHost(licenseId, deviceId);
        }
      }

      const canExtend = await storage.canExtendDeviceTrial(deviceId);
      const entitlements = resolveEntitlementsByState(
        isExpired ? "EXPIRED" : "TRIAL",
        "FREE",
        trial.trialEndsAt,
        canExtend
      );
      const response: EntitlementsResponse = {
        licenseState: isExpired ? "EXPIRED" : "TRIAL",
        tier: isExpired ? "FREE" : "TRIAL",
        trialEndsAt: trial.trialEndsAt,
        graceEndsAt: null,
        entitlements,
      };
      res.json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Bootstrap trial error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === DEVICE REGISTRATION & LICENSE CHECK ===
  // New endpoint that returns full license state for desktop app UI
  app.post("/api/v1/devices/register", async (req, res) => {
    setCors(req, res);
    try {
      const { deviceId, appVersion, platform } = z.object({
        deviceId: z.string().min(8).max(128),
        appVersion: z.string().optional(),
        platform: z.string().optional(),
      }).parse(req.body);

      // Ensure host row exists
      await storage.ensureHostRow(deviceId);
      
      // Register/update host with version and platform
      if (appVersion || platform) {
        try {
          await storage.registerHost({
            host_uuid: deviceId,
            installation_id: deviceId,
            first_installed_at: Math.floor(Date.now() / 1000),
            version: appVersion || '0.0.0',
            platform: platform || 'unknown',
            arch: 'unknown',
          });
        } catch (e) {
          // Host already exists, update via heartbeat
          await storage.hostHeartbeat({
            host_uuid: deviceId,
            version: appVersion || '0.0.0',
          });
        }
      }

      // Check for existing license
      let license = await storage.getLicenseForHost(deviceId);

      // If no license, create trial license
      if (!license) {
        const trial = await storage.getOrCreateDeviceTrial(deviceId, await getTrialDurationDaysForStorage());
        const trialEnds = new Date(trial.trialEndsAt);
        const now = new Date();
        const isExpired = now >= trialEnds;

        if (!isExpired) {
          // Create device-only trial license
          const nowSec = Math.floor(Date.now() / 1000);
          const expiresAt = Math.floor(trialEnds.getTime() / 1000);
          const licenseId = await storage.getNextLicenseId();
          const signature = signLicense({
            license_id: licenseId,
            account_id: deviceId,
            tier: "TRIAL",
            device_limit: 1,
            issued_at: nowSec,
            expires_at: expiresAt,
            state: "trial_active",
          });

          license = await storage.createDeviceOnlyLicense(
            deviceId,
            "TRIAL",
            expiresAt,
            signature,
            licenseId
          );
        }
      }

      // Get full license check response
      const licenseCheckResponse = await storage.getLicenseCheckResponse(deviceId);
      
      res.json(licenseCheckResponse);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Device register error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // License check endpoint - returns current license state for device
  app.get("/api/v1/license/check", async (req, res) => {
    setCors(req, res);
    try {
      const { deviceId } = z.object({
        deviceId: z.string().min(8).max(128),
      }).parse(req.query);

      const licenseCheckResponse = await storage.getLicenseCheckResponse(deviceId);
      res.json(licenseCheckResponse);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("License check error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === MONTHLY SHARE USAGE ===
  app.post("/api/v1/devices/usage/shares/increment", async (req, res) => {
    setCors(req, res);
    try {
      const { deviceId } = z.object({ deviceId: z.string().min(8).max(128) }).parse(req.body);
      const now = new Date();
      const nowSec = Math.floor(now.getTime() / 1000);

      // Determine effective share limit from the device's actual license.
      let limit: number = TIER_DEFAULTS.FREE.shareLimitMonthly!;
      const deviceLicense = await storage.getLicenseForHost(deviceId);

      // Use billing cycle anchor for all tiers. For Free tier we also honour calendar-month
      // resets: take whichever is more recent — the plan-change anchor or the start of the
      // current calendar month. This ensures a just-downgraded device starts at 0 AND a
      // long-term Free user still gets a fresh count every month.
      let cycleStartSec: number;
      if (deviceLicense) {
        const anchor = deviceLicense.renewalAt ?? deviceLicense.issuedAt;
        const rawCycleStart = anchor <= nowSec ? anchor : deviceLicense.issuedAt;
        const isFreeTierInc = (deviceLicense.tier || "").toUpperCase() === "FREE";
        if (isFreeTierInc) {
          const d = new Date();
          const monthStartSec = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
          cycleStartSec = Math.max(rawCycleStart, monthStartSec);
        } else {
          cycleStartSec = rawCycleStart;
        }

        const isExpired = deviceLicense.expiresAt < nowSec && deviceLicense.state !== "revoked";
        const effectiveState = isExpired ? "expired" : deviceLicense.state;
        const canExtend = await storage.canExtendDeviceTrial(deviceId);
        const ents = resolveEntitlementsByState(
          effectiveState,
          (deviceLicense.tier || "free").toLowerCase(),
          deviceLicense.expiresAt ? new Date(deviceLicense.expiresAt * 1000).toISOString() : null,
          canExtend
        );
        limit = ents.shareLimitMonthly === null ? 999999 : (ents.shareLimitMonthly ?? TIER_DEFAULTS.FREE.shareLimitMonthly!);
      } else {
        // No license: calendar-month key, free limit
        const d = new Date();
        const calKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const { count: calCount } = await storage.incrementMonthlyShares(deviceId, calKey);
        const allowed = calCount <= limit;
        const remaining = Math.max(0, limit - calCount);
        res.json({ allowed, remaining, limit });
        return;
      }

      const existingCount = await storage.getShareCountSinceCycleStart(deviceId, cycleStartSec);
      if (limit < 999999 && existingCount >= limit) {
        res.json({ allowed: false, remaining: 0, limit, used: limit });
        return;
      }

      const { count } = await storage.incrementSharesForCycle(deviceId, cycleStartSec);
      const allowed = count <= limit;
      const visibleCount = limit >= 999999 ? count : Math.min(count, limit);
      const remaining = limit >= 999999 ? null : Math.max(0, limit - visibleCount);
      res.json({ allowed, remaining, limit: limit >= 999999 ? null : limit, used: visibleCount });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === TRIAL EXTEND TOKEN (auth required) ===
  const trialExtendTokens = new Map<string, { deviceId: string; expiresAt: number }>();
  app.post("/api/v1/trial/extend-token", requireAuth, async (req, res) => {
    setCors(req, res);
    try {
      const { deviceId } = z.object({ deviceId: z.string().min(8).max(128) }).parse(req.body);
      if (!await storage.canExtendDeviceTrial(deviceId)) {
        res.status(400).json({ message: "Trial already extended or not found" });
        return;
      }
      const token = crypto.randomUUID();
      const expiresAt = Date.now() + 60_000;
      trialExtendTokens.set(token, { deviceId, expiresAt });
      setTimeout(() => trialExtendTokens.delete(token), 60_000);
      res.json({ token });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
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

      const trialExtendEntry = trialExtendTokens.get(token);
      if (trialExtendEntry && trialExtendEntry.expiresAt >= Date.now()) {
        trialExtendTokens.delete(token);
        const { deviceId } = trialExtendEntry;
        await storage.extendDeviceTrial(deviceId, 7);
        const trial = await storage.getOrCreateDeviceTrial(deviceId, await getTrialDurationDaysForStorage());
        const response: EntitlementsResponse = {
          licenseState: "TRIAL",
          tier: "FREE",
          trialEndsAt: trial.trialEndsAt,
          graceEndsAt: null,
          entitlements: {
            ...TIER_DEFAULTS.FREE,
            shareLimitMonthly: 1000,
            teamEnabled: true,
            canExtendTrial: false,
            uiTeasers: { showTeamsMenu: true, teamsLocked: false },
          },
        };
        res.json(response);
        return;
      }
      trialExtendTokens.delete(token);

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

      // Migrate: if device has device_ license but user signed in with real account, move device to real account
      if (license && license.accountId.startsWith("device_") && !accountId.startsWith("device_")) {
        await storage.removeLicenseHost(license.id, deviceId);
        license = null;
      }

      if (!license) {
        license = await storage.getActiveLicenseForAccount(accountId);

        if (!license && !account.trialUsed) {
          const now = Math.floor(Date.now() / 1000);
          const trialDurationSecs = await getTrialDurationSeconds();
          const licenseId = await storage.getNextLicenseId();
          const payload = {
            license_id: licenseId,
            account_id: accountId,
            tier: "trial",
            device_limit: 5,
            issued_at: now,
            expires_at: now + trialDurationSecs,
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
          const hostCount = await storage.getLicenseHostsCount(license.id);
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

      // If this is a trial license and can be extended, extend to 14 days total
      if (license && license.tier.toLowerCase() === 'trial' && license.state === 'trial_active') {
        if (await storage.canExtendDeviceTrial(deviceId)) {
          try {
            const trialDaysForStorage = await getTrialDurationDaysForStorage();
            await storage.extendDeviceTrial(deviceId, trialDaysForStorage); // Extend by same duration (e.g. 7 more days or 7 more min in dev)
            // Update license expiration
            const newTrial = await storage.getOrCreateDeviceTrial(deviceId, trialDaysForStorage);
            const newExpiresAt = Math.floor(new Date(newTrial.trialEndsAt).getTime() / 1000);
            const newSignature = signLicense({
              license_id: license.id,
              account_id: accountId,
              tier: license.tier,
              device_limit: license.deviceLimit,
              issued_at: license.issuedAt,
              expires_at: newExpiresAt,
              state: license.state,
            });
            await storage.updateLicense(license.id, {
              expiresAt: newExpiresAt,
              signature: newSignature,
            });
            license = await storage.getLicenseById(license.id);
          } catch (e) {
            // Trial already extended, ignore
          }
        }
        
        // Link the device-only license to the real account
        if (license && license.accountId !== accountId) {
          await storage.linkLicenseToAccount(license.id, accountId);
          license = await storage.getLicenseById(license.id);
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
        
        // Include trial extension info
        responsePayload.trialExtended = true;
        responsePayload.message = "Trial extended to 14 days!";
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

      if (await storage.isDeviceTrialUsed(host_uuid)) {
        res.status(403).json({
          code: "TRIAL_ALREADY_USED",
          message: "This device has already used its trial. Please upgrade to Pro.",
        });
        return;
      }

      await storage.ensureDeviceAccount(host_uuid);
      const licenseId = await storage.getNextLicenseId();
      const issuedAt = now;
      const trialDurationSecs = await getTrialDurationSeconds();
      const expiresAt = issuedAt + trialDurationSecs;
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
      await storage.setDeviceTrialUsed(host_uuid);
      license = await storage.getLicenseById(licenseId)!;
      if (!license) throw new Error("License not found after creation");
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
          const licenseId = await storage.getNextLicenseId();
          const issuedAt = Math.floor(Date.now() / 1000);
          const trialDurationSecs = await getTrialDurationSeconds();
          const expiresAt = issuedAt + trialDurationSecs;
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

      const count = await storage.getLicenseHostsCount(license.id);
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

  // DEV-only: instant license grant (no Razorpay). Requires payment_mode=DEV and NODE_ENV !== production.
  app.post("/api/v1/dev/activate-plan", requireAuth, async (req, res) => {
    setCors(req, res);
    try {
      const paymentMode = await storage.getSetting("payment_mode") ?? "LIVE";
      if (paymentMode !== "DEV") {
        res.status(403).json({ message: "DEV activation is only available when payment_mode is DEV" });
        return;
      }
      if (process.env.NODE_ENV === "production") {
        res.status(403).json({ message: "DEV activation is disabled in production" });
        return;
      }
      const auth = (req as any).auth as { accountId: string; email: string };
      const body = z.object({
        plan: z.enum(["PRO", "TEAMS", "pro", "teams"]),
        deviceId: z.string().nullable().optional(),
      }).parse(req.body);
      const tier = body.plan.toUpperCase() === "TEAMS" ? "teams" : "pro";
      const deviceLimit = tier === "teams" ? 5 : 5;
      const now = Math.floor(Date.now() / 1000);
      const PAID_PLAN_DAYS = 30;
      const expiresAt = now + PAID_PLAN_DAYS * 24 * 3600; // 30 days from now
      const licenseId = await storage.getNextLicenseId();
      const payload = {
        license_id: licenseId,
        account_id: auth.accountId,
        tier,
        device_limit: deviceLimit,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      const existingLicense = await storage.getActiveLicenseForAccount(auth.accountId);
      if (existingLicense) {
        const updatePayload = {
          license_id: existingLicense.id,
          account_id: existingLicense.accountId,
          tier,
          device_limit: deviceLimit,
          issued_at: existingLicense.issuedAt,
          expires_at: payload.expires_at,
          state: "active",
          features: { smart_workspaces: true, activity_feed: true },
        };
        const newSig = signLicense(updatePayload);
        await storage.updateLicense(existingLicense.id, { tier, deviceLimit, expiresAt: payload.expires_at, signature: newSig });
        if (body.deviceId && body.deviceId.length >= 8 && body.deviceId.length <= 128) {
          await storage.ensureHostRow(body.deviceId);
          const count = await storage.getLicenseHostsCount(existingLicense.id);
          if (count < deviceLimit) {
            try { await storage.addLicenseHost(existingLicense.id, body.deviceId); } catch (_) { /* already linked */ }
          }
        }
        // Push plan change to device in real-time
        emitLicenseUpdated({
          id: existingLicense.id,
          accountId: existingLicense.accountId,
          state: "active",
          tier,
          expiresAt: payload.expires_at,
          deviceLimit,
        });
        res.json({ success: true, tier, licenseState: "ACTIVE" });
        return;
      }
      await storage.createLicense({
        id: licenseId,
        accountId: auth.accountId,
        tier,
        deviceLimit,
        issuedAt: now,
        expiresAt: payload.expires_at,
        state: "active",
        signature,
      });
      if (body.deviceId && body.deviceId.length >= 8 && body.deviceId.length <= 128) {
        await storage.ensureHostRow(body.deviceId);
        try { await storage.addLicenseHost(licenseId, body.deviceId); } catch (_) { /* already linked */ }
      }
      res.json({ success: true, tier, licenseState: "ACTIVE" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("DEV activate-plan error:", err);
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
          grace_ends_at: body.license.grace_ends_at ?? undefined,
          features: body.license.features,
          custom_quota: body.license.custom_quota ?? undefined,
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
      if (!await storage.isHostInLicense(body.license.license_id, body.host_uuid)) {
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
      const expiresAt = now + 30 * TIME_UNIT_SECS;
      let license = await storage.getActiveLicenseForAccount(account_id);
      const licenseId = license?.id ?? await storage.getNextLicenseId();
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


  // Manual plan/limit requests coming from JoinCloud web
  app.post("/api/v1/admin/manual-plan-request", async (req, res) => {
    try {
      const { accountId, deviceId, requestedDays, requestedShareLimit, notes } = req.body as {
        accountId?: string;
        deviceId?: string;
        requestedDays?: number;
        requestedShareLimit?: number;
        notes?: string;
      };
      if (!accountId && !deviceId) {
        res.status(400).json({ message: "accountId or deviceId is required" });
        return;
      }
      const days = Number.isFinite(requestedDays as number) && requestedDays! > 0 ? requestedDays! : 30;
      const shareLimit = Number.isFinite(requestedShareLimit as number) && requestedShareLimit! > 0 ? requestedShareLimit! : undefined;

      // Find license by account or device
      let license = null;
      if (accountId) {
        const account = await storage.getAccountById(accountId);
        if (account?.id) {
          const licenses = await storage.listLicensesWithHostCounts();
          license = licenses.find((l) => l.accountId === account.id) ?? null;
        }
      }
      if (!license && deviceId) {
        const licenses = await storage.listLicensesWithHostCounts();
        license = licenses.find((l) => l.firstDeviceId === deviceId) ?? null;
      }
      if (!license) {
        res.status(404).json({ message: "License not found for request" });
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = nowSec + days * 86400;

      // Apply requested expiry, reset usage cycle, and optional share limit (same as modify plans)
      await storage.updateLicense(license.id, {
        expiresAt,
        customQuota: shareLimit ?? null,
        renewalAt: nowSec,
      });

      // When share limit requested, set overrides so config returns the new limit
      if (shareLimit != null) {
        let overrides: Record<string, unknown> = {};
        try {
          const existing = await storage.getLicenseById(license.id);
          if (existing && (existing as { overridesJson?: string }).overridesJson) {
            overrides = JSON.parse((existing as { overridesJson: string }).overridesJson);
          }
        } catch (_) {
          overrides = {};
        }
        overrides.shareLimitMonthly = shareLimit;
        await storage.updateLicenseOverridesJson(license.id, JSON.stringify(overrides));
      }

      // Optionally record the request for audit/logging
      if (notes) {
        console.log("Manual plan request applied", {
          licenseId: license.id,
          accountId: license.accountId,
          deviceId,
          requestedDays: days,
          requestedShareLimit: shareLimit,
          notes,
        });
      }

      // Push real-time plan update to the device (same as License section modify)
      emitLicenseUpdated({
        id: license.id,
        accountId: license.accountId,
        state: "active",
        tier: license.tier,
        expiresAt,
      });

      res.json({
        success: true,
        licenseId: license.id,
        applied: {
          expiresAt,
          requestedDays: days,
          requestedShareLimit: shareLimit ?? null,
        },
      });
    } catch (err) {
      console.error("Manual plan request error:", err);
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


  // Admin settings (payment_mode: LIVE | DEV, subscription_mode: manual | automatic, dev_trial_minutes, dev_expiry_warning_minutes)
  app.get("/api/v1/admin/settings", requireAdminAuth, async (req, res) => {
    try {
      const payment_mode = await storage.getSetting("payment_mode") ?? "LIVE";
      const subscription_mode = await storage.getSetting("subscription_mode") ?? "automatic";
      const dev_trial_minutes = await getDevTrialMinutes();
      const dev_expiry_warning_minutes = await getDevExpiryWarningMinutes();
      res.json({
        payment_mode: payment_mode === "DEV" ? "DEV" : "LIVE",
        subscription_mode: subscription_mode === "manual" ? "manual" : "automatic",
        dev_trial_minutes,
        dev_expiry_warning_minutes,
      });
    } catch (err) {
      console.error("Admin settings error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/v1/admin/settings/payment-mode", requireAdminAuth, requireRole("super_admin"), async (req, res) => {
    try {
      const body = z.object({
        payment_mode: z.enum(["LIVE", "DEV"]),
      }).parse(req.body);
      await storage.setSetting("payment_mode", body.payment_mode);
      res.json({ payment_mode: body.payment_mode });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Set payment mode error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/v1/admin/settings/subscription-mode", requireAdminAuth, requireRole("super_admin"), async (req, res) => {
    try {
      const body = z.object({
        subscription_mode: z.enum(["manual", "automatic"]),
      }).parse(req.body);
      await storage.setSetting("subscription_mode", body.subscription_mode);
      res.json({ subscription_mode: body.subscription_mode });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Set subscription mode error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/v1/admin/settings/dev-trial-minutes", requireAdminAuth, requireRole("admin"), async (req, res) => {
    try {
      const body = z.object({
        dev_trial_minutes: z.number().int().min(DEV_TRIAL_MINUTES_MIN).max(DEV_TRIAL_MINUTES_MAX),
      }).parse(req.body);
      await storage.setSetting("dev_trial_minutes", String(body.dev_trial_minutes));
      res.json({ dev_trial_minutes: body.dev_trial_minutes });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Set dev trial minutes error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/v1/admin/settings/dev-expiry-warning-minutes", requireAdminAuth, requireRole("admin"), async (req, res) => {
    try {
      const body = z.object({
        dev_expiry_warning_minutes: z.number().int().min(0).max(60),
      }).parse(req.body);
      await storage.setSetting("dev_expiry_warning_minutes", String(body.dev_expiry_warning_minutes));
      res.json({ dev_expiry_warning_minutes: body.dev_expiry_warning_minutes });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Set dev expiry warning minutes error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Public billing mode (no auth; used by JoinCloud-Web to decide Razorpay vs DEV activate)
  app.get("/api/v1/public/billing-mode", async (req, res) => {
    setCors(req, res);
    try {
      const payment_mode = await storage.getSetting("payment_mode") ?? "LIVE";
      const subscription_mode = await storage.getSetting("subscription_mode") ?? "automatic";
      res.json({
        payment_mode: payment_mode === "DEV" ? "DEV" : "LIVE",
        subscription_mode: subscription_mode === "manual" ? "manual" : "automatic",
      });
    } catch (err) {
      console.error("Billing mode error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === MANUAL SUBSCRIPTION REQUESTS ===

  function normalizeSubscriptionRequest(r: any) {
    return {
      id: r.id,
      status: r.status,
      plan_id: r.planId ?? r.plan_id,
      email: r.email,
      phone: r.phone ?? null,
      account_id: r.accountId ?? r.account_id ?? null,
      device_id: r.deviceId ?? r.device_id ?? null,
      custom_users: r.customUsers ?? r.custom_users ?? null,
      custom_devices: r.customDevices ?? r.custom_devices ?? null,
      requested_days: r.requestedDays ?? r.requested_days ?? null,
      requested_share_limit: r.requestedShareLimit ?? r.requested_share_limit ?? null,
      requested_device_limit: r.requestedDeviceLimit ?? r.requested_device_limit ?? null,
      notes: r.notes ?? null,
      license_id: r.licenseId ?? r.license_id ?? null,
      approved_by: r.approvedBy ?? r.approved_by ?? null,
      approved_at: r.approvedAt ?? r.approved_at ?? null,
      created_at: r.createdAt ?? r.created_at,
    };
  }

  app.post("/api/v1/subscription/requests", async (req, res) => {
    setCors(req, res);
    try {
      const body = z.object({
        plan_id: z.enum(["pro", "team", "custom"]),
        email: z.string().email(),
        phone: z.string().trim().min(3).max(64).optional().or(z.literal("")).optional(),
        account_id: z.string().min(8).max(128).optional(),
        device_id: z.string().min(8).max(128).optional(),
        custom_users: z.number().int().nonnegative().optional(),
        custom_devices: z.number().int().nonnegative().optional(),
        requested_days: z.number().int().min(1).max(365).optional(),
        requested_share_limit: z.number().int().min(0).max(100000).optional(),
        requested_device_limit: z.number().int().min(1).max(100).optional(),
      }).parse(req.body);

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      await storage.createSubscriptionRequest({
        id,
        status: "pending",
        planId: body.plan_id,
        email: body.email,
        phone: body.phone && body.phone.length > 0 ? body.phone : null,
        accountId: body.account_id ?? null,
        deviceId: body.device_id ?? null,
        customUsers: body.custom_users ?? null,
        customDevices: body.custom_devices ?? null,
        requestedDays: body.requested_days ?? null,
        requestedShareLimit: body.requested_share_limit ?? null,
        requestedDeviceLimit: body.requested_device_limit ?? null,
        notes: null,
        licenseId: null,
        approvedBy: null,
        approvedAt: null,
        createdAt: nowIso,
      });

      // Fire-and-forget emails
      import("./mailer").then(({ sendSubscriptionRequestEmails }) => {
        void sendSubscriptionRequestEmails({
          planId: body.plan_id,
          email: body.email,
          phone: body.phone && body.phone.length > 0 ? body.phone : null,
          accountId: body.account_id ?? null,
          deviceId: body.device_id ?? null,
          customUsers: body.custom_users ?? null,
          customDevices: body.custom_devices ?? null,
        });
      }).catch(() => {});

      res.status(201).json({ id, status: "pending" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Create subscription request error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/admin/subscription/requests", async (req, res) => {
    try {
      const status = (req.query.status as string | undefined)?.trim();
      const filters = status ? { status } : undefined;
      const requests = await storage.listSubscriptionRequests(filters);
      res.json(requests.map(normalizeSubscriptionRequest));
    } catch (err) {
      console.error("List subscription requests error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/subscription/requests/:id/approve", async (req, res) => {
    try {
      const id = req.params.id;
      const rawRequest = await storage.getSubscriptionRequestById(id);
      if (!rawRequest) {
        res.status(404).json({ message: "Subscription request not found" });
        return;
      }
      const request = normalizeSubscriptionRequest(rawRequest);
      if (request.status === "approved") {
        res.status(400).json({ message: "Request already approved" });
        return;
      }

      const body = z.object({
        tier: z.enum(["pro", "teams", "custom"]).optional(),
        device_limit: z.number().int().min(1).max(100).optional(),
        expires_at: z.number().int().positive().optional(),
        custom_quota: z.number().int().min(1).optional().nullable(),
        share_limit_monthly: z.number().int().min(0).max(100000).optional().nullable(),
        notes: z.string().max(1000).optional().nullable(),
      }).parse(req.body);

      const tier = (body.tier ?? (request.plan_id === "team" ? "teams" : request.plan_id)) as string;
      const deviceLimit = body.device_limit ?? request.requested_device_limit ?? (tier === "teams" ? 9 : 5);
      const nowSec = Math.floor(Date.now() / 1000);
      const requestedDays = request.requested_days ?? 365;
      const expiresAt = body.expires_at ?? (nowSec + requestedDays * 86400);

      // Ensure account exists
      let accountId: string;
      if (request.account_id) {
        accountId = request.account_id;
      } else {
        const existing = await storage.getAccountByEmail(request.email);
        if (existing) {
          accountId = existing.id;
        } else {
          accountId = crypto.randomUUID();
          await storage.createAccount(accountId, request.email, ".");
        }
      }

      const { signLicense } = await import("./license-sign");
      let licenseId: string;

      // Single license per device: if this request has a device_id, find that device's license and update it (or create one with stable ID).
      if (request.device_id && request.device_id.length >= 8) {
        const existingForDevice = await storage.getLicenseForHost(request.device_id);
        if (existingForDevice) {
          // Update the existing license for this device (same license_id, new plan)
          licenseId = existingForDevice.id;
          const payload = {
            license_id: existingForDevice.id,
            account_id: existingForDevice.accountId,
            tier,
            device_limit: deviceLimit,
            issued_at: existingForDevice.issuedAt,
            expires_at: expiresAt,
            state: "active",
            custom_quota: body.custom_quota ?? undefined,
          };
          const signature = signLicense(payload);
          await storage.updateLicense(existingForDevice.id, {
            tier,
            deviceLimit,
            expiresAt,
            state: "active",
            signature,
            customQuota: body.custom_quota ?? null,
            renewalAt: nowSec,
          });
          await storage.ensureHostRow(request.device_id);
          await storage.addLicenseHost(existingForDevice.id, request.device_id);
        } else {
          // No license for this device yet: create a fresh sequential license ID.
          licenseId = await storage.getNextLicenseId();
          const signature = signLicense({
            license_id: licenseId,
            account_id: accountId,
            tier,
            device_limit: deviceLimit,
            issued_at: nowSec,
            expires_at: expiresAt,
            state: "active",
          });
          await storage.createLicense({
            id: licenseId,
            accountId,
            tier,
            deviceLimit,
            issuedAt: nowSec,
            expiresAt,
            state: "active",
            signature,
            planInterval: "year",
            graceEndsAt: undefined,
            renewalAt: expiresAt,
            customQuota: body.custom_quota ?? undefined,
          });
          await storage.ensureHostRow(request.device_id);
          await storage.addLicenseHost(licenseId, request.device_id);
        }
      } else {
        // No device_id: legacy path – expire any existing active for account, create new manual license
        const existingActive = await storage.getActiveLicenseForAccount(accountId);
        if (existingActive) {
          await storage.updateLicense(existingActive.id, { state: "expired", expiresAt: nowSec });
        }
        licenseId = await storage.getNextLicenseId();
        const signature = signLicense({
          license_id: licenseId,
          account_id: accountId,
          tier,
          device_limit: deviceLimit,
          issued_at: nowSec,
          expires_at: expiresAt,
          state: "active",
        });
        await storage.createLicense({
          id: licenseId,
          accountId,
          tier,
          deviceLimit,
          issuedAt: nowSec,
          expiresAt,
          state: "active",
          signature,
          planInterval: "year",
          graceEndsAt: undefined,
          renewalAt: expiresAt,
          customQuota: body.custom_quota ?? undefined,
        });
      }

      if (body.share_limit_monthly != null) {
        let overrides: Record<string, unknown> = {};
        try {
          const existing = await storage.getLicenseById(licenseId);
          if (existing && (existing as { overridesJson?: string }).overridesJson) {
            overrides = JSON.parse((existing as { overridesJson: string }).overridesJson);
          }
        } catch (_) {
          overrides = {};
        }
        overrides.shareLimitMonthly = body.share_limit_monthly;
        await storage.updateLicenseOverridesJson(licenseId, JSON.stringify(overrides));
      }

      const adminId = (req as any).user?.id ?? "admin";
      const approvedAtIso = new Date().toISOString();
      await storage.updateSubscriptionRequest(id, {
        status: "approved",
        notes: body.notes ?? request.notes ?? null,
        licenseId,
        approvedBy: adminId,
        approvedAt: approvedAtIso,
      });

      // Push real-time plan update to device
      emitLicenseUpdated({
        id: licenseId,
        accountId,
        state: "active",
        tier,
        expiresAt,
        deviceLimit,
        shareLimitMonthly: body.share_limit_monthly ?? null,
      });

      // Notify user of license grant
      import("./mailer").then(({ sendLicenseGrantEmail }) => {
        void sendLicenseGrantEmail({
          to: request.email,
          tier,
          licenseId,
          deviceLimit,
          expiresAt,
          customQuota: body.custom_quota ?? null,
        });
      }).catch(() => {});

      const updated = await storage.getSubscriptionRequestById(id);
      res.json(updated ? normalizeSubscriptionRequest(updated) : null);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Approve subscription request error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/subscription/requests/:id/reject", async (req, res) => {
    try {
      const id = req.params.id;
      const rawRequest = await storage.getSubscriptionRequestById(id);
      if (!rawRequest) {
        res.status(404).json({ message: "Subscription request not found" });
        return;
      }
      if (rawRequest.status !== "pending") {
        res.status(400).json({ message: "Request is not pending" });
        return;
      }
      const body = z.object({
        notes: z.string().max(1000).optional().nullable(),
      }).parse(req.body);
      await storage.updateSubscriptionRequest(id, {
        status: "rejected",
        notes: body.notes ?? rawRequest.notes ?? null,
      });
      const updated = await storage.getSubscriptionRequestById(id);
      res.json(updated ? normalizeSubscriptionRequest(updated) : null);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Reject subscription request error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Device-side: claim an approved license by host_uuid (no sign-in required).
  // Matches requests that were approved and already have the host in license_hosts (device_id path),
  // or registers the host into the approved license if the request's device_id matches.
  app.post("/api/v1/license/claim", async (req, res) => {
    setCors(req, res);
    try {
      const body = z.object({
        host_uuid: z.string().min(8).max(128),
      }).parse(req.body);

      const { host_uuid } = body;

      // Already activated?
      const existing = await storage.getLicenseForHost(host_uuid);
      if (existing && existing.state === "active") {
        res.json({ success: true, already_active: true });
        return;
      }

      // Find an approved subscription request whose device_id matches this host_uuid
      const allApproved = (await storage.listSubscriptionRequests({ status: "approved" })).map(normalizeSubscriptionRequest);
      const matchingRequest = allApproved.find(
        (r) => r.device_id === host_uuid && r.license_id
      );

      if (!matchingRequest) {
        res.json({ success: false, reason: "no_approved_request" });
        return;
      }

      const licenseId: string = matchingRequest.license_id!;
      await storage.ensureHostRow(host_uuid);
      await storage.addLicenseHost(licenseId, host_uuid);

      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("License claim error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.options("/api/v1/license/claim", (req, res) => { setCors(req, res); res.sendStatus(204); });

  // === ADMIN: BILLING & SUBSCRIPTIONS ===
  app.get("/api/admin/billing/summary", async (req, res) => {
    try {
      const summary = await storage.getBillingSummary();
      res.json(summary);
    } catch (err) {
      console.error("Billing summary error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/admin/accounts-with-billing", async (req, res) => {
    try {
      const includeDeviceAccounts =
        typeof req.query?.include_device_accounts === "string" &&
        ["1", "true", "yes"].includes(String(req.query.include_device_accounts).toLowerCase());
      let accounts = await storage.listAccountsWithBilling();
      if (!includeDeviceAccounts) {
        // Hide device-only placeholder accounts (created for device-id based trials).
        accounts = accounts.filter((a) => !(a?.email && String(a.email).toLowerCase().endsWith("@device.local")));
      }
      res.json(accounts);
    } catch (err) {
      console.error("Accounts with billing error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/admin/accounts/:accountId", async (req, res) => {
    try {
      const account = await storage.getAccountWithBilling(req.params.accountId);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      res.json(account);
    } catch (err) {
      console.error("Account details error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Update license billing info (payment method, amount, etc.)
  app.patch("/api/admin/licenses/:licenseId/billing", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const body = z.object({
        paymentMethod: z.enum(["online", "offline", "offer"]).optional(),
        amountPaid: z.number().int().min(0).optional(),
        currency: z.string().max(3).optional(),
        paymentProvider: z.enum(["stripe", "razorpay", "manual"]).optional(),
        invoiceId: z.string().max(255).optional(),
        discountPercent: z.number().int().min(0).max(100).optional(),
        notes: z.string().max(1000).optional(),
      }).parse(req.body);
      
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      
      await storage.updateLicenseBilling(licenseId, body);
      const updated = await storage.getLicenseById(licenseId);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Update license billing error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === ADMIN: TEAM INVITATIONS ===
  app.get("/api/admin/licenses/:licenseId/invitations", async (req, res) => {
    try {
      const invitations = await storage.getTeamInvitations(req.params.licenseId);
      res.json(invitations);
    } catch (err) {
      console.error("Get team invitations error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/:licenseId/invitations", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const body = z.object({
        email: z.string().email(),
      }).parse(req.body);
      
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      if (license.tier !== "teams") {
        res.status(400).json({ message: "Team invitations only available for Teams licenses" });
        return;
      }
      
      // Check if already a member
      const members = await storage.getLicenseMembers(licenseId);
      const existingMember = members.find(m => m.email.toLowerCase() === body.email.toLowerCase());
      if (existingMember) {
        res.status(400).json({ message: "User is already a team member" });
        return;
      }
      
      // Check team size limit
      const userCount = await storage.getTeamsLicenseUserCount(licenseId);
      if (userCount >= 5) {
        res.status(400).json({ message: "Team has reached maximum 5 users" });
        return;
      }
      
      const invitation = await storage.addTeamInvitation(licenseId, body.email, license.accountId);
      res.json(invitation);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Add team invitation error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.delete("/api/admin/invitations/:invitationId", async (req, res) => {
    try {
      const invitationId = parseInt(req.params.invitationId);
      await storage.removeTeamInvitation(invitationId);
      res.json({ success: true });
    } catch (err) {
      console.error("Remove team invitation error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/grant", async (req, res) => {
    try {
      const body = z.object({
        deviceId: z.string().min(8).max(128),
        tier: z.enum(["pro", "teams"]),
      }).parse(req.body);
      const now = Math.floor(Date.now() / 1000);
      const existingLicense = await storage.getLicenseByDeviceId(body.deviceId);
      if (existingLicense) {
        res.status(200).json({
          alreadyHasLicense: true,
          licenseId: existingLicense.id,
          tier: existingLicense.tier,
          expiresAt: existingLicense.expiresAt,
        });
        return;
      }
      const deviceLimit = body.tier === "teams" ? TIER_DEFAULTS.TEAMS.maxDevicesTotal! : TIER_DEFAULTS.PRO.maxDevicesTotal!;
      const expiresAt = now + 365 * TIME_UNIT_SECS;
      const licenseId = await storage.getNextLicenseId();
      const payload = {
        license_id: licenseId,
        account_id: body.deviceId,
        tier: body.tier,
        device_limit: deviceLimit,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.ensureDeviceAccount(body.deviceId);
      await storage.ensureHostRow(body.deviceId);
      await storage.createLicense({
        id: licenseId,
        accountId: body.deviceId,
        tier: body.tier,
        deviceLimit,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
      });
      await storage.addLicenseHost(licenseId, body.deviceId);
      res.status(201).json({ success: true, licenseId, accountId: body.deviceId, deviceId: body.deviceId });
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
        deviceId: z.string().min(8).max(128),
        tier: z.enum(["pro", "teams"]),
      }).parse(req.body);
      const deviceLimit = body.tier === "teams" ? TIER_DEFAULTS.TEAMS.maxDevicesTotal! : TIER_DEFAULTS.PRO.maxDevicesTotal!;
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 365 * TIME_UNIT_SECS;
      const existingLicense = await storage.getLicenseByDeviceId(body.deviceId);
      if (existingLicense) {
        const payload = {
          license_id: existingLicense.id,
          account_id: body.deviceId,
          tier: body.tier,
          device_limit: deviceLimit,
          issued_at: existingLicense.issuedAt,
          expires_at: expiresAt,
          state: "active",
          features: { smart_workspaces: true, activity_feed: true },
        };
        const signature = signLicense(payload);
        await storage.ensureDeviceAccount(body.deviceId);
        await storage.ensureHostRow(body.deviceId);
        await storage.updateLicense(existingLicense.id, { tier: body.tier, deviceLimit, expiresAt, signature });
        await storage.addLicenseHost(existingLicense.id, body.deviceId);
        res.status(200).json({ success: true, updated: true, licenseId: existingLicense.id, accountId: body.deviceId, deviceId: body.deviceId });
        return;
      }
      const licenseId = await storage.getNextLicenseId();
      const payload = {
        license_id: licenseId,
        account_id: body.deviceId,
        tier: body.tier,
        device_limit: deviceLimit,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.ensureDeviceAccount(body.deviceId);
      await storage.ensureHostRow(body.deviceId);
      await storage.createLicense({
        id: licenseId,
        accountId: body.deviceId,
        tier: body.tier,
        deviceLimit,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
      });
      await storage.addLicenseHost(licenseId, body.deviceId);
      res.status(201).json({ success: true, licenseId, accountId: body.deviceId, deviceId: body.deviceId });
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
        deviceId: z.string().min(8).max(128),
        usersOrStorage: z.number().int().min(1).max(1000),
        pairingDevices: z.number().int().min(1).max(100),
      }).parse(req.body);
      const existingLicense = await storage.getLicenseByDeviceId(body.deviceId);
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
      const expiresAt = now + 365 * TIME_UNIT_SECS;
      const licenseId = await storage.getNextLicenseId();
      const payload = {
        license_id: licenseId,
        account_id: body.deviceId,
        tier: "custom",
        device_limit: body.pairingDevices,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
        custom_quota: body.usersOrStorage,
      };
      const signature = signLicense(payload);
      await storage.ensureDeviceAccount(body.deviceId);
      await storage.ensureHostRow(body.deviceId);
      await storage.createLicense({
        id: licenseId,
        accountId: body.deviceId,
        tier: "custom",
        deviceLimit: body.pairingDevices,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
        customQuota: body.usersOrStorage,
      });
      await storage.addLicenseHost(licenseId, body.deviceId);
      res.status(201).json({ success: true, licenseId, accountId: body.deviceId, deviceId: body.deviceId });
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
        deviceId: z.string().min(8).max(128),
        usersOrStorage: z.number().int().min(1).max(1000),
        pairingDevices: z.number().int().min(1).max(100),
      }).parse(req.body);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 365 * TIME_UNIT_SECS;
      const existingLicense = await storage.getLicenseByDeviceId(body.deviceId);
      if (existingLicense) {
        const payload = {
          license_id: existingLicense.id,
          account_id: body.deviceId,
          tier: "custom",
          device_limit: body.pairingDevices,
          issued_at: existingLicense.issuedAt,
          expires_at: expiresAt,
          state: "active",
          features: { smart_workspaces: true, activity_feed: true },
          custom_quota: body.usersOrStorage,
        };
        const signature = signLicense(payload);
        await storage.ensureDeviceAccount(body.deviceId);
        await storage.ensureHostRow(body.deviceId);
        await storage.updateLicense(existingLicense.id, {
          tier: "custom",
          deviceLimit: body.pairingDevices,
          expiresAt,
          signature,
          customQuota: body.usersOrStorage,
        });
        await storage.addLicenseHost(existingLicense.id, body.deviceId);
        res.status(200).json({ success: true, updated: true, licenseId: existingLicense.id, accountId: body.deviceId, deviceId: body.deviceId });
        return;
      }
      const licenseId = await storage.getNextLicenseId();
      const payload = {
        license_id: licenseId,
        account_id: body.deviceId,
        tier: "custom",
        device_limit: body.pairingDevices,
        issued_at: now,
        expires_at: expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
        custom_quota: body.usersOrStorage,
      };
      const signature = signLicense(payload);
      await storage.ensureDeviceAccount(body.deviceId);
      await storage.ensureHostRow(body.deviceId);
      await storage.createLicense({
        id: licenseId,
        accountId: body.deviceId,
        tier: "custom",
        deviceLimit: body.pairingDevices,
        issuedAt: now,
        expiresAt,
        state: "active",
        signature,
        customQuota: body.usersOrStorage,
      });
      await storage.addLicenseHost(licenseId, body.deviceId);
      res.status(201).json({ success: true, licenseId, accountId: body.deviceId, deviceId: body.deviceId });
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
      const userCount = await storage.getTeamsLicenseUserCount(license.id);
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

  app.post("/api/admin/licenses/:licenseId/unrevoke", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      let restoredState: "trial_active" | "active" | "grace" | "expired";
      if (license.expiresAt <= now) {
        restoredState = "expired";
      } else if (license.graceEndsAt && license.graceEndsAt > now) {
        restoredState = "grace";
      } else if (license.tier === "trial") {
        restoredState = "trial_active";
      } else {
        restoredState = "active";
      }

      const payload = {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: license.expiresAt,
        state: restoredState,
        grace_ends_at: license.graceEndsAt ?? undefined,
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.updateLicense(licenseId, {
        state: restoredState,
        signature,
      });

      res.json({ success: true, state: restoredState });
    } catch (err) {
      console.error("Unrevoke license error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/:licenseId/end-trial-now", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      // Allow ending any plan (trial, pro, teams, custom) — move to Free tier
      if (String(license.state || "").toLowerCase() === "revoked") {
        res.status(400).json({ message: "Cannot end a revoked license" });
        return;
      }
      const freeTier = "FREE";
      const freeDeviceLimit = 1;
      const payload = {
        license_id: license.id,
        account_id: license.accountId,
        tier: freeTier,
        device_limit: freeDeviceLimit,
        issued_at: license.issuedAt,
        expires_at: FREE_TIER_NO_EXPIRY,
        state: "active" as const,
        grace_ends_at: license.graceEndsAt ?? undefined,
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      const endNow = Math.floor(Date.now() / 1000);
      await storage.updateLicense(licenseId, {
        expiresAt: FREE_TIER_NO_EXPIRY,
        state: "active",
        tier: freeTier,
        deviceLimit: freeDeviceLimit,
        signature,
        renewalAt: endNow,
        customQuota: null,
      });
      // Ensure free defaults apply (no stale overrides from paid plans)
      try { await storage.updateLicenseOverridesJson(licenseId, "{}"); } catch (_) {}

      emitLicenseUpdated({
        id: license.id,
        accountId: license.accountId,
        state: "active",
        tier: freeTier,
        expiresAt: FREE_TIER_NO_EXPIRY,
        deviceLimit: freeDeviceLimit,
        shareLimitMonthly: TIER_DEFAULTS.FREE.shareLimitMonthly,
      });
      res.json({ success: true, state: "active", tier: freeTier });
    } catch (err) {
      console.error("End trial now error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/licenses/:licenseId/extend", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const body = z.object({
        expires_at: z.number().int().positive().optional(),
        days_to_add: z.number().int().min(1).max(3650).optional(),
        grace_ends_at: z.number().int().nonnegative().optional(),
      }).refine((v) => v.expires_at != null || v.days_to_add != null, {
        message: "Either expires_at or days_to_add is required",
        path: ["expires_at"],
      }).parse(req.body);
      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const resolvedExpiresAt =
        body.expires_at ??
        (Math.max(license.expiresAt, now) + (body.days_to_add as number) * TIME_UNIT_SECS);
      const payload = {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: resolvedExpiresAt,
        state: "active",
        grace_ends_at: body.grace_ends_at,
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.updateLicense(licenseId, {
        expiresAt: resolvedExpiresAt,
        state: "active",
        signature,
        graceEndsAt: body.grace_ends_at ?? null,
      });

      emitLicenseUpdated({
        id: license.id,
        accountId: license.accountId,
        state: "active",
        tier: license.tier,
        expiresAt: resolvedExpiresAt,
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

  app.patch("/api/admin/licenses/:licenseId", async (req, res) => {
    try {
      const { licenseId } = req.params;
      const body = z.object({
        tier: z.enum(["trial", "pro", "teams", "custom", "free"]).optional(),
        deviceLimit: z.number().int().min(1).max(100).optional(),
        expiresAt: z.number().int().positive().optional(),
        state: z.enum(["active", "revoked"]).optional(),
        customQuota: z.number().int().min(0).max(10000).nullable().optional(),
        extendTrialDays: z.number().int().min(1).max(365).optional(),
        extendDuration: z.enum(["7d", "30d", "90d", "180d", "365d"]).optional(),
        // New quota control fields
        shareLimitMonthly: z.number().int().min(0).max(100000).optional(),
        userLimit: z.number().int().min(1).max(100).optional(),
        teamLimit: z.number().int().min(0).max(50).optional(),
        devicesPerUser: z.number().int().min(1).max(20).optional(),
        additionalDeviceIds: z.array(z.string()).optional(),
        notes: z.string().max(1000).optional(),
        // Overrides JSON for custom quotas
        overridesJson: z.string().optional(),
      }).parse(req.body);

      const license = await storage.getLicenseById(licenseId);
      if (!license) {
        res.status(404).json({ message: "License not found" });
        return;
      }

      const updates: {
        tier?: string;
        deviceLimit?: number;
        expiresAt?: number;
        state?: string;
        customQuota?: number | null;
        signature?: string;
      } = {};

      if (body.tier !== undefined) {
        updates.tier = body.tier === "free" ? "FREE" : body.tier;
        // When tier changes, reset the billing cycle so share counts restart from 0
        const normalizedNewTier = updates.tier as string;
        const normalizedCurrentTier = (license.tier || "").toUpperCase();
        if (normalizedNewTier !== normalizedCurrentTier) {
          updates.renewalAt = Math.floor(Date.now() / 1000);
        }
        if (body.tier === "free") {
          updates.state = "active";
          updates.expiresAt = FREE_TIER_NO_EXPIRY;
          updates.deviceLimit = 1;
          // Clear any paid-plan quota overrides when downgrading to Free
          updates.customQuota = null;
          try { await storage.updateLicenseOverridesJson(licenseId, "{}"); } catch (_) {}
        } else if (body.tier === "pro") {
          if (!body.state) updates.state = "active";
          if (!body.deviceLimit) updates.deviceLimit = 3;
        } else if (body.tier === "teams") {
          if (!body.state) updates.state = "active";
          if (!body.deviceLimit) updates.deviceLimit = 9;
        } else if (body.tier === "custom") {
          if (!body.state) updates.state = "active";
        } else if (body.tier === "trial") {
          if (!body.state) updates.state = "trial_active";
          if (!body.deviceLimit) updates.deviceLimit = 3;
        }
      }
      if (body.deviceLimit !== undefined && body.tier !== "free") updates.deviceLimit = body.deviceLimit;
      if (body.state !== undefined) updates.state = body.state;
      if (body.customQuota !== undefined) updates.customQuota = body.customQuota;

      const now = Math.floor(Date.now() / 1000);
      // PostgreSQL integer is 32-bit signed; max safe value is FREE_TIER_NO_EXPIRY (2147483647)
      const maxExpiresAt = FREE_TIER_NO_EXPIRY;

      if (body.expiresAt !== undefined) {
        updates.expiresAt = Math.min(maxExpiresAt, body.expiresAt);
      } else if (body.extendTrialDays !== undefined) {
        const base = license.expiresAt >= FREE_TIER_NO_EXPIRY ? now : Math.max(license.expiresAt, now);
        updates.expiresAt = Math.min(maxExpiresAt, base + body.extendTrialDays * TIME_UNIT_SECS);
        if (license.state === "trial_active") {
          updates.state = "trial_active";
        }
      } else if (body.extendDuration !== undefined) {
        const daysMap: Record<string, number> = {
          "7d": 7,
          "30d": 30,
          "90d": 90,
          "180d": 180,
          "365d": 365,
        };
        const days = daysMap[body.extendDuration] || 30;
        const base = license.expiresAt >= FREE_TIER_NO_EXPIRY ? now : Math.max(license.expiresAt, now);
        updates.expiresAt = Math.min(maxExpiresAt, base + days * TIME_UNIT_SECS);
      }

      // Handle extended quota fields by updating the license billing info
      const billingUpdates: Record<string, any> = {};
      if (body.notes !== undefined) billingUpdates.notes = body.notes;
      
      // Store extended quotas in overrides_json column
      if (body.shareLimitMonthly !== undefined || 
          body.userLimit !== undefined || 
          body.teamLimit !== undefined || 
          body.devicesPerUser !== undefined ||
          body.additionalDeviceIds !== undefined ||
          body.overridesJson !== undefined) {
        
        let overrides: Record<string, any> = {};
        
        // Parse existing overrides if any
        try {
          const existingOverrides = await storage.getLicenseById(licenseId);
          if (existingOverrides && (existingOverrides as any).overridesJson) {
            overrides = JSON.parse((existingOverrides as any).overridesJson);
          }
        } catch (e) {
          overrides = {};
        }
        
        // Update with new values
        if (body.shareLimitMonthly !== undefined) overrides.shareLimitMonthly = body.shareLimitMonthly;
        if (body.userLimit !== undefined) overrides.userLimit = body.userLimit;
        if (body.teamLimit !== undefined) overrides.teamLimit = body.teamLimit;
        if (body.devicesPerUser !== undefined) overrides.devicesPerUser = body.devicesPerUser;
        if (body.additionalDeviceIds !== undefined) overrides.additionalDeviceIds = body.additionalDeviceIds;
        
        // If raw overridesJson provided, merge it
        if (body.overridesJson) {
          try {
            const parsed = JSON.parse(body.overridesJson);
            overrides = { ...overrides, ...parsed };
          } catch (e) {
            res.status(400).json({ message: "Invalid overridesJson format" });
            return;
          }
        }
        
        // Store overrides (using the existing overrides_json column)
        const overridesStr = JSON.stringify(overrides);
        await storage.updateLicenseOverridesJson(licenseId, overridesStr);
      }

      if (Object.keys(updates).length > 0) {
        const payload = {
          license_id: license.id,
          account_id: license.accountId,
          tier: updates.tier ?? license.tier,
          device_limit: updates.deviceLimit ?? license.deviceLimit,
          issued_at: license.issuedAt,
          expires_at: updates.expiresAt ?? license.expiresAt,
          state: updates.state ?? license.state,
          features: { smart_workspaces: true, activity_feed: true },
        };
        updates.signature = signLicense(payload);
        await storage.updateLicense(licenseId, updates);

        const effectiveState = updates.state ?? license.state;
        const effectiveTier = updates.tier ?? license.tier;
        const effectiveExpiresAt = updates.expiresAt ?? license.expiresAt;

        emitLicenseUpdated({
          id: license.id,
          accountId: license.accountId,
          state: effectiveState,
          tier: effectiveTier,
          expiresAt: effectiveExpiresAt,
        });
      }
      
      // Update billing info if any
      if (Object.keys(billingUpdates).length > 0) {
        await storage.updateLicenseBilling(licenseId, billingUpdates);
      }

      // If state changed to suspended, suspend the host
      if (body.state === 'suspended') {
        const hosts = await storage.getHostsForLicense(licenseId);
        for (const host of hosts) {
          await storage.suspendHost(host.host_uuid, 'admin_action');
        }
      }
      
      // If state changed from suspended, unsuspend the hosts
      if (body.state && body.state !== 'suspended' && license.state === 'suspended') {
        const hosts = await storage.getHostsForLicense(licenseId);
        for (const host of hosts) {
          await storage.unsuspendHost(host.host_uuid);
        }
      }

      res.json({ success: true, message: "License updated" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
        return;
      }
      console.error("Modify license error:", err);
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
      if (!await storage.isHostInLicense(licenseId, hostUuid)) {
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
      await storage.setLogoutRequested(hostUuid);
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
      const logoutRequested = hostUuid && hostUuid.length >= 8 && hostUuid.length <= 128 && await storage.consumeLogoutRequested(hostUuid);
      let license: Awaited<ReturnType<typeof storage.getLicenseForHost>> = null;
      if (hostUuid && hostUuid.length >= 8 && hostUuid.length <= 128) {
        license = await storage.getLicenseForHost(hostUuid);
        if (!license && !logoutRequested) {
          await ensureInitialDeviceLicense(hostUuid);
          license = await storage.getLicenseForHost(hostUuid);
        }
      }
      const now = Math.floor(Date.now() / 1000);
      if (!license || logoutRequested) {
        const [devTrialMins, devWarningMins] = await Promise.all([getDevTrialMinutes(), getDevExpiryWarningMinutes()]);
        const origin = getRequestOrigin(req);
        const versionsUrl = `${origin}/versions.json`;
        res.json({
          license: { state: "UNREGISTERED", tier: "", device_limit: 0, expires_at: 0, features: {} },
          activation: { required: true },
          telemetry: { default_enabled: true },
          updates: { versions_url: versionsUrl },
          trial_days: TRIAL_DAYS,
          dev_mode: IS_DEV,
          dev_trial_minutes: devTrialMins,
          dev_expiry_warning_minutes: devWarningMins,
          usage: {
            sharesThisMonth: 0,
            devicesLinked: 0,
          },
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
      let displayName: string | undefined;
      try {
        const account = await storage.getAccountById(license.accountId);
        if (account?.email) accountEmail = account.email;
        else accountEmail = "Device " + license.accountId.slice(0, 12);
        const isDeviceOnly = !account?.email || account.email.startsWith("Device ") || account.id.startsWith("device_");
        displayName = isDeviceOnly ? "Join" : (account?.username ? `Join ${account.username}` : (account?.email ? `Join ${account.email.split("@")[0]}` : "Join"));
      } catch (_) {}
      const tier = (license.tier || "free").toLowerCase();
      const canExtendTrial = hostUuid ? await storage.canExtendDeviceTrial(hostUuid) : false;
      let entitlements = resolveEntitlementsByState(
        state,
        tier,
        license.expiresAt ? new Date(license.expiresAt * 1000).toISOString() : null,
        canExtendTrial
      );
      const overrides: { shareLimitMonthly?: number; maxUsers?: number; maxDevicesPerUser?: number; maxDevicesTotal?: number; maxTeams?: number; teamEnabled?: boolean } = {};
      if (license.overridesJson) {
        try {
          const parsed = JSON.parse(license.overridesJson);
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.shareLimitMonthly === "number") overrides.shareLimitMonthly = parsed.shareLimitMonthly;
            if (typeof parsed.maxUsers === "number") overrides.maxUsers = parsed.maxUsers;
            if (typeof parsed.maxDevicesPerUser === "number") overrides.maxDevicesPerUser = parsed.maxDevicesPerUser;
            if (typeof parsed.maxDevicesTotal === "number") overrides.maxDevicesTotal = parsed.maxDevicesTotal;
            if (typeof parsed.maxTeams === "number") overrides.maxTeams = parsed.maxTeams;
            if (typeof parsed.teamEnabled === "boolean") overrides.teamEnabled = parsed.teamEnabled;
          }
        } catch (_) {}
      }
      if (license.shareLimitMonthly != null && Number.isFinite(license.shareLimitMonthly)) {
        overrides.shareLimitMonthly = license.shareLimitMonthly;
      }
      if (Object.keys(overrides).length > 0) {
        entitlements = { ...entitlements };
        if (overrides.shareLimitMonthly != null) entitlements.shareLimitMonthly = overrides.shareLimitMonthly;
        if (overrides.maxUsers != null) entitlements.maxUsers = overrides.maxUsers;
        if (overrides.maxDevicesPerUser != null) entitlements.maxDevicesPerUser = overrides.maxDevicesPerUser;
        if (overrides.maxDevicesTotal != null) entitlements.maxDevicesTotal = overrides.maxDevicesTotal;
        if (overrides.maxTeams != null) entitlements.maxTeams = overrides.maxTeams;
        if (overrides.teamEnabled != null) entitlements.teamEnabled = overrides.teamEnabled;
      }
      const [devTrialMins, devWarningMins] = await Promise.all([getDevTrialMinutes(), getDevExpiryWarningMinutes()]);
      const origin = getRequestOrigin(req);
      const versionsUrl = `${origin}/versions.json`;
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
        updates: { versions_url: versionsUrl },
        trial_days: TRIAL_DAYS,
        dev_mode: IS_DEV,
        dev_trial_minutes: devTrialMins,
        dev_expiry_warning_minutes: devWarningMins,
        subscription: subscription ?? undefined,
        account_id: license.accountId,
        account_email: accountEmail,
        display_name: displayName ?? "Join",
        entitlements,
        usage: {
          sharesThisMonth: await (async () => {
            if (!hostUuid) return 0;
            const nowSecConfig = Math.floor(Date.now() / 1000);
            const anchor = license.renewalAt ?? license.issuedAt;
            const rawCycleStart = anchor <= nowSecConfig ? anchor : license.issuedAt;
            // For Free tier: also honour calendar-month resets so long-term Free users
            // get a fresh count each month. Use whichever is more recent: the plan-change
            // anchor (e.g. just downgraded) or the start of the current calendar month.
            const isFreeTierConfig = (license.tier || "").toUpperCase() === "FREE";
            let cycleStart = rawCycleStart;
            if (isFreeTierConfig) {
              const d = new Date();
              const monthStartSec = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
              cycleStart = Math.max(rawCycleStart, monthStartSec);
            }
            return storage.getShareCountSinceCycleStart(hostUuid, cycleStart);
          })(),
          devicesLinked: await storage.getLicenseHostsCount(license.id),
        },
      });
    } catch (err) {
      console.error("Config error:", err);
      const [devTrialMins, devWarningMins] = await Promise.all([getDevTrialMinutes(), getDevExpiryWarningMinutes()]).catch(() => [DEV_TRIAL_MINUTES_DEFAULT, DEV_EXPIRY_WARNING_MINUTES_DEFAULT]);
      const origin = getRequestOrigin(req);
      const versionsUrl = `${origin}/versions.json`;
      res.status(500).json({
        license: { state: "UNREGISTERED", tier: "", device_limit: 0, expires_at: 0, features: {} },
        activation: { required: true },
        telemetry: { default_enabled: true },
        updates: { versions_url: versionsUrl },
        trial_days: TRIAL_DAYS,
        dev_mode: IS_DEV,
        dev_trial_minutes: devTrialMins,
        dev_expiry_warning_minutes: devWarningMins,
        usage: {
          sharesThisMonth: 0,
          devicesLinked: 0,
        },
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
      const username = account?.username ?? null;
      const isDeviceOnlyAccount = !account?.email || account.email.startsWith("Device ") || account.id.startsWith("device_");
      const displayName = isDeviceOnlyAccount ? "Join" : (username ? `Join ${username}` : (account?.email ? `Join ${account.email.split("@")[0]}` : "Join"));

      // Primary device: prefer hostUuid from query, else first device from license
      let device: { deviceId: string; displayName: string; platform: string; lastSeen: string | null } | null = null;
      const hostsForLicense = await storage.getHostsForLicense(license.id);
      const primaryDeviceId = hostUuid || hostsForLicense[0]?.host_uuid;
      if (primaryDeviceId) {
        const host = await storage.getHostByUUID(primaryDeviceId);
        device = {
          deviceId: primaryDeviceId,
          displayName,
          platform: host?.platform || "unknown",
          lastSeen: host?.lastSeenAt ?? null,
        };
      }

      const accountEmail = account && !isDeviceOnlyAccount ? (account.email || null) : null;
      res.json({
        account: account ? { id: account.id, email: accountEmail, username: isDeviceOnlyAccount ? null : username, isDeviceOnly: isDeviceOnlyAccount } : null,
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
        device: device ?? undefined,
      });
    } catch (err) {
      console.error("Account summary error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === ACCOUNT UPDATE PROFILE (username; password-authenticated) ===
  app.options("/api/v1/account/update-profile", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
  });
  app.post("/api/v1/account/update-profile", authRateLimit, async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    try {
      const body = z.object({
        email: z.string().email(),
        password: z.string().min(1),
        username: z.string().max(64).optional(),
      }).parse(req.body);
      const account = await storage.getAccountByEmail(body.email);
      if (!account) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const passwordHash = await storage.getPasswordHash(account.id);
      if (!passwordHash) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const ok = await bcrypt.compare(body.password, passwordHash);
      if (!ok) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      await storage.updateAccountUsername(account.id, body.username ?? "");
      res.json({ success: true, username: body.username?.trim() || null });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Update profile error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === ACCOUNT CHANGE PASSWORD ===
  app.options("/api/v1/account/change-password", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
  });
  app.post("/api/v1/account/change-password", authRateLimit, async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    try {
      const body = z.object({
        email: z.string().email(),
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Password must be at least 8 characters"),
      }).parse(req.body);
      const account = await storage.getAccountByEmail(body.email);
      if (!account) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const passwordHash = await storage.getPasswordHash(account.id);
      if (!passwordHash) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const ok = await bcrypt.compare(body.currentPassword, passwordHash);
      if (!ok) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const newHash = await bcrypt.hash(body.newPassword, 10);
      await storage.updateAccountPassword(account.id, newHash);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Change password error:", err);
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
      const passwordHash = await storage.getPasswordHash(primaryAccount.id);
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
      const userCount = await storage.getTeamsLicenseUserCount(license.id);
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
      const passwordHash = await storage.getPasswordHash(primaryAccount.id);
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

  // === REFERRAL SYSTEM ===
  
  // Get referral stats for authenticated user
  app.options("/api/v1/referral/stats", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
  });
  app.get("/api/v1/referral/stats", requireAuth, async (req, res) => {
    setCors(req, res);
    try {
      const auth = (req as any).auth as { accountId: string; email: string };
      const stats = await storage.getReferralStats(auth.accountId);
      res.json(stats);
    } catch (err) {
      console.error("Referral stats error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Apply referral code (after signup)
  app.options("/api/v1/referral/apply", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
  });
  app.post("/api/v1/referral/apply", requireAuth, async (req, res) => {
    setCors(req, res);
    try {
      const { referralCode } = z.object({
        referralCode: z.string().min(1).max(20),
      }).parse(req.body);
      
      const auth = (req as any).auth as { accountId: string; email: string };
      const account = await storage.getAccountById(auth.accountId);
      
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      
      // Check if user already used a referral code
      if (account.referredBy) {
        res.status(400).json({ 
          error: "already_used", 
          message: "You have already used a referral code" 
        });
        return;
      }
      
      // Find referrer by code
      const referrer = await storage.getAccountByReferralCode(referralCode);
      if (!referrer) {
        res.status(400).json({ 
          error: "invalid_code", 
          message: "Referral code not found" 
        });
        return;
      }
      
      // Prevent self-referral
      if (referrer.id === auth.accountId) {
        res.status(400).json({ 
          error: "self_referral", 
          message: "Cannot use your own referral code" 
        });
        return;
      }
      
      const REFERRAL_DAYS = 10;
      
      // Extend user's license
      const userLicense = await storage.getActiveLicenseForAccount(auth.accountId) 
        ?? await storage.getLatestLicenseForAccount(auth.accountId);
      
      let newUserExpiresAt = 0;
      if (userLicense) {
        const now = Math.floor(Date.now() / 1000);
        // If expired, extend from now; otherwise extend from current expiry
        const baseExpiry = userLicense.expiresAt > now ? userLicense.expiresAt : now;
        newUserExpiresAt = baseExpiry + (REFERRAL_DAYS * 24 * 60 * 60);
        
        const newState = userLicense.tier.toLowerCase() === 'trial' ? 'trial_active' : 'active';
        const newSignature = signLicense({
          license_id: userLicense.id,
          account_id: userLicense.accountId,
          tier: userLicense.tier,
          device_limit: userLicense.deviceLimit,
          issued_at: userLicense.issuedAt,
          expires_at: newUserExpiresAt,
          state: newState,
        });
        
        await storage.updateLicense(userLicense.id, {
          expiresAt: newUserExpiresAt,
          state: newState,
          signature: newSignature,
        });
      }
      
      // Extend referrer's license
      const referrerLicense = await storage.getActiveLicenseForAccount(referrer.id)
        ?? await storage.getLatestLicenseForAccount(referrer.id);
      
      if (referrerLicense) {
        const now = Math.floor(Date.now() / 1000);
        const baseExpiry = referrerLicense.expiresAt > now ? referrerLicense.expiresAt : now;
        const newExpiry = baseExpiry + (REFERRAL_DAYS * 24 * 60 * 60);
        
        const newState = referrerLicense.tier.toLowerCase() === 'trial' ? 'trial_active' : 'active';
        const newSignature = signLicense({
          license_id: referrerLicense.id,
          account_id: referrerLicense.accountId,
          tier: referrerLicense.tier,
          device_limit: referrerLicense.deviceLimit,
          issued_at: referrerLicense.issuedAt,
          expires_at: newExpiry,
          state: newState,
        });
        
        await storage.updateLicense(referrerLicense.id, {
          expiresAt: newExpiry,
          state: newState,
          signature: newSignature,
        });
      }
      
      // Create referral record
      await storage.createReferral({
        id: crypto.randomUUID(),
        referrerAccountId: referrer.id,
        referredAccountId: auth.accountId,
        referralCode: referralCode,
        daysGranted: REFERRAL_DAYS,
        status: 'completed',
      });
      
      // Update referrer stats
      await storage.updateAccountReferral(referrer.id, {
        referralCount: (referrer.referralCount || 0) + 1,
        referralDaysEarned: (referrer.referralDaysEarned || 0) + REFERRAL_DAYS,
      });
      
      // Mark user as referred
      await storage.updateAccountReferral(auth.accountId, { referredBy: referralCode });
      
      res.json({
        success: true,
        daysAdded: REFERRAL_DAYS,
        newExpiresAt: newUserExpiresAt,
        message: `Referral applied! You got ${REFERRAL_DAYS} extra days.`,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Referral apply error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === DEVICE RECOVERY REQUESTS ===
  
  // User requests device recovery
  app.post("/api/v1/recovery/request", requireAuth, async (req, res) => {
    setCors(req, res);
    try {
      const { newDeviceId, reason } = z.object({
        newDeviceId: z.string().min(8).max(128),
        reason: z.string().optional(),
      }).parse(req.body);
      
      const auth = (req as any).auth as { accountId: string; email: string };
      
      // Get current license and device
      const license = await storage.getActiveLicenseForAccount(auth.accountId)
        ?? await storage.getLatestLicenseForAccount(auth.accountId);
      
      if (!license) {
        res.status(400).json({ message: "No license found for this account" });
        return;
      }
      
      const hosts = await storage.getHostsForLicense(license.id);
      if (hosts.length === 0) {
        // No existing device, can directly activate on new device
        await storage.addLicenseHost(license.id, newDeviceId);
        res.json({ 
          success: true, 
          autoApproved: true,
          message: "License activated on new device" 
        });
        return;
      }
      
      const oldDeviceId = hosts[0].host_uuid;
      
      // Check device change count for suspicious activity
      const deviceChangeCount = await storage.incrementDeviceChangeCount(auth.accountId);
      
      if (deviceChangeCount <= 2) {
        // Auto-approve for first 2 device changes
        await storage.removeLicenseHost(license.id, oldDeviceId);
        await storage.addLicenseHost(license.id, newDeviceId);
        
        res.json({ 
          success: true, 
          autoApproved: true,
          message: "License transferred to new device" 
        });
        return;
      }
      
      if (deviceChangeCount >= 5) {
        // Suspend account for too many changes
        await storage.suspendHost(newDeviceId, 'suspicious_activity');
        res.status(403).json({ 
          error: 'suspended',
          message: "Account suspended due to suspicious activity. Please contact support." 
        });
        return;
      }
      
      // Create recovery request for admin approval (3-4 changes)
      const requestId = crypto.randomUUID();
      await storage.createDeviceRecoveryRequest({
        id: requestId,
        accountId: auth.accountId,
        oldDeviceId,
        newDeviceId,
        reason: reason || null,
        status: 'pending',
        adminNotes: null,
      });
      
      res.json({ 
        success: true, 
        pendingApproval: true,
        requestId,
        message: "Recovery request submitted. Pending admin approval." 
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Recovery request error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Check recovery request status
  app.get("/api/v1/recovery/status", requireAuth, async (req, res) => {
    setCors(req, res);
    try {
      const auth = (req as any).auth as { accountId: string; email: string };
      const requests = await storage.getRecoveryRequestsByAccountId(auth.accountId);
      res.json({ requests });
    } catch (err) {
      console.error("Recovery status error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === ADMIN: DEVICE RECOVERY MANAGEMENT ===
  
  app.get("/api/admin/recovery-requests", async (req, res) => {
    try {
      const requests = await storage.getPendingRecoveryRequests();
      
      // Enrich with account info
      const enrichedRequests = await Promise.all(requests.map(async (req) => {
        const account = await storage.getAccountById(req.accountId);
        return {
          ...req,
          email: account?.email || 'Unknown',
          deviceChangeCount: account?.deviceChangeCount || 0,
        };
      }));
      
      res.json(enrichedRequests);
    } catch (err) {
      console.error("Admin recovery requests error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/recovery-requests/:requestId/resolve", async (req, res) => {
    try {
      const { requestId } = req.params;
      const { status, adminNotes } = z.object({
        status: z.enum(['approved', 'rejected']),
        adminNotes: z.string().optional(),
      }).parse(req.body);
      
      await storage.resolveDeviceRecoveryRequest(
        requestId,
        status,
        adminNotes || '',
        'admin' // TODO: Get actual admin user
      );
      
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Admin resolve recovery error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === ADMIN: SUBSCRIPTION STATS ===
  
  app.get("/api/admin/subscription-stats", async (req, res) => {
    try {
      const stats = await storage.getSubscriptionStats();
      res.json(stats);
    } catch (err) {
      console.error("Subscription stats error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === ADMIN: PAYMENTS ===
  
  app.get("/api/admin/payments", async (req, res) => {
    try {
      const { accountId, deviceId } = req.query as { accountId?: string; deviceId?: string };
      
      let payments: any[] = [];
      
      if (accountId) {
        payments = await storage.getPaymentsByAccountId(accountId);
      } else if (deviceId) {
        const license = await storage.getLicenseForHost(deviceId);
        if (license) {
          const subscription = await storage.getSubscriptionByLicenseId(license.id);
          if (subscription) {
            payments = await storage.getPaymentsBySubscriptionId(subscription.id);
          }
        }
      } else {
        // Get all subscriptions and their payments
        const subscriptions = await storage.listSubscriptions();
        for (const sub of subscriptions) {
          const subPayments = await storage.getPaymentsBySubscriptionId(sub.id);
          payments.push(...subPayments);
        }
      }
      
      // Calculate LTV per account
      const ltvByAccount: Record<string, number> = {};
      for (const payment of payments) {
        if (payment.status === 'captured') {
          ltvByAccount[payment.accountId] = (ltvByAccount[payment.accountId] || 0) + payment.amount;
        }
      }
      
      res.json({ payments, ltvByAccount });
    } catch (err) {
      console.error("Admin payments error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === TUNNEL PROVISIONING (Remote Access) — keyed by hostId, no account auth ===

  const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;
  function validateHostId(hostId: unknown): hostId is string {
    return typeof hostId === "string" && HOST_ID_REGEX.test(hostId);
  }

  app.post("/api/v1/tunnel/provision", async (req, res) => {
    try {
      const hostId = req.body?.hostId;
      if (!validateHostId(hostId)) {
        return res.status(400).json({ message: "Invalid hostId" });
      }
      const existing = await db.select().from(tunnels).where(eq(tunnels.hostId, hostId)).limit(1);
      if (existing.length > 0) {
        const t = existing[0];
        return res.json({
          tunnelId: t.tunnelId,
          tunnelName: t.tunnelName,
          subdomain: t.subdomain,
          publicUrl: t.publicUrl,
          credentialsJson: t.credentialsJson,
          alreadyExisted: true,
        });
      }

      const tunnelBaseDomain = process.env.CLOUDFLARE_TUNNEL_BASE_DOMAIN;
      const accountIdEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
      const zoneId = process.env.CLOUDFLARE_ZONE_ID;
      if (!tunnelBaseDomain || !accountIdEnv || !zoneId || !process.env.CLOUDFLARE_API_TOKEN) {
        return res.status(503).json({ message: "Cloudflare tunnel not configured" });
      }

      const short = hostId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
      const tunnelName = `jc-${short}`;
      const subdomain = short + "-share." + tunnelBaseDomain;

      const tunnelSecret = crypto.randomBytes(32).toString("base64");
      const cfTunnel = await cfRequest<{ id: string }>(
        "POST",
        `/accounts/${accountIdEnv}/cfd_tunnel`,
        { name: tunnelName, tunnel_secret: tunnelSecret }
      );

      await cfRequest("POST", `/zones/${zoneId}/dns_records`, {
        type: "CNAME",
        name: short + "-share",
        content: `${cfTunnel.id}.cfargotunnel.com`,
        proxied: true,
        ttl: 1,
      });

      const credentialsJson = JSON.stringify({
        AccountTag: accountIdEnv,
        TunnelSecret: tunnelSecret,
        TunnelID: cfTunnel.id,
      });

      const now = new Date().toISOString();
      await db.insert(tunnels).values({
        id: crypto.randomUUID(),
        hostId,
        tunnelId: cfTunnel.id,
        tunnelName,
        subdomain,
        publicUrl: `https://${subdomain}`,
        credentialsJson,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      return res.json({
        tunnelId: cfTunnel.id,
        tunnelName,
        subdomain,
        publicUrl: `https://${subdomain}`,
        credentialsJson,
        alreadyExisted: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cloudflare API error";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/v1/tunnel/status", async (req, res) => {
    try {
      const hostId = req.query?.hostId;
      if (!validateHostId(hostId)) {
        return res.status(400).json({ message: "Invalid hostId" });
      }
      const rows = await db.select().from(tunnels).where(eq(tunnels.hostId, hostId)).limit(1);
      if (rows.length === 0) {
        return res.json({ provisioned: false });
      }
      const t = rows[0];
      return res.json({
        provisioned: true,
        tunnelId: t.tunnelId,
        tunnelName: t.tunnelName,
        subdomain: t.subdomain,
        publicUrl: t.publicUrl,
        status: t.status,
      });
    } catch (_) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.delete("/api/v1/tunnel", async (req, res) => {
    try {
      const hostId = req.body?.hostId;
      if (!validateHostId(hostId)) {
        return res.status(400).json({ message: "Invalid hostId" });
      }
      const rows = await db.select().from(tunnels).where(eq(tunnels.hostId, hostId)).limit(1);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Tunnel not found" });
      }
      const tunnel = rows[0];
      const accountIdEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
      const zoneId = process.env.CLOUDFLARE_ZONE_ID;
      if (!accountIdEnv || !zoneId) {
        return res.status(503).json({ message: "Cloudflare not configured" });
      }

      await cfRequest(
        "DELETE",
        `/accounts/${accountIdEnv}/cfd_tunnel/${tunnel.tunnelId}`
      );

      const records = await cfRequest<Array<{ id: string }>>(
        "GET",
        `/zones/${zoneId}/dns_records?name=${encodeURIComponent(tunnel.subdomain)}`
      );
      if (Array.isArray(records) && records.length > 0) {
        await cfRequest("DELETE", `/zones/${zoneId}/dns_records/${records[0].id}`);
      }

      await db.delete(tunnels).where(eq(tunnels.id, tunnel.id));
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cloudflare API error";
      return res.status(502).json({ message });
    }
  });

  // === PUBLIC SHARE LINK REGISTRATION (no auth; desktop app calls with hostId) ===

  const SHARE_ID_REGEX = /^[a-zA-Z0-9]{10,60}$/;
  function validateShareRegisterBody(body: unknown): { hostId: string; tunnelUrl: string; shareId: string; expiresAt: string } | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const hostId = b.hostId;
    const tunnelUrl = b.tunnelUrl;
    const shareId = b.shareId;
    const expiresAt = b.expiresAt;
    if (!validateHostId(hostId)) return null;
    if (typeof tunnelUrl !== "string" || !tunnelUrl.startsWith("https://")) return null;
    if (typeof shareId !== "string" || !SHARE_ID_REGEX.test(shareId)) return null;
    if (typeof expiresAt !== "string") return null;
    const expDate = new Date(expiresAt);
    if (Number.isNaN(expDate.getTime())) return null;
    return { hostId, tunnelUrl, shareId, expiresAt };
  }

  app.post("/api/v1/share/register", async (req, res) => {
    try {
      const parsed = validateShareRegisterBody(req.body);
      if (!parsed) {
        return res.status(400).json({ message: "Invalid body: hostId (8-128 alphanumeric+_-), tunnelUrl (https://...), shareId (10-60 alphanumeric), expiresAt (ISO date)" });
      }
      const { hostId, tunnelUrl, shareId, expiresAt } = parsed;

      const existing = await db.select().from(publicShareLinks).where(eq(publicShareLinks.shareId, shareId)).limit(1);
      if (existing.length > 0) {
        const shortId = existing[0].shortId;
        return res.json({
          shortId,
          publicUrl: `https://go.joincloud.cloud/s/${shortId}`,
        });
      }

      const shortId = crypto.randomBytes(6).toString("base64url");
      const now = new Date().toISOString();
      await db.insert(publicShareLinks).values({
        id: crypto.randomUUID(),
        shortId,
        tunnelUrl,
        shareId,
        hostId,
        expiresAt,
        createdAt: now,
      });

      return res.json({
        shortId,
        publicUrl: `https://go.joincloud.cloud/s/${shortId}`,
      });
    } catch (err) {
      console.error("Share register error:", err);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === PUBLIC SHARE RESOLVE (USED BY CLOUDFLARE WORKER ONLY) ===

  app.get("/api/v1/share/resolve/:shortId", async (req, res) => {
    try {
      const workerSecret = process.env.WORKER_SECRET;
      const headerSecret = req.headers["x-worker-secret"];
      if (!workerSecret || headerSecret !== workerSecret) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const shortId = req.params.shortId;
      const rows = await db.select().from(publicShareLinks).where(eq(publicShareLinks.shortId, shortId)).limit(1);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Share not found or expired" });
      }
      const shareLink = rows[0];
      const expiresAtMs = new Date(shareLink.expiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
        return res.status(410).json({ message: "Share link expired" });
      }

      const signingSecret = process.env.SIGNING_SECRET;
      if (!signingSecret) {
        return res.status(503).json({ message: "Signing secret not configured" });
      }

      const exp = Math.floor(Date.now() / 1000) + 300;
      const payload = `${shareLink.shareId}:${exp}`;
      const token = crypto.createHmac("sha256", signingSecret).update(payload).digest("base64url");

      return res.json({
        tunnelUrl: shareLink.tunnelUrl,
        shareId: shareLink.shareId,
        token,
        exp,
      });
    } catch (err) {
      console.error("Share resolve error:", err);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === SHORT LINK REDIRECT (GET /s/:shortId) — HTML responses for browser visits ===

  app.get("/s/:shortId", async (req, res) => {
    try {
      const shortId = req.params.shortId;
      const rows = await db.select().from(publicShareLinks).where(eq(publicShareLinks.shortId, shortId)).limit(1);
      if (rows.length === 0) {
        res.status(404).setHeader("Content-Type", "text/html").send("<h2>Share link not found or expired</h2>");
        return;
      }
      const shareLink = rows[0];
      const expiresAtMs = new Date(shareLink.expiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
        res.status(410).setHeader("Content-Type", "text/html").send("<h2>This share link has expired</h2>");
        return;
      }
      const signingSecret = process.env.SIGNING_SECRET;
      if (!signingSecret) {
        res.status(503).setHeader("Content-Type", "text/html").send("<h2>Service temporarily unavailable</h2>");
        return;
      }
      const exp = Math.floor(Date.now() / 1000) + 300;
      const payload = `${shareLink.shareId}:${exp}`;
      const token = crypto.createHmac("sha256", signingSecret).update(payload).digest("base64url");
      const redirectUrl = `${shareLink.tunnelUrl}/share/${shareLink.shareId}?token=${token}&exp=${exp}`;
      res.redirect(302, redirectUrl);
    } catch (err) {
      console.error("Short link redirect error:", err);
      res.status(500).setHeader("Content-Type", "text/html").send("<h2>Something went wrong</h2>");
    }
  });

  // === ADMIN: PANEL USER MANAGEMENT (super_admin only) ===

  app.get("/api/admin/panel-users", requireRole("super_admin"), async (req, res) => {
    try {
      const adminAccounts = await storage.listAdminPanelAccounts();
      res.json(adminAccounts.map(a => ({
        id: a.id,
        email: a.email,
        adminRole: a.adminRole,
        createdAt: a.createdAt,
      })));
    } catch (err) {
      console.error("Panel users error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/api/admin/panel-users/:accountId/role", requireRole("super_admin"), async (req, res) => {
    try {
      const { accountId } = req.params;
      const { role } = z.object({
        role: z.enum(["user", "admin", "super_admin"]).nullable(),
      }).parse(req.body);
      const account = await storage.getAccountById(accountId);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      // Prevent downgrading the primary super_admin (env-configured)
      if (account.email.toLowerCase() === SUPER_ADMIN_EMAIL && role !== "super_admin") {
        res.status(403).json({ message: "Cannot change role of the primary super admin" });
        return;
      }
      await storage.updateAccountAdminRole(accountId, role);
      const admin = (req as any).admin as { email: string };
      console.log(`[AUTH] Role change: ${account.email} → ${role ?? "none"} by ${admin?.email}`);
      res.json({ id: accountId, adminRole: role });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Panel user role error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Add a new admin user by email (super_admin only)
  app.post("/api/admin/panel-users", requireRole("super_admin"), async (req, res) => {
    try {
      const { email, role } = z.object({
        email: z.string().email(),
        role: z.enum(["user", "admin"]),
      }).parse(req.body);
      let account = await storage.getAccountByEmail(email);
      if (!account) {
        // Pre-register the account so it's ready when they log in via Google
        const id = crypto.randomUUID();
        account = await storage.createAccount(id, email, ".");
      }
      await storage.updateAccountAdminRole(account.id, role);
      const admin = (req as any).admin as { email: string };
      console.log(`[AUTH] Admin added: ${email} as '${role}' by ${admin?.email}`);
      res.json({ id: account.id, email: account.email, adminRole: role });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
        return;
      }
      console.error("Add panel user error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // === RETENTION CLEANUP ===
  
  // Periodically enforce retention (once a day)
  setInterval(() => {
    storage.enforceRetention().catch(console.error);
  }, 24 * 60 * 60 * 1000);

  return httpServer;
}
