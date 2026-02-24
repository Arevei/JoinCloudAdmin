import { pgTable, text, integer, timestamp, date, serial, primaryKey, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const users = pgTable("users", {
  userId: text("user_id").primaryKey(),
  firstSeen: text("first_seen"),
  lastSeen: text("last_seen"),
  appVersion: text("app_version"),
  os: text("os"),
});

export const dailyMetrics = pgTable("daily_metrics", {
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  uptimeSeconds: integer("uptime_seconds").default(0).notNull(),
  filesUploaded: integer("files_uploaded").default(0).notNull(),
  filesDownloaded: integer("files_downloaded").default(0).notNull(),
  bytesUploaded: integer("bytes_uploaded").default(0).notNull(),
  bytesDownloaded: integer("bytes_downloaded").default(0).notNull(),
  sharesCreated: integer("shares_created").default(0).notNull(),
  publicShares: integer("public_shares").default(0).notNull(),
  lanShares: integer("lan_shares").default(0).notNull(),
  networkVisibilityEnabled: boolean("network_visibility_enabled").default(true),
  networkPeersDetected: integer("network_peers_detected").default(0),
  displayNameCustomized: boolean("display_name_customized").default(false),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.date] }),
}));

// === SCHEMAS ===

// Telemetry payload - all Phase 3 fields are optional for backward compatibility
export const telemetryPayloadSchema = z.object({
  user_id: z.string(),
  date: z.string(),
  app_version: z.string(),
  os: z.string(),
  uptime_seconds: z.number().int().nonnegative(),
  metrics: z.object({
    files_uploaded: z.number().int().nonnegative(),
    files_downloaded: z.number().int().nonnegative(),
    bytes_uploaded: z.number().int().nonnegative(),
    bytes_downloaded: z.number().int().nonnegative(),
    shares_created: z.number().int().nonnegative(),
    public_shares: z.number().int().nonnegative(),
    lan_shares: z.number().int().nonnegative(),
  }),
  network_visibility_enabled: z.boolean().optional(),
  network_peers_detected: z.number().int().nonnegative().optional(),
  display_name_customized: z.boolean().optional(),
});

// Network presence analytics (legacy; replaced by advancedTelemetry in dashboard)
export const networkPresenceStatsSchema = z.object({
  peerDetectionRate: z.number(),
  avgPeersPerUser: z.number(),
  visibilityOnRate: z.number(),
  visibilityOffRate: z.number(),
  avgUptimeVisibilityOn: z.number(),
  avgUptimeVisibilityOff: z.number(),
  displayNameCustomizationRate: z.number(),
});

// Advanced telemetry for dashboard (app health, reporting devices)
export const advancedTelemetryStatsSchema = z.object({
  devicesReportingLast1h: z.number(),
  devicesReportingLast24h: z.number(),
  devicesReportingLast7d: z.number(),
  totalUploadBytes7d: z.number(),
  totalDownloadBytes7d: z.number(),
  totalFilesUploaded7d: z.number(),
  totalFilesDownloaded7d: z.number(),
  topVersions: z.array(z.object({ version: z.string(), count: z.number() })),
  topPlatforms: z.array(z.object({ platform: z.string(), count: z.number() })),
});

export const dashboardStatsSchema = z.object({
  totalUsers: z.number(),
  activeUsers7d: z.number(),
  avgDailyUptimeSeconds: z.number(),
  totalDataProcessedBytes: z.number(),
  totalShares: z.number(),
  uploadBandwidthBytes: z.number(),
  downloadBandwidthBytes: z.number(),
  versionDistribution: z.record(z.string(), z.number()),
  osDistribution: z.record(z.string(), z.number()),
  dailyActivity: z.array(z.object({
    date: z.string(),
    activeUsers: z.number(),
    filesUploaded: z.number(),
    filesDownloaded: z.number(),
    sharesCreated: z.number(),
    avgUptimeHours: z.number(),
    dataProcessedBytes: z.number(),
    uploadBytes: z.number(),
    downloadBytes: z.number(),
  })),
  networkPresence: networkPresenceStatsSchema.optional(),
  advancedTelemetry: advancedTelemetryStatsSchema.optional(),
});

// === PHASE 1: CONTROL PLANE SCHEMAS ===

// Host registration payload
export const hostRegisterPayloadSchema = z.object({
  host_uuid: z.string().min(8).max(128),
  installation_id: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
  platform: z.string().min(1).max(64),
  arch: z.string().min(1).max(64),
  first_installed_at: z.number().int().positive(),
});

