import {
  pgTable,
  text,
  integer,
  serial,
  primaryKey,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TELEMETRY TABLES ===

export const users = pgTable("users", {
  userId: text("user_id").primaryKey(),
  deviceIndex: integer("device_index"),
  firstSeen: text("first_seen"),
  lastSeen: text("last_seen"),
  lastHeartbeat: text("last_heartbeat"),
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

// === SUPPORT TABLES ===

export const supportThreads = pgTable("support_threads", {
  id: serial("id").primaryKey(),
  deviceUuid: text("device_uuid").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => supportThreads.id),
  sender: text("sender").notNull(),
  text: text("text").notNull(),
  timestamp: text("timestamp").notNull(),
});

// === HOST TABLES ===

export const hosts = pgTable("hosts", {
  id: serial("id").primaryKey(),
  hostUuid: text("host_uuid").notNull().unique(),
  installationId: text("installation_id").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  firstInstalledAt: text("first_installed_at").notNull(),
  version: text("version").notNull(),
  platform: text("platform").notNull(),
  arch: text("arch").notNull(),
  trialStartAt: text("trial_start_at"),
  trialEndsAt: text("trial_ends_at"),
  trialExtendedAt: text("trial_extended_at"),
  registrationStatus: text("registration_status").notNull().default("registered"),
  suspended: integer("suspended").default(0),
  suspensionReason: text("suspension_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  hostUuidIdx: index("idx_hosts_host_uuid").on(table.hostUuid),
  lastSeenIdx: index("idx_hosts_last_seen").on(table.lastSeenAt),
}));

export const deviceLogs = pgTable("device_logs", {
  id: serial("id").primaryKey(),
  deviceUuid: text("device_uuid").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  context: text("context"),
  timestamp: text("timestamp").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => ({
  expiresIdx: index("idx_device_logs_expires").on(table.expiresAt),
}));

// === DEVICE TRIAL & USAGE TABLES ===

export const deviceTrials = pgTable("device_trials", {
  deviceId: text("device_id").primaryKey(),
  trialStartedAt: text("trial_started_at").notNull(),
  trialEndsAt: text("trial_ends_at").notNull(),
  trialExtendedAt: text("trial_extended_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const deviceUsageMonthly = pgTable("device_usage_monthly", {
  deviceId: text("device_id").notNull(),
  ym: text("ym").notNull(),
  sharesCreated: integer("shares_created").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.deviceId, table.ym] }),
}));

export const deviceTrialUsed = pgTable("device_trial_used", {
  hostUuid: text("host_uuid").primaryKey(),
});

export const deviceLogoutRequests = pgTable("device_logout_requests", {
  hostUuid: text("host_uuid").primaryKey(),
  requestedAt: text("requested_at").notNull(),
});

// === ACCOUNT & LICENSE TABLES ===

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  trialUsed: integer("trial_used").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionId: text("subscription_id"),
  subscriptionStatus: text("subscription_status"),
  renewalAt: text("renewal_at"),
  graceEndsAt: text("grace_ends_at"),
  razorpayCustomerId: text("razorpay_customer_id"),
  razorpaySubscriptionId: text("razorpay_subscription_id"),
  username: text("username"),
  referralCode: text("referral_code").unique(),
  referredBy: text("referred_by"),
  referralCount: integer("referral_count").default(0),
  referralDaysEarned: integer("referral_days_earned").default(0),
  deviceChangeCount: integer("device_change_count").default(0),
  lastDeviceChangeAt: text("last_device_change_at"),
}, (table) => ({
  referralCodeIdx: index("idx_accounts_referral_code").on(table.referralCode),
}));

export const licenses = pgTable("licenses", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  tier: text("tier").notNull(),
  deviceLimit: integer("device_limit").notNull(),
  issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  state: text("state").notNull(),
  signature: text("signature").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  planInterval: text("plan_interval"),
  graceEndsAt: integer("grace_ends_at"),
  renewalAt: integer("renewal_at"),
  customQuota: integer("custom_quota"),
  userLimit: integer("user_limit"),
  teamLimit: integer("team_limit"),
  shareLimitMonthly: integer("share_limit_monthly"),
  devicesPerUser: integer("devices_per_user"),
  overridesJson: text("overrides_json"),
  paymentMethod: text("payment_method"),
  amountPaid: integer("amount_paid"),
  currency: text("currency").default("INR"),
  paymentProvider: text("payment_provider"),
  invoiceId: text("invoice_id"),
  discountPercent: integer("discount_percent").default(0),
  notes: text("notes"),
  isDeviceOnly: integer("is_device_only").default(0),
});