// Host heartbeat payload
export const hostHeartbeatPayloadSchema = z.object({
  host_uuid: z.string().min(8).max(128),
  version: z.string().min(1).max(64),
  uptime_seconds: z.number().int().nonnegative(),
});

// Host record (admin view)
export const hostSchema = z.object({
  id: z.number(),
  hostUUID: z.string(),
  installationId: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  firstInstalledAt: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  trialStartAt: z.string().nullable(),
  registrationStatus: z.string(),
  isOnline: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Heartbeat payload (legacy device heartbeat)
export const heartbeatPayloadSchema = z.object({
  deviceUUID: z.string().min(1),
  uptimeSeconds: z.number().int().nonnegative(),
  backendHealthy: z.boolean(),
  appVersion: z.string(),
  platform: z.string().optional(), // e.g. "Windows", "macOS", "Linux"
});

// Health response
export const healthResponseSchema = z.object({
  reachable: z.literal(true),
  serverTime: z.string(),
  adminVersion: z.string(),
});

// Support message
export const supportMessageSchema = z.object({
  id: z.number(),
  threadId: z.number(),
  sender: z.enum(['device', 'admin', 'user']),
  text: z.string(),
  timestamp: z.string(),
});

// Support thread
export const supportThreadSchema = z.object({
  id: z.number(),
  deviceUUID: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(supportMessageSchema),
});

// New message payload
export const newMessagePayloadSchema = z.object({
  text: z.string().min(1).max(5000),
  sender: z.enum(['device', 'admin', 'user']).default('device'),
});

// Log entry
export const logEntrySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  timestamp: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

// Logs batch payload
export const logsBatchPayloadSchema = z.object({
  deviceUUID: z.string().min(1),
  logs: z.array(logEntrySchema).min(1).max(100),
});

// Device info (extended from user)
export const deviceSchema = z.object({
  deviceUUID: z.string(),
  deviceIndex: z.number(),
  platform: z.string(),
  appVersion: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  lastHeartbeat: z.string().nullable(),
  isOnline: z.boolean(),
});

// === PHASE 2: AUTH & LICENSING ===

export const authRegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const authLoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1),
});

export const licenseActivateSchema = z.object({
  host_uuid: z.string().min(8).max(128),
  installation_id: z.string().max(128).optional(),
});

export const usageReportSchema = z.object({
  host_uuid: z.string().min(8).max(128),
  aggregates: z.array(z.object({
    period_start: z.string(),
    period_end: z.string(),
    uptime_seconds: z.number().int().nonnegative().default(0),
    storage_used_bytes: z.number().int().nonnegative().default(0),
    bytes_uploaded: z.number().int().nonnegative().default(0),
    bytes_downloaded: z.number().int().nonnegative().default(0),
    total_shares: z.number().int().nonnegative().default(0),
    total_devices: z.number().int().nonnegative().default(0),
  })).min(1).max(100),
});

// License payload signed by server (client stores and sends for validate)
export const signedLicensePayloadSchema = z.object({
  license_id: z.string(),
  account_id: z.string(),
  tier: z.string(),
  device_limit: z.number().int().nonnegative(),
  issued_at: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative(),
  state: z.enum(['trial_active', 'active', 'grace', 'expired', 'revoked']),
  grace_ends_at: z.number().int().nonnegative().optional(),
  features: z.record(z.boolean()).optional(),
  custom_quota: z.number().int().positive().optional(),
  signature: z.string(),
});

// === EXPORTED TYPES ===
export type User = typeof users.$inferSelect;
export type DailyMetric = typeof dailyMetrics.$inferSelect;
export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;
export type NetworkPresenceStats = z.infer<typeof networkPresenceStatsSchema>;

// Phase 1 types
export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type SupportMessage = z.infer<typeof supportMessageSchema>;
export type SupportThread = z.infer<typeof supportThreadSchema>;
export type NewMessagePayload = z.infer<typeof newMessagePayloadSchema>;
export type LogEntry = z.infer<typeof logEntrySchema>;
export type LogsBatchPayload = z.infer<typeof logsBatchPayloadSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type HostRegisterPayload = z.infer<typeof hostRegisterPayloadSchema>;
export type HostHeartbeatPayload = z.infer<typeof hostHeartbeatPayloadSchema>;
export type Host = z.infer<typeof hostSchema>;

// Phase 2 types
export type AuthRegisterPayload = z.infer<typeof authRegisterSchema>;
export type AuthLoginPayload = z.infer<typeof authLoginSchema>;
export type LicenseActivatePayload = z.infer<typeof licenseActivateSchema>;
export type UsageReportPayload = z.infer<typeof usageReportSchema>;
export type SignedLicensePayload = z.infer<typeof signedLicensePayloadSchema>;