export const licenseHosts = pgTable("license_hosts", {
  id: serial("id").primaryKey(),
  licenseId: text("license_id").notNull().references(() => licenses.id),
  hostUuid: text("host_uuid").notNull(),
  activatedAt: text("activated_at").notNull(),
}, (table) => ({
  licenseIdx: index("idx_license_hosts_license").on(table.licenseId),
  hostIdx: index("idx_license_hosts_host").on(table.hostUuid),
  uniqueLicenseHost: uniqueIndex("uq_license_hosts").on(table.licenseId, table.hostUuid),
}));

export const licenseMembers = pgTable("license_members", {
  licenseId: text("license_id").notNull().references(() => licenses.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  role: text("role").notNull().default("member"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.licenseId, table.accountId] }),
  licenseIdx: index("idx_license_members_license").on(table.licenseId),
  accountIdx: index("idx_license_members_account").on(table.accountId),
}));

export const teamInvitations = pgTable("team_invitations", {
  id: serial("id").primaryKey(),
  licenseId: text("license_id").notNull().references(() => licenses.id),
  email: text("email").notNull(),
  invitedBy: text("invited_by").notNull().references(() => accounts.id),
  invitedAt: text("invited_at").notNull(),
  status: text("status").notNull().default("pending"),
}, (table) => ({
  emailIdx: index("idx_team_invitations_email").on(table.email),
  licenseIdx: index("idx_team_invitations_license").on(table.licenseId),
  uniqueLicenseEmail: uniqueIndex("uq_team_invitations").on(table.licenseId, table.email),
}));

export const usageAggregates = pgTable("usage_aggregates", {
  id: serial("id").primaryKey(),
  hostUuid: text("host_uuid").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  uptimeSeconds: integer("uptime_seconds").notNull().default(0),
  storageUsedBytes: integer("storage_used_bytes").notNull().default(0),
  bytesUploaded: integer("bytes_uploaded").notNull().default(0),
  bytesDownloaded: integer("bytes_downloaded").notNull().default(0),
  totalShares: integer("total_shares").notNull().default(0),
  totalDevices: integer("total_devices").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  hostIdx: index("idx_usage_aggregates_host").on(table.hostUuid),
  uniqueHostPeriod: uniqueIndex("uq_usage_aggregates").on(table.hostUuid, table.periodStart),
}));

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// === SUBSCRIPTION & BILLING TABLES ===

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  licenseId: text("license_id").references(() => licenses.id),
  provider: text("provider").notNull(),
  providerSubscriptionId: text("provider_subscription_id"),
  plan: text("plan").notNull(),
  status: text("status").notNull().default("active"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  interval: text("interval").notNull().default("month"),
  currentPeriodStart: integer("current_period_start"),
  currentPeriodEnd: integer("current_period_end"),
  paymentDueDate: integer("payment_due_date"),
  graceEndsAt: integer("grace_ends_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  accountIdx: index("idx_subscriptions_account").on(table.accountId),
  licenseIdx: index("idx_subscriptions_license").on(table.licenseId),
  statusIdx: index("idx_subscriptions_status").on(table.status),
}));

export const subscriptionRequests = pgTable("subscription_requests", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  planId: text("plan_id").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  accountId: text("account_id").references(() => accounts.id),
  deviceId: text("device_id"),
  customUsers: integer("custom_users"),
  customDevices: integer("custom_devices"),
  notes: text("notes"),
  licenseId: text("license_id").references(() => licenses.id),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  statusIdx: index("idx_subscription_requests_status").on(table.status),
  accountIdx: index("idx_subscription_requests_account").on(table.accountId),
}));

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").references(() => subscriptions.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  deviceId: text("device_id"),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("pending"),
  invoiceUrl: text("invoice_url"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  accountIdx: index("idx_payments_account").on(table.accountId),
  subscriptionIdx: index("idx_payments_subscription").on(table.subscriptionId),
  statusIdx: index("idx_payments_status").on(table.status),
}));

export const deviceRecoveryRequests = pgTable("device_recovery_requests", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  oldDeviceId: text("old_device_id").notNull(),
  newDeviceId: text("new_device_id").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  adminNotes: text("admin_notes"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
}, (table) => ({
  accountIdx: index("idx_recovery_account").on(table.accountId),
  statusIdx: index("idx_recovery_status").on(table.status),
}));

export const referrals = pgTable("referrals", {
  id: text("id").primaryKey(),
  referrerAccountId: text("referrer_account_id").notNull().references(() => accounts.id),
  referredAccountId: text("referred_account_id").notNull().references(() => accounts.id),
  referralCode: text("referral_code").notNull(),
  daysGranted: integer("days_granted").notNull().default(10),
  status: text("status").notNull().default("completed"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  referrerIdx: index("idx_referrals_referrer").on(table.referrerAccountId),
  referredIdx: index("idx_referrals_referred").on(table.referredAccountId),
}));

// === ZOD SCHEMAS ===

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

export const networkPresenceStatsSchema = z.object({
  peerDetectionRate: z.number(),
  avgPeersPerUser: z.number(),
  visibilityOnRate: z.number(),
  visibilityOffRate: z.number(),
  avgUptimeVisibilityOn: z.number(),
  avgUptimeVisibilityOff: z.number(),
  displayNameCustomizationRate: z.number(),
});

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
  versionDistribution: z.record(z.number()),
  osDistribution: z.record(z.number()),
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
  advancedTelemetry: advancedTelemetryStatsSchema,
});

export const heartbeatPayloadSchema = z.object({
  deviceUUID: z.string(),
  appVersion: z.string(),
  platform: z.string().optional(),
});

export const logEntrySchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
  timestamp: z.string().optional(),
});

export const logsBatchPayloadSchema = z.object({
  deviceUUID: z.string(),
  logs: z.array(logEntrySchema),
});

export const supportMessageSchema = z.object({
  id: z.number(),
  threadId: z.number(),
  sender: z.enum(["device", "admin", "user"]),
  text: z.string(),
  timestamp: z.string(),
});

export const supportThreadSchema = z.object({
  id: z.number(),
  deviceUUID: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(supportMessageSchema),
});

export const deviceSchema = z.object({
  deviceUUID: z.string(),
  deviceIndex: z.number(),
  platform: z.string(),
  appVersion: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  lastHeartbeat: z.string().nullable().optional(),
  isOnline: z.boolean(),
});

export const hostRegisterPayloadSchema = z.object({
  host_uuid: z.string(),
  installation_id: z.string(),
  first_installed_at: z.number(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
});

export const hostHeartbeatPayloadSchema = z.object({
  host_uuid: z.string(),
  version: z.string(),
});

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

// === INFERRED TYPES ===

export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;
export type NetworkPresenceStats = z.infer<typeof networkPresenceStatsSchema>;
export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
export type SupportMessage = z.infer<typeof supportMessageSchema>;
export type SupportThread = z.infer<typeof supportThreadSchema>;
export type LogsBatchPayload = z.infer<typeof logsBatchPayloadSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type HostRegisterPayload = z.infer<typeof hostRegisterPayloadSchema>;
export type HostHeartbeatPayload = z.infer<typeof hostHeartbeatPayloadSchema>;
export type Host = z.infer<typeof hostSchema>;

// === ADDITIONAL SCHEMAS USED BY ROUTES ===

export const newMessagePayloadSchema = z.object({
  text: z.string().min(1),
  sender: z.enum(["device", "admin", "user"]).optional().default("admin"),
});

export const authRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  referralCode: z.string().optional(),
});

export const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const licenseActivateSchema = z.object({
  licenseKey: z.string().optional(),
  license_id: z.string().optional(),
  host_uuid: z.string(),
  device_id: z.string().optional(),
});

export const usageReportSchema = z.object({
  host_uuid: z.string(),
  aggregates: z.array(z.object({
    period_start: z.string(),
    period_end: z.string(),
    uptime_seconds: z.number().int().nonnegative(),
    storage_used_bytes: z.number().int().nonnegative(),
    bytes_uploaded: z.number().int().nonnegative(),
    bytes_downloaded: z.number().int().nonnegative(),
    total_shares: z.number().int().nonnegative(),
    total_devices: z.number().int().nonnegative(),
  })),
});

export const signedLicensePayloadSchema = z.object({
  license_id: z.string(),
  account_id: z.string().default(""),
  tier: z.string(),
  device_limit: z.number().default(0),
  issued_at: z.number().default(0),
  expires_at: z.number().default(0),
  state: z.string().default(""),
  grace_ends_at: z.number().optional().nullable(),
  features: z.record(z.boolean()).optional(),
  custom_quota: z.number().optional().nullable(),
  signature: z.string().default(""),
  host_uuid: z.string().optional(),
});
