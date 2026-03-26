import { eq, and, sql, desc, asc, lt, gte, or, inArray, max } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  dailyMetrics,
  supportThreads,
  supportMessages,
  hosts,
  deviceLogs,
  deviceTrials,
  deviceUsageMonthly,
  deviceTrialUsed,
  deviceLogoutRequests,
  accounts,
  licenses,
  licenseHosts,
  licenseMembers,
  teamInvitations,
  usageAggregates,
  appSettings,
  updateManifestEntries,
  subscriptions,
  subscriptionRequests,
  payments,
  deviceRecoveryRequests,
  referrals,
  type TelemetryPayload,
  type DashboardStats,
  type NetworkPresenceStats,
  type HeartbeatPayload,
  type SupportThread,
  type SupportMessage,
  type LogsBatchPayload,
  type Device,
  type HostRegisterPayload,
  type HostHeartbeatPayload,
  type Host,
  type UpdateManifestEntry,
} from "@shared/schema";

// === INTERFACES & TYPES ===

export interface UserStats {
  deviceUUID: string;
  deviceIndex: number;
  platform: string;
  appVersion: string;
  firstSeenAt: string;
  lastSeenAt: string;
  isOnline: boolean;
  totalUptimeSeconds: number;
  totalFilesUploaded: number;
  totalFilesDownloaded: number;
  totalSharesCreated: number;
  totalBytesUploaded: number;
  totalBytesDownloaded: number;
  lanShares: number;
  publicShares: number;
}

export interface LeaderboardEntry {
  deviceUUID: string;
  deviceIndex: number;
  platform: string;
  value: number;
}

export interface LeaderboardData {
  byUptime: LeaderboardEntry[];
  byFilesUploaded: LeaderboardEntry[];
  bySharesCreated: LeaderboardEntry[];
}

export interface SupportThreadPreview {
  deviceUUID: string;
  deviceIndex: number;
  lastMessageText: string;
  lastMessageSender: 'device' | 'admin';
  lastActivityAt: string;
  messageCount: number;
  hasUnread: boolean;
}

export interface Account {
  id: string;
  email: string;
  username?: string | null;
  trialUsed: boolean;
  createdAt: string;
  updatedAt: string;
  stripeCustomerId?: string | null;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  renewalAt?: string | null;
  graceEndsAt?: string | null;
  razorpayCustomerId?: string | null;
  razorpaySubscriptionId?: string | null;
  referralCode?: string | null;
  referredBy?: string | null;
  referralCount?: number;
  referralDaysEarned?: number;
  deviceChangeCount?: number;
  lastDeviceChangeAt?: string | null;
  adminRole?: string | null;
}

export interface License {
  id: string;
  accountId: string;
  tier: string;
  deviceLimit: number;
  issuedAt: number;
  expiresAt: number;
  state: string;
  signature: string;
  createdAt: string;
  updatedAt: string;
  planInterval?: string | null;
  graceEndsAt?: number | null;
  renewalAt?: number | null;
  customQuota?: number | null;
  paymentMethod?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
  paymentProvider?: string | null;
  invoiceId?: string | null;
  discountPercent?: number | null;
  notes?: string | null;
  shareLimitMonthly?: number | null;
  overridesJson?: string | null;
}

export interface TeamInvitation {
  id: number;
  licenseId: string;
  email: string;
  invitedBy: string;
  invitedAt: string;
  status: string;
}

export interface Subscription {
  id: string;
  accountId: string;
  licenseId: string | null;
  provider: string;
  providerSubscriptionId: string | null;
  plan: string;
  status: string;
  amount: number;
  currency: string;
  interval: string;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  paymentDueDate: number | null;
  graceEndsAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  subscriptionId: string | null;
  accountId: string;
  deviceId: string | null;
  provider: string;
  providerPaymentId: string | null;
  amount: number;
  currency: string;
  status: string;
  invoiceUrl: string | null;
  createdAt: string;
}

export interface DeviceRecoveryRequest {
  id: string;
  accountId: string;
  oldDeviceId: string;
  newDeviceId: string;
  reason: string | null;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface Referral {
  id: string;
  referrerAccountId: string;
  referredAccountId: string;
  referralCode: string;
  daysGranted: number;
  status: string;
  createdAt: string;
}

export interface ReferralStats {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  daysEarned: number;
  referrals: Array<{
    email: string;
    date: number;
    daysGranted: number;
  }>;
}

export interface LicenseCheckResponse {
  deviceId: string;
  license: {
    id: string | null;
    tier: string;
    state: string;
    expiresAt: number | null;
    daysRemaining: number | null;
    graceEndsAt: number | null;
    graceDaysRemaining: number | null;
  };
  account: {
    linked: boolean;
    email: string | null;
    hasPaymentMethod: boolean;
  };
  subscription: {
    active: boolean;
    status: string | null;
    renewalDate: number | null;
    paymentDueDate: number | null;
  } | null;
  ui: {
    primaryButton: {
      label: string;
      action: string;
      url: string;
    };
    secondaryButton: {
      label: string;
      action: string;
      url: string;
    } | null;
    showSignOut: boolean;
    bannerText: string;
    bannerStyle: string;
    isBlocked: boolean;
    blockingMessage: string | null;
  };
}

export interface SubscriptionStats {
  totalMonthlyRevenue: number;
  totalYearlyRevenue: number;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  trialUsers: number;
  churnRate: number;
  byCountry: Array<{ country: string; count: number; revenue: number }>;
  byPlan: Array<{ plan: string; count: number; revenue: number }>;
  byDevice: Array<{ platform: string; count: number }>;
}

export interface BillingSummary {
  totalMonthlyRevenue: number;
  totalYearlyRevenue: number;
  totalActiveSubscriptions: number;
  totalTrialAccounts: number;
  revenueByTier: { tier: string; monthly: number; yearly: number; count: number }[];
  revenueByProvider: { provider: string; amount: number; count: number }[];
}

export interface AccountWithBilling extends Account {
  license?: License | null;
  teamMembers?: Array<{ accountId: string; email: string; role: string }>;
  teamInvitations?: TeamInvitation[];
}

export interface LicenseHost {
  id: number;
  licenseId: string;
  hostUuid: string;
  activatedAt: string;
}

export interface UsageAggregate {
  id: number;
  hostUuid: string;
  periodStart: string;
  periodEnd: string;
  uptimeSeconds: number;
  storageUsedBytes: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  totalShares: number;
  totalDevices: number;
  createdAt: string;
}

export interface IStorage {
  ingestTelemetry(payload: TelemetryPayload): Promise<void>;
  getDashboardStats(): Promise<DashboardStats>;
  enforceRetention(): Promise<void>;
  recordHeartbeat(payload: HeartbeatPayload): Promise<void>;
  getDevices(): Promise<Device[]>;
  getDevicesWithAccountInfo(): Promise<Array<Device & { accountEmail: string | null; licenseId: string | null; tier: string | null }>>;
  getDevice(deviceUUID: string): Promise<Device | null>;
  getOrCreateThread(deviceUUID: string): Promise<SupportThread>;
  getThreadByDevice(deviceUUID: string): Promise<SupportThread | null>;
  getAllThreads(): Promise<SupportThread[]>;
  addMessage(deviceUUID: string, sender: 'device' | 'admin' | 'user', text: string): Promise<SupportMessage>;
  deleteThreadByDevice(deviceUUID: string): Promise<boolean>;
  ingestLogs(payload: LogsBatchPayload): Promise<void>;
  cleanupExpiredLogs(): Promise<void>;
  getUserStats(deviceUUID: string): Promise<UserStats | null>;
  getLeaderboard(): Promise<LeaderboardData>;
  getSupportThreadPreviews(): Promise<SupportThreadPreview[]>;
  registerHost(payload: HostRegisterPayload): Promise<Host>;
  hostHeartbeat(payload: HostHeartbeatPayload): Promise<void>;
  getHosts(filters?: { platform?: string; version?: string; search?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }): Promise<{ hosts: Host[]; total: number }>;
  getHostByUUID(hostUUID: string): Promise<Host | null>;
  createAccount(id: string, email: string, passwordHash: string): Promise<Account>;
  getAccountByEmail(email: string): Promise<Account | null>;
  getAccountById(id: string): Promise<Account | null>;
  getAccountByStripeCustomerId(stripeCustomerId: string): Promise<Account | null>;
  getAccountBySubscriptionId(subscriptionId: string): Promise<Account | null>;
  getAccountByRazorpayCustomerId(customerId: string): Promise<Account | null>;
  getAccountByRazorpaySubscriptionId(subscriptionId: string): Promise<Account | null>;
  updateAccountRazorpay(accountId: string, updates: { razorpayCustomerId?: string; razorpaySubscriptionId?: string; subscriptionStatus?: string; renewalAt?: string | null; graceEndsAt?: string | null }): Promise<void>;
  updateAccountUsername(accountId: string, username: string): Promise<void>;
  updateAccountPassword(accountId: string, passwordHash: string): Promise<void>;
  getPasswordHash(accountId: string): Promise<string | null>;
  setAccountTrialUsed(accountId: string): Promise<void>;
  createLicense(license: { id: string; accountId: string; tier: string; deviceLimit: number; issuedAt: number; expiresAt: number; state: string; signature: string; planInterval?: string; graceEndsAt?: number; renewalAt?: number; customQuota?: number }): Promise<License>;
  getNextLicenseId(): Promise<string>;
  updateLicense(licenseId: string, updates: { state?: string; expiresAt?: number; signature?: string; planInterval?: string; graceEndsAt?: number | null; renewalAt?: number | null; deviceLimit?: number; tier?: string; customQuota?: number | null }): Promise<void>;
  getActiveLicenseForAccount(accountId: string): Promise<License | null>;
  getLatestLicenseForAccount(accountId: string): Promise<License | null>;
  getLicenseById(licenseId: string): Promise<License | null>;
  getLicenseHostsCount(licenseId: string): Promise<number>;
  addLicenseHost(licenseId: string, hostUuid: string): Promise<void>;
  removeLicenseHost(licenseId: string, hostUuid: string): Promise<void>;
  ensureHostRow(hostUuid: string): Promise<void>;
  getLicenseForHost(hostUuid: string): Promise<License | null>;
  isHostInLicense(licenseId: string, hostUuid: string): Promise<boolean>;
  getHostsForLicense(licenseId: string): Promise<Array<{ host_uuid: string; activated_at: string; last_seen_at: string | null; isOnline: boolean }>>;
  getLicenseMembers(licenseId: string): Promise<Array<{ accountId: string; email: string; role: string }>>;
  addLicenseMember(licenseId: string, accountId: string): Promise<void>;
  removeLicenseMember(licenseId: string, accountId: string): Promise<void>;
  getTeamsLicenseUserCount(licenseId: string): Promise<number>;
  reportUsageAggregates(hostUuid: string, aggregates: Array<{ period_start: string; period_end: string; uptime_seconds: number; storage_used_bytes: number; bytes_uploaded: number; bytes_downloaded: number; total_shares: number; total_devices: number }>): Promise<void>;
  getUsageAggregates(filters?: { hostUuid?: string; limit?: number }): Promise<UsageAggregate[]>;
  listAccounts(): Promise<Account[]>;
  updateAccountAdminRole(accountId: string, role: string | null): Promise<void>;
  listAdminPanelAccounts(): Promise<Account[]>;
  updateAccountSubscription(accountId: string, updates: { stripeCustomerId?: string; subscriptionId?: string; subscriptionStatus?: string; renewalAt?: string | null; graceEndsAt?: string | null }): Promise<void>;
  listLicensesWithHostCounts(): Promise<Array<License & { hostCount: number }>>;
  revokeLicense(licenseId: string): Promise<void>;
  extendLicense(licenseId: string, newExpiresAt: number): Promise<void>;
  upgradeLicenseToPro(licenseId: string): Promise<void>;
  ensureDeviceAccount(hostUuid: string): Promise<void>;
  isDeviceTrialUsed(hostUuid: string): Promise<boolean>;
  setDeviceTrialUsed(hostUuid: string): Promise<void>;
  getOrCreateDeviceTrial(deviceId: string, trialDays?: number): Promise<{ trialStartedAt: string; trialEndsAt: string; trialExtendedAt: string | null }>;
  extendDeviceTrial(deviceId: string, extraDays: number): Promise<{ trialEndsAt: string }>;
  canExtendDeviceTrial(deviceId: string): Promise<boolean>;
  getMonthlyShareCount(deviceId: string, ym: string): Promise<number>;
  incrementMonthlyShares(deviceId: string, ym: string): Promise<{ count: number }>;
  getShareCountSinceCycleStart(deviceId: string, cycleStartSec: number): Promise<number>;
  incrementSharesForCycle(deviceId: string, cycleStartSec: number): Promise<{ count: number }>;
  createSubscription(subscription: Omit<Subscription, 'createdAt' | 'updatedAt'>): Promise<Subscription>;
  getSubscriptionById(subscriptionId: string): Promise<Subscription | null>;
  getSubscriptionByAccountId(accountId: string): Promise<Subscription | null>;
  getSubscriptionByLicenseId(licenseId: string): Promise<Subscription | null>;
  updateSubscription(subscriptionId: string, updates: Partial<Subscription>): Promise<void>;
  listSubscriptions(filters?: { status?: string; provider?: string }): Promise<Subscription[]>;
  createPayment(payment: Omit<Payment, 'createdAt'>): Promise<Payment>;
  getPaymentById(paymentId: string): Promise<Payment | null>;
  getPaymentsByAccountId(accountId: string): Promise<Payment[]>;
  getPaymentsBySubscriptionId(subscriptionId: string): Promise<Payment[]>;
  updatePaymentStatus(paymentId: string, status: string): Promise<void>;
  createDeviceRecoveryRequest(request: Omit<DeviceRecoveryRequest, 'createdAt' | 'resolvedAt' | 'resolvedBy'>): Promise<DeviceRecoveryRequest>;
  getDeviceRecoveryRequestById(requestId: string): Promise<DeviceRecoveryRequest | null>;
  getPendingRecoveryRequests(): Promise<DeviceRecoveryRequest[]>;
  getRecoveryRequestsByAccountId(accountId: string): Promise<DeviceRecoveryRequest[]>;
  resolveDeviceRecoveryRequest(requestId: string, status: 'approved' | 'rejected', adminNotes: string, resolvedBy: string): Promise<void>;
  createReferral(referral: Omit<Referral, 'createdAt'>): Promise<Referral>;
  getReferralsByReferrerId(referrerAccountId: string): Promise<Referral[]>;
  getReferralByReferredId(referredAccountId: string): Promise<Referral | null>;
  getAccountByReferralCode(referralCode: string): Promise<Account | null>;
  updateAccountReferral(accountId: string, updates: { referralCode?: string; referredBy?: string; referralCount?: number; referralDaysEarned?: number }): Promise<void>;
  getReferralStats(accountId: string): Promise<ReferralStats>;
  getLicenseCheckResponse(deviceId: string): Promise<LicenseCheckResponse>;
  createDeviceOnlyLicense(deviceId: string, tier: string, expiresAt: number, signature: string, licenseId?: string): Promise<License>;
  getLicenseByDeviceId(deviceId: string): Promise<License | null>;
  linkLicenseToAccount(licenseId: string, accountId: string): Promise<void>;
  createSubscriptionRequest(request: {
    id: string;
    status: "pending" | "approved" | "rejected";
    planId: string;
    email: string;
    phone?: string | null;
    accountId?: string | null;
    deviceId?: string | null;
    customUsers?: number | null;
    customDevices?: number | null;
    requestedDays?: number | null;
    requestedShareLimit?: number | null;
    requestedDeviceLimit?: number | null;
    notes?: string | null;
    licenseId?: string | null;
    approvedBy?: string | null;
    approvedAt?: string | null;
    createdAt: string;
  }): Promise<void>;
  listSubscriptionRequests(filters?: { status?: string }): Promise<any[]>;
  getSubscriptionRequestById(id: string): Promise<any | null>;
  updateSubscriptionRequest(id: string, updates: Partial<{
    status: "pending" | "approved" | "rejected";
    notes: string | null;
    licenseId: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
  }>): Promise<void>;
  suspendHost(hostUuid: string, reason: string): Promise<void>;
  unsuspendHost(hostUuid: string): Promise<void>;
  isHostSuspended(hostUuid: string): Promise<boolean>;
  incrementDeviceChangeCount(accountId: string): Promise<number>;
  getSubscriptionStats(): Promise<SubscriptionStats>;
  setLogoutRequested(hostUuid: string): Promise<void>;
  consumeLogoutRequested(hostUuid: string): Promise<boolean>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getBillingSummary(): Promise<BillingSummary>;
  getAccountWithBilling(accountId: string): Promise<AccountWithBilling | null>;
  listAccountsWithBilling(): Promise<AccountWithBilling[]>;
  getTeamInvitations(licenseId: string): Promise<TeamInvitation[]>;
  addTeamInvitation(licenseId: string, email: string, invitedBy: string): Promise<TeamInvitation>;
  removeTeamInvitation(invitationId: number): Promise<void>;
  getTeamInvitationByEmail(email: string): Promise<TeamInvitation | null>;
  acceptTeamInvitation(invitationId: number, accountId: string): Promise<void>;
  updateLicenseBilling(licenseId: string, updates: {
    paymentMethod?: string;
    amountPaid?: number;
    currency?: string;
    paymentProvider?: string;
    invoiceId?: string;
    discountPercent?: number;
    notes?: string;
  }): Promise<void>;
  updateLicenseOverridesJson(licenseId: string, overridesJson: string): Promise<void>;
}

// === HELPERS ===

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function isOnline(ts: string | null | undefined): boolean {
  if (!ts) return false;
  const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();
  return ts >= threshold;
}

function mapAccountRow(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    email: row.email,
    username: row.username ?? null,
    trialUsed: row.trialUsed === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    stripeCustomerId: row.stripeCustomerId ?? null,
    subscriptionId: row.subscriptionId ?? null,
    subscriptionStatus: row.subscriptionStatus ?? null,
    renewalAt: row.renewalAt ?? null,
    graceEndsAt: row.graceEndsAt ?? null,
    razorpayCustomerId: row.razorpayCustomerId ?? null,
    razorpaySubscriptionId: row.razorpaySubscriptionId ?? null,
    referralCode: row.referralCode ?? null,
    referredBy: row.referredBy ?? null,
    referralCount: Number(row.referralCount ?? 0),
    referralDaysEarned: Number(row.referralDaysEarned ?? 0),
    deviceChangeCount: Number(row.deviceChangeCount ?? 0),
    lastDeviceChangeAt: row.lastDeviceChangeAt ?? null,
    adminRole: row.adminRole ?? null,
  };
}

function mapLicenseRow(row: typeof licenses.$inferSelect): License {
  return {
    id: row.id,
    accountId: row.accountId,
    tier: row.tier,
    deviceLimit: row.deviceLimit,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    state: row.state,
    signature: row.signature,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    planInterval: row.planInterval ?? null,
    graceEndsAt: row.graceEndsAt != null ? Number(row.graceEndsAt) : null,
    renewalAt: row.renewalAt != null ? Number(row.renewalAt) : null,
    customQuota: row.customQuota != null ? Number(row.customQuota) : null,
    paymentMethod: row.paymentMethod ?? null,
    amountPaid: row.amountPaid != null ? Number(row.amountPaid) : null,
    currency: row.currency ?? 'INR',
    paymentProvider: row.paymentProvider ?? null,
    invoiceId: row.invoiceId ?? null,
    discountPercent: row.discountPercent != null ? Number(row.discountPercent) : null,
    notes: row.notes ?? null,
    shareLimitMonthly: row.shareLimitMonthly != null ? Number(row.shareLimitMonthly) : null,
    overridesJson: row.overridesJson ?? null,
  };
}

function mapHostRow(row: typeof hosts.$inferSelect): Host {
  return {
    id: row.id,
    hostUUID: row.hostUuid,
    installationId: row.installationId,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    firstInstalledAt: row.firstInstalledAt,
    version: row.version,
    platform: row.platform,
    arch: row.arch,
    trialStartAt: row.trialStartAt ?? null,
    registrationStatus: row.registrationStatus,
    isOnline: isOnline(row.lastSeenAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSubscriptionRow(row: typeof subscriptions.$inferSelect): Subscription {
  return {
    id: row.id,
    accountId: row.accountId,
    licenseId: row.licenseId ?? null,
    provider: row.provider,
    providerSubscriptionId: row.providerSubscriptionId ?? null,
    plan: row.plan,
    status: row.status,
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? 'INR',
    interval: row.interval ?? 'month',
    currentPeriodStart: row.currentPeriodStart ? Number(row.currentPeriodStart) : null,
    currentPeriodEnd: row.currentPeriodEnd ? Number(row.currentPeriodEnd) : null,
    paymentDueDate: row.paymentDueDate ? Number(row.paymentDueDate) : null,
    graceEndsAt: row.graceEndsAt ? Number(row.graceEndsAt) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPaymentRow(row: typeof payments.$inferSelect): Payment {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId ?? null,
    accountId: row.accountId,
    deviceId: row.deviceId ?? null,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId ?? null,
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? 'INR',
    status: row.status,
    invoiceUrl: row.invoiceUrl ?? null,
    createdAt: row.createdAt,
  };
}

function mapRecoveryRow(row: typeof deviceRecoveryRequests.$inferSelect): DeviceRecoveryRequest {
  return {
    id: row.id,
    accountId: row.accountId,
    oldDeviceId: row.oldDeviceId,
    newDeviceId: row.newDeviceId,
    reason: row.reason ?? null,
    status: row.status,
    adminNotes: row.adminNotes ?? null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
    resolvedBy: row.resolvedBy ?? null,
  };
}

function mapReferralRow(row: typeof referrals.$inferSelect): Referral {
  return {
    id: row.id,
    referrerAccountId: row.referrerAccountId,
    referredAccountId: row.referredAccountId,
    referralCode: row.referralCode,
    daysGranted: Number(row.daysGranted ?? 10),
    status: row.status,
    createdAt: row.createdAt,
  };
}

// === STORAGE IMPLEMENTATION ===

export class DrizzleStorage implements IStorage {

  // === RETENTION ===

  async enforceRetention(): Promise<void> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const dateStr = twelveMonthsAgo.toISOString().split('T')[0];

    await db.delete(dailyMetrics).where(lt(dailyMetrics.date, dateStr));

    const activeUserIds = db
      .selectDistinct({ userId: dailyMetrics.userId })
      .from(dailyMetrics);
    await db.delete(users).where(
      sql`${users.userId} NOT IN (${activeUserIds})`
    );

    await this.cleanupExpiredLogs();
  }

  // === TELEMETRY ===

  async ingestTelemetry(payload: TelemetryPayload): Promise<void> {
    const now = new Date().toISOString();

    const existing = await db
      .select({ deviceIndex: users.deviceIndex })
      .from(users)
      .where(eq(users.userId, payload.user_id))
      .limit(1);

    let deviceIndex: number;
    if (existing.length > 0 && existing[0].deviceIndex != null) {
      deviceIndex = existing[0].deviceIndex;
    } else {
      const maxResult = await db
        .select({ maxIndex: max(users.deviceIndex) })
        .from(users);
      deviceIndex = (maxResult[0]?.maxIndex ?? 0) + 1;
    }

    await db
      .insert(users)
      .values({
        userId: payload.user_id,
        deviceIndex,
        firstSeen: now,
        lastSeen: now,
        appVersion: payload.app_version,
        os: payload.os,
      })
      .onConflictDoUpdate({
        target: users.userId,
        set: {
          lastSeen: now,
          appVersion: payload.app_version,
          os: payload.os,
        },
      });

    const networkVisibility = payload.network_visibility_enabled !== undefined
      ? payload.network_visibility_enabled
      : true;
    const peersDetected = payload.network_peers_detected ?? 0;
    const displayNameCustomized = payload.display_name_customized ?? false;

    await db
      .insert(dailyMetrics)
      .values({
        userId: payload.user_id,
        date: payload.date,
        uptimeSeconds: payload.uptime_seconds,
        filesUploaded: payload.metrics.files_uploaded,
        filesDownloaded: payload.metrics.files_downloaded,
        bytesUploaded: payload.metrics.bytes_uploaded,
        bytesDownloaded: payload.metrics.bytes_downloaded,
        sharesCreated: payload.metrics.shares_created,
        publicShares: payload.metrics.public_shares,
        lanShares: payload.metrics.lan_shares,
        networkVisibilityEnabled: networkVisibility,
        networkPeersDetected: peersDetected,
        displayNameCustomized,
      })
      .onConflictDoUpdate({
        target: [dailyMetrics.userId, dailyMetrics.date],
        set: {
          uptimeSeconds: payload.uptime_seconds,
          filesUploaded: payload.metrics.files_uploaded,
          filesDownloaded: payload.metrics.files_downloaded,
          bytesUploaded: payload.metrics.bytes_uploaded,
          bytesDownloaded: payload.metrics.bytes_downloaded,
          sharesCreated: payload.metrics.shares_created,
          publicShares: payload.metrics.public_shares,
          lanShares: payload.metrics.lan_shares,
          networkVisibilityEnabled: networkVisibility,
          networkPeersDetected: peersDetected,
          displayNameCustomized,
        },
      });
  }

  // === HEARTBEAT ===

  async recordHeartbeat(payload: HeartbeatPayload): Promise<void> {
    const now = new Date().toISOString();
    const os = payload.platform?.trim() || null;

    const existing = await db
      .select({ deviceIndex: users.deviceIndex, os: users.os })
      .from(users)
      .where(eq(users.userId, payload.deviceUUID))
      .limit(1);

    if (existing.length > 0) {
      const newOs = os ?? existing[0].os ?? 'unknown';
      await db
        .update(users)
        .set({ lastHeartbeat: now, lastSeen: now, appVersion: payload.appVersion, os: newOs })
        .where(eq(users.userId, payload.deviceUUID));
    } else {
      const maxResult = await db.select({ maxIndex: max(users.deviceIndex) }).from(users);
      const deviceIndex = (maxResult[0]?.maxIndex ?? 0) + 1;
      await db.insert(users).values({
        userId: payload.deviceUUID,
        deviceIndex,
        firstSeen: now,
        lastSeen: now,
        lastHeartbeat: now,
        appVersion: payload.appVersion,
        os: os || 'unknown',
      });
    }
  }

  // === DEVICES ===

  async getDevices(): Promise<Device[]> {
    const rows = await db
      .select()
      .from(users)
      .orderBy(asc(users.deviceIndex));

    return rows.map(row => ({
      deviceUUID: row.userId,
      deviceIndex: row.deviceIndex || 0,
      platform: row.os || 'unknown',
      appVersion: row.appVersion || 'unknown',
      firstSeenAt: row.firstSeen || '',
      lastSeenAt: row.lastSeen || '',
      lastHeartbeat: row.lastHeartbeat ?? null,
      isOnline: isOnline(row.lastHeartbeat || row.lastSeen),
    }));
  }

  async getDevicesWithAccountInfo(): Promise<Array<Device & { accountEmail: string | null; licenseId: string | null; tier: string | null }>> {
    const fiveMinutesAgo = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();

    const fromUsers = await db
      .select({
        userId: users.userId,
        deviceIndex: users.deviceIndex,
        os: users.os,
        appVersion: users.appVersion,
        firstSeen: users.firstSeen,
        lastSeen: users.lastSeen,
        lastHeartbeat: users.lastHeartbeat,
        accountEmail: accounts.email,
        licenseId: licenses.id,
        licenseState: licenses.state,
        licenseAccountId: licenses.accountId,
        licenseTier: licenses.tier,
      })
      .from(users)
      .leftJoin(licenseHosts, eq(licenseHosts.hostUuid, users.userId))
      .leftJoin(licenses, and(
        eq(licenses.id, licenseHosts.licenseId),
        inArray(licenses.state, ['active', 'trial_active', 'grace'])
      ))
      .leftJoin(accounts, eq(accounts.id, licenses.accountId))
      .orderBy(asc(users.deviceIndex));

    const seenUuids = new Set<string>();
    const result: Array<Device & { accountEmail: string | null; licenseId: string | null; tier: string | null }> = [];

    for (const row of fromUsers) {
      seenUuids.add(row.userId);
      const activity = row.lastHeartbeat || row.lastSeen;
      result.push({
        deviceUUID: row.userId,
        deviceIndex: row.deviceIndex || 0,
        platform: row.os || 'unknown',
        appVersion: row.appVersion || 'unknown',
        firstSeenAt: row.firstSeen || '',
        lastSeenAt: row.lastSeen || row.firstSeen || '',
        lastHeartbeat: row.lastHeartbeat ?? null,
        isOnline: !!activity && activity >= fiveMinutesAgo,
        accountEmail: row.accountEmail ?? null,
        licenseId: row.licenseId ?? null,
        tier: row.licenseTier ?? null,
      });
    }

    const licensedNotInUsers = await db
      .select({
        hostUuid: licenseHosts.hostUuid,
        platform: hosts.platform,
        version: hosts.version,
        lastSeenAt: hosts.lastSeenAt,
        firstSeenAt: hosts.firstSeenAt,
        accountEmail: accounts.email,
        licenseId: licenses.id,
        licenseTier: licenses.tier,
      })
      .from(licenseHosts)
      .innerJoin(licenses, and(
        eq(licenses.id, licenseHosts.licenseId),
        inArray(licenses.state, ['active', 'trial_active', 'grace'])
      ))
      .innerJoin(accounts, eq(accounts.id, licenses.accountId))
      .leftJoin(hosts, eq(hosts.hostUuid, licenseHosts.hostUuid))
      .where(
        sql`${licenseHosts.hostUuid} NOT IN (SELECT user_id FROM users)`
      );

    let deviceIndex = result.length > 0 ? Math.max(...result.map(d => d.deviceIndex), 0) + 1 : 1;
    for (const row of licensedNotInUsers) {
      if (seenUuids.has(row.hostUuid)) continue;
      seenUuids.add(row.hostUuid);
      const lastSeen = row.lastSeenAt || row.firstSeenAt || '';
      result.push({
        deviceUUID: row.hostUuid,
        deviceIndex: deviceIndex++,
        platform: row.platform || 'unknown',
        appVersion: row.version || 'unknown',
        firstSeenAt: row.firstSeenAt || '',
        lastSeenAt: lastSeen,
        lastHeartbeat: null,
        isOnline: isOnline(lastSeen),
        accountEmail: row.accountEmail ?? null,
        licenseId: row.licenseId ?? null,
        tier: row.licenseTier ?? null,
      });
    }

    return result;
  }

  async getDevice(deviceUUID: string): Promise<Device | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.userId, deviceUUID))
      .limit(1);

    if (!rows.length) return null;
    const row = rows[0];
    const activity = row.lastHeartbeat || row.lastSeen;
    return {
      deviceUUID: row.userId,
      deviceIndex: row.deviceIndex || 0,
      platform: row.os || 'unknown',
      appVersion: row.appVersion || 'unknown',
      firstSeenAt: row.firstSeen || '',
      lastSeenAt: row.lastSeen || '',
      lastHeartbeat: row.lastHeartbeat ?? null,
      isOnline: isOnline(activity),
    };
  }

  // === SUPPORT ===

  async getOrCreateThread(deviceUUID: string): Promise<SupportThread> {
    const existing = await this.getThreadByDevice(deviceUUID);
    if (existing) return existing;

    const now = new Date().toISOString();
    const result = await db
      .insert(supportThreads)
      .values({ deviceUuid: deviceUUID, createdAt: now, updatedAt: now })
      .returning();

    return {
      id: result[0].id,
      deviceUUID,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  async getThreadByDevice(deviceUUID: string): Promise<SupportThread | null> {
    const threadRows = await db
      .select()
      .from(supportThreads)
      .where(eq(supportThreads.deviceUuid, deviceUUID))
      .limit(1);

    if (!threadRows.length) return null;
    const thread = threadRows[0];

    const msgs = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.threadId, thread.id))
      .orderBy(asc(supportMessages.timestamp));

    return {
      id: thread.id,
      deviceUUID: thread.deviceUuid,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: msgs.map(m => ({
        id: m.id,
        threadId: m.threadId,
        sender: m.sender as 'device' | 'admin' | 'user',
        text: m.text,
        timestamp: m.timestamp,
      })),
    };
  }

  async getAllThreads(): Promise<SupportThread[]> {
    const threadRows = await db
      .select()
      .from(supportThreads)
      .orderBy(desc(supportThreads.updatedAt));

    return Promise.all(threadRows.map(async (thread) => {
      const msgs = await db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.threadId, thread.id))
        .orderBy(asc(supportMessages.timestamp));

      return {
        id: thread.id,
        deviceUUID: thread.deviceUuid,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messages: msgs.map(m => ({
          id: m.id,
          threadId: m.threadId,
          sender: m.sender as 'device' | 'admin' | 'user',
          text: m.text,
          timestamp: m.timestamp,
        })),
      };
    }));
  }

  async addMessage(deviceUUID: string, sender: 'device' | 'admin' | 'user', text: string): Promise<SupportMessage> {
    const thread = await this.getOrCreateThread(deviceUUID);
    const now = new Date().toISOString();

    const result = await db
      .insert(supportMessages)
      .values({ threadId: thread.id, sender, text, timestamp: now })
      .returning();

    await db
      .update(supportThreads)
      .set({ updatedAt: now })
      .where(eq(supportThreads.id, thread.id));

    return {
      id: result[0].id,
      threadId: thread.id,
      sender,
      text,
      timestamp: now,
    };
  }

  async deleteThreadByDevice(deviceUUID: string): Promise<boolean> {
    const threadRows = await db
      .select({ id: supportThreads.id })
      .from(supportThreads)
      .where(eq(supportThreads.deviceUuid, deviceUUID))
      .limit(1);

    if (!threadRows.length) return false;
    await db.delete(supportMessages).where(eq(supportMessages.threadId, threadRows[0].id));
    await db.delete(supportThreads).where(eq(supportThreads.id, threadRows[0].id));
    return true;
  }

  // === LOGS ===

  async ingestLogs(payload: LogsBatchPayload): Promise<void> {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const expiresAt = thirtyDaysFromNow.toISOString();

    const values = payload.logs.map(log => ({
      deviceUuid: payload.deviceUUID,
      level: log.level,
      message: log.message,
      context: log.context ? JSON.stringify(log.context) : null,
      timestamp: log.timestamp || new Date().toISOString(),
      expiresAt,
    }));

    if (values.length > 0) {
      await db.insert(deviceLogs).values(values);
    }
  }

  async cleanupExpiredLogs(): Promise<void> {
    const now = new Date().toISOString();
    await db.delete(deviceLogs).where(lt(deviceLogs.expiresAt, now));
  }

  // === DASHBOARD STATS ===

  private async getNetworkPresenceStats(): Promise<NetworkPresenceStats> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split('T')[0];

    const totalActiveResult = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${dailyMetrics.userId})` })
      .from(dailyMetrics)
      .where(gte(dailyMetrics.date, dateStr));
    const totalActive = Number(totalActiveResult[0]?.count || 0);

    if (totalActive === 0) {
      return {
        peerDetectionRate: 0,
        avgPeersPerUser: 0,
        visibilityOnRate: 100,
        visibilityOffRate: 0,
        avgUptimeVisibilityOn: 0,
        avgUptimeVisibilityOff: 0,
        displayNameCustomizationRate: 0,
      };
    }

    const usersWithPeers = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${dailyMetrics.userId})` })
      .from(dailyMetrics)
      .where(and(gte(dailyMetrics.date, dateStr), gte(dailyMetrics.networkPeersDetected, 1)));
    const peerDetectionRate = (Number(usersWithPeers[0]?.count || 0) / totalActive) * 100;

    const avgPeersResult = await db
      .select({ avg: sql<number>`AVG(max_peers)` })
      .from(
        db.select({
          userId: dailyMetrics.userId,
          max_peers: sql<number>`MAX(${dailyMetrics.networkPeersDetected})`.as('max_peers'),
        })
        .from(dailyMetrics)
        .where(gte(dailyMetrics.date, dateStr))
        .groupBy(dailyMetrics.userId)
        .as('sub')
      );
    const avgPeersPerUser = Number(avgPeersResult[0]?.avg || 0);

    const visibilityStats = await db.execute(sql`
      SELECT 
        SUM(CASE WHEN dm.network_visibility_enabled = true THEN 1 ELSE 0 END) as vis_on,
        SUM(CASE WHEN dm.network_visibility_enabled = false THEN 1 ELSE 0 END) as vis_off
      FROM daily_metrics dm
      INNER JOIN (
        SELECT user_id, MAX(date) as max_date
        FROM daily_metrics
        WHERE date >= ${dateStr}
        GROUP BY user_id
      ) latest ON dm.user_id = latest.user_id AND dm.date = latest.max_date
    `);
    const vRow = (visibilityStats.rows[0] || {}) as any;
    const visOn = Number(vRow.vis_on || 0);
    const visOff = Number(vRow.vis_off || 0);
    const visTotal = visOn + visOff;
    const visibilityOnRate = visTotal > 0 ? (visOn / visTotal) * 100 : 100;
    const visibilityOffRate = visTotal > 0 ? (visOff / visTotal) * 100 : 0;

    const uptimeStats = await db
      .select({
        networkVisibilityEnabled: dailyMetrics.networkVisibilityEnabled,
        avgUptime: sql<number>`AVG(${dailyMetrics.uptimeSeconds})`,
      })
      .from(dailyMetrics)
      .where(gte(dailyMetrics.date, dateStr))
      .groupBy(dailyMetrics.networkVisibilityEnabled);

    let avgUptimeVisibilityOn = 0;
    let avgUptimeVisibilityOff = 0;
    for (const r of uptimeStats) {
      if (r.networkVisibilityEnabled === true) {
        avgUptimeVisibilityOn = Number(r.avgUptime || 0);
      } else {
        avgUptimeVisibilityOff = Number(r.avgUptime || 0);
      }
    }

    const customizedResult = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${dailyMetrics.userId})` })
      .from(dailyMetrics)
      .where(and(
        gte(dailyMetrics.date, dateStr),
        eq(dailyMetrics.displayNameCustomized, true)
      ));
    const displayNameCustomizationRate = (Number(customizedResult[0]?.count || 0) / totalActive) * 100;

    return {
      peerDetectionRate: Math.round(peerDetectionRate * 10) / 10,
      avgPeersPerUser: Math.round(avgPeersPerUser * 10) / 10,
      visibilityOnRate: Math.round(visibilityOnRate * 10) / 10,
      visibilityOffRate: Math.round(visibilityOffRate * 10) / 10,
      avgUptimeVisibilityOn: Math.round(avgUptimeVisibilityOn),
      avgUptimeVisibilityOff: Math.round(avgUptimeVisibilityOff),
      displayNameCustomizationRate: Math.round(displayNameCustomizationRate * 10) / 10,
    };
  }

  private async getAdvancedTelemetryStats() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgoDate = sevenDaysAgoIso.split('T')[0];

    const [d1h, d24h, d7d] = await Promise.all([
      db.select({ c: sql<number>`COUNT(*)` }).from(users).where(
        or(gte(users.lastHeartbeat, oneHourAgo), gte(users.lastSeen, oneHourAgo))
      ),
      db.select({ c: sql<number>`COUNT(*)` }).from(users).where(
        or(gte(users.lastHeartbeat, oneDayAgo), gte(users.lastSeen, oneDayAgo))
      ),
      db.select({ c: sql<number>`COUNT(*)` }).from(users).where(
        or(gte(users.lastHeartbeat, sevenDaysAgoIso), gte(users.lastSeen, sevenDaysAgoIso))
      ),
    ]);

    const transfer7d = await db
      .select({
        upload: sql<number>`COALESCE(SUM(${dailyMetrics.bytesUploaded}), 0)`,
        download: sql<number>`COALESCE(SUM(${dailyMetrics.bytesDownloaded}), 0)`,
        filesUp: sql<number>`COALESCE(SUM(${dailyMetrics.filesUploaded}), 0)`,
        filesDown: sql<number>`COALESCE(SUM(${dailyMetrics.filesDownloaded}), 0)`,
      })
      .from(dailyMetrics)
      .where(gte(dailyMetrics.date, sevenDaysAgoDate));

    const versionRows = await db
      .select({
        version: users.appVersion,
        count: sql<number>`COUNT(*)`,
      })
      .from(users)
      .groupBy(users.appVersion)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    const platformRows = await db
      .select({
        platform: users.os,
        count: sql<number>`COUNT(*)`,
      })
      .from(users)
      .groupBy(users.os)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    return {
      devicesReportingLast1h: Number(d1h[0]?.c ?? 0),
      devicesReportingLast24h: Number(d24h[0]?.c ?? 0),
      devicesReportingLast7d: Number(d7d[0]?.c ?? 0),
      totalUploadBytes7d: Number(transfer7d[0]?.upload ?? 0),
      totalDownloadBytes7d: Number(transfer7d[0]?.download ?? 0),
      totalFilesUploaded7d: Number(transfer7d[0]?.filesUp ?? 0),
      totalFilesDownloaded7d: Number(transfer7d[0]?.filesDown ?? 0),
      topVersions: versionRows.map(r => ({ version: r.version || 'unknown', count: Number(r.count) })),
      topPlatforms: platformRows.map(r => ({ platform: r.platform || 'unknown', count: Number(r.count) })),
    };
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [totalResult, activeResult, uptimeResult, aggregateResult, versionRows, platformRows, dailyRows] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(users),
      db.select({ count: sql<number>`COUNT(*)` }).from(users).where(gte(users.lastSeen, sevenDaysAgo.toISOString())),
      db.select({
        avgDailyUptime: sql<number>`AVG(daily_avg_uptime)`,
      }).from(
        db.select({
          date: dailyMetrics.date,
          daily_avg_uptime: sql<number>`AVG(${dailyMetrics.uptimeSeconds})`.as('daily_avg_uptime'),
        })
        .from(dailyMetrics)
        .groupBy(dailyMetrics.date)
        .as('daily')
      ),
      db.select({
        totalProcessed: sql<number>`SUM(${dailyMetrics.bytesUploaded} + ${dailyMetrics.bytesDownloaded})`,
        totalShares: sql<number>`SUM(${dailyMetrics.sharesCreated})`,
        totalUpload: sql<number>`SUM(${dailyMetrics.bytesUploaded})`,
        totalDownload: sql<number>`SUM(${dailyMetrics.bytesDownloaded})`,
      }).from(dailyMetrics),
      db.select({ appVersion: users.appVersion, count: sql<number>`COUNT(*)` }).from(users).groupBy(users.appVersion),
      db.select({ os: users.os, count: sql<number>`COUNT(*)` }).from(users).groupBy(users.os),
      db.select({
        date: dailyMetrics.date,
        activeUsers: sql<number>`COUNT(DISTINCT ${dailyMetrics.userId})`,
        filesUploaded: sql<number>`SUM(${dailyMetrics.filesUploaded})`,
        filesDownloaded: sql<number>`SUM(${dailyMetrics.filesDownloaded})`,
        sharesCreated: sql<number>`SUM(${dailyMetrics.sharesCreated})`,
        avgUptimeHours: sql<number>`AVG(${dailyMetrics.uptimeSeconds}) / 3600.0`,
        dataProcessed: sql<number>`SUM(${dailyMetrics.bytesUploaded} + ${dailyMetrics.bytesDownloaded})`,
        uploadBytes: sql<number>`SUM(${dailyMetrics.bytesUploaded})`,
        downloadBytes: sql<number>`SUM(${dailyMetrics.bytesDownloaded})`,
      })
      .from(dailyMetrics)
      .groupBy(dailyMetrics.date)
      .orderBy(desc(dailyMetrics.date))
      .limit(365),
    ]);

    const advancedTelemetry = await this.getAdvancedTelemetryStats();

    const versionDist: Record<string, number> = {};
    versionRows.forEach(v => versionDist[v.appVersion || 'unknown'] = Number(v.count));

    const osDist: Record<string, number> = {};
    platformRows.forEach(p => osDist[p.os || 'unknown'] = Number(p.count));

    return {
      totalUsers: Number(totalResult[0]?.count || 0),
      activeUsers7d: Number(activeResult[0]?.count || 0),
      avgDailyUptimeSeconds: Number(uptimeResult[0]?.avgDailyUptime || 0),
      totalDataProcessedBytes: Number(aggregateResult[0]?.totalProcessed || 0),
      totalShares: Number(aggregateResult[0]?.totalShares || 0),
      uploadBandwidthBytes: Number(aggregateResult[0]?.totalUpload || 0),
      downloadBandwidthBytes: Number(aggregateResult[0]?.totalDownload || 0),
      versionDistribution: versionDist,
      osDistribution: osDist,
      dailyActivity: dailyRows.map(row => ({
        date: row.date,
        activeUsers: Number(row.activeUsers),
        filesUploaded: Number(row.filesUploaded),
        filesDownloaded: Number(row.filesDownloaded),
        sharesCreated: Number(row.sharesCreated),
        avgUptimeHours: Number(row.avgUptimeHours),
        dataProcessedBytes: Number(row.dataProcessed),
        uploadBytes: Number(row.uploadBytes),
        downloadBytes: Number(row.downloadBytes),
      })),
      advancedTelemetry,
    };
  }

  // === USER STATS ===

  async getUserStats(deviceUUID: string): Promise<UserStats | null> {
    let device = await this.getDevice(deviceUUID);
    if (!device) {
      const hostRows = await db
        .select()
        .from(hosts)
        .where(eq(hosts.hostUuid, deviceUUID))
        .limit(1);
      if (!hostRows.length) return null;
      const hostRow = hostRows[0];
      device = {
        deviceUUID: hostRow.hostUuid,
        deviceIndex: 0,
        platform: hostRow.platform || 'unknown',
        appVersion: hostRow.version || 'unknown',
        firstSeenAt: hostRow.firstSeenAt || '',
        lastSeenAt: hostRow.lastSeenAt || '',
        lastHeartbeat: null,
        isOnline: isOnline(hostRow.lastSeenAt),
      };
    }

    const statsResult = await db
      .select({
        totalUptime: sql<number>`COALESCE(SUM(${dailyMetrics.uptimeSeconds}), 0)`,
        filesUploaded: sql<number>`COALESCE(SUM(${dailyMetrics.filesUploaded}), 0)`,
        filesDownloaded: sql<number>`COALESCE(SUM(${dailyMetrics.filesDownloaded}), 0)`,
        sharesCreated: sql<number>`COALESCE(SUM(${dailyMetrics.sharesCreated}), 0)`,
        bytesUploaded: sql<number>`COALESCE(SUM(${dailyMetrics.bytesUploaded}), 0)`,
        bytesDownloaded: sql<number>`COALESCE(SUM(${dailyMetrics.bytesDownloaded}), 0)`,
        lanShares: sql<number>`COALESCE(SUM(${dailyMetrics.lanShares}), 0)`,
        publicShares: sql<number>`COALESCE(SUM(${dailyMetrics.publicShares}), 0)`,
      })
      .from(dailyMetrics)
      .where(eq(dailyMetrics.userId, deviceUUID));

    const stats = statsResult[0];
    return {
      deviceUUID: device.deviceUUID,
      deviceIndex: device.deviceIndex,
      platform: device.platform,
      appVersion: device.appVersion,
      firstSeenAt: device.firstSeenAt,
      lastSeenAt: device.lastSeenAt,
      isOnline: device.isOnline,
      totalUptimeSeconds: Number(stats?.totalUptime || 0),
      totalFilesUploaded: Number(stats?.filesUploaded || 0),
      totalFilesDownloaded: Number(stats?.filesDownloaded || 0),
      totalSharesCreated: Number(stats?.sharesCreated || 0),
      totalBytesUploaded: Number(stats?.bytesUploaded || 0),
      totalBytesDownloaded: Number(stats?.bytesDownloaded || 0),
      lanShares: Number(stats?.lanShares || 0),
      publicShares: Number(stats?.publicShares || 0),
    };
  }

  // === LEADERBOARD ===

  async getLeaderboard(): Promise<LeaderboardData> {
    const [byUptime, byFilesUploaded, bySharesCreated] = await Promise.all([
      db.select({
        deviceUUID: users.userId,
        deviceIndex: users.deviceIndex,
        platform: users.os,
        value: sql<number>`COALESCE(SUM(${dailyMetrics.uptimeSeconds}), 0)`,
      })
      .from(users)
      .leftJoin(dailyMetrics, eq(dailyMetrics.userId, users.userId))
      .groupBy(users.userId)
      .orderBy(desc(sql`COALESCE(SUM(${dailyMetrics.uptimeSeconds}), 0)`))
      .limit(10),

      db.select({
        deviceUUID: users.userId,
        deviceIndex: users.deviceIndex,
        platform: users.os,
        value: sql<number>`COALESCE(SUM(${dailyMetrics.filesUploaded}), 0)`,
      })
      .from(users)
      .leftJoin(dailyMetrics, eq(dailyMetrics.userId, users.userId))
      .groupBy(users.userId)
      .orderBy(desc(sql`COALESCE(SUM(${dailyMetrics.filesUploaded}), 0)`))
      .limit(10),

      db.select({
        deviceUUID: users.userId,
        deviceIndex: users.deviceIndex,
        platform: users.os,
        value: sql<number>`COALESCE(SUM(${dailyMetrics.sharesCreated}), 0)`,
      })
      .from(users)
      .leftJoin(dailyMetrics, eq(dailyMetrics.userId, users.userId))
      .groupBy(users.userId)
      .orderBy(desc(sql`COALESCE(SUM(${dailyMetrics.sharesCreated}), 0)`))
      .limit(10),
    ]);

    const mapEntry = (row: any): LeaderboardEntry => ({
      deviceUUID: row.deviceUUID,
      deviceIndex: row.deviceIndex || 0,
      platform: row.platform || 'unknown',
      value: Number(row.value || 0),
    });

    return {
      byUptime: byUptime.map(mapEntry),
      byFilesUploaded: byFilesUploaded.map(mapEntry),
      bySharesCreated: bySharesCreated.map(mapEntry),
    };
  }

  // === SUPPORT THREAD PREVIEWS ===

  async getSupportThreadPreviews(): Promise<SupportThreadPreview[]> {
    const threads = await db
      .select({
        deviceUuid: supportThreads.deviceUuid,
        updatedAt: supportThreads.updatedAt,
        threadId: supportThreads.id,
        deviceIndex: users.deviceIndex,
        messageCount: sql<number>`(SELECT COUNT(*) FROM support_messages WHERE thread_id = ${supportThreads.id})`,
      })
      .from(supportThreads)
      .leftJoin(users, eq(users.userId, supportThreads.deviceUuid))
      .orderBy(desc(supportThreads.updatedAt));

    return Promise.all(threads.map(async (thread) => {
      const lastMsgRows = await db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.threadId, thread.threadId))
        .orderBy(desc(supportMessages.timestamp))
        .limit(1);

      const lastMessage = lastMsgRows[0] ?? null;
      return {
        deviceUUID: thread.deviceUuid,
        deviceIndex: thread.deviceIndex || 0,
        lastMessageText: lastMessage?.text || '(No messages yet)',
        lastMessageSender: (lastMessage?.sender || 'device') as 'device' | 'admin',
        lastActivityAt: thread.updatedAt,
        messageCount: Number(thread.messageCount || 0),
        hasUnread: lastMessage ? lastMessage.sender !== 'admin' : false,
      };
    }));
  }

  // === HOSTS ===

  async registerHost(payload: HostRegisterPayload): Promise<Host> {
    const now = new Date().toISOString();
    const firstInstalledAt = new Date(payload.first_installed_at * 1000).toISOString();

    const existing = await db
      .select({ id: hosts.id })
      .from(hosts)
      .where(eq(hosts.hostUuid, payload.host_uuid))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(hosts)
        .set({ lastSeenAt: now, version: payload.version, platform: payload.platform, arch: payload.arch, updatedAt: now })
        .where(eq(hosts.hostUuid, payload.host_uuid));
    } else {
      await db.insert(hosts).values({
        hostUuid: payload.host_uuid,
        installationId: payload.installation_id,
        firstSeenAt: now,
        lastSeenAt: now,
        firstInstalledAt,
        version: payload.version,
        platform: payload.platform,
        arch: payload.arch,
        registrationStatus: 'registered',
        createdAt: now,
        updatedAt: now,
      });
    }

    return (await this.getHostByUUID(payload.host_uuid))!;
  }

  async hostHeartbeat(payload: HostHeartbeatPayload): Promise<void> {
    const now = new Date().toISOString();

    const result = await db
      .update(hosts)
      .set({ lastSeenAt: now, version: payload.version, updatedAt: now })
      .where(eq(hosts.hostUuid, payload.host_uuid))
      .returning({ id: hosts.id });

    if (!result.length) {
      await db.insert(hosts).values({
        hostUuid: payload.host_uuid,
        installationId: '',
        firstSeenAt: now,
        lastSeenAt: now,
        firstInstalledAt: now,
        version: payload.version,
        platform: 'unknown',
        arch: 'unknown',
        registrationStatus: 'registered',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async getHosts(filters?: { platform?: string; version?: string; search?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }): Promise<{ hosts: Host[]; total: number }> {
    const conditions = [];

    if (filters?.platform) conditions.push(eq(hosts.platform, filters.platform));
    if (filters?.version) conditions.push(eq(hosts.version, filters.version));
    if (filters?.search && String(filters.search).trim()) {
      const q = String(filters.search).trim().toLowerCase();
      conditions.push(sql`LOWER(${hosts.hostUuid}) LIKE ${'%' + q + '%'}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const validSortColumns: Record<string, any> = {
      last_seen_at: hosts.lastSeenAt,
      first_seen_at: hosts.firstSeenAt,
      first_installed_at: hosts.firstInstalledAt,
      version: hosts.version,
      platform: hosts.platform,
      host_uuid: hosts.hostUuid,
    };
    const sortCol = validSortColumns[filters?.sortBy || 'last_seen_at'] || hosts.lastSeenAt;
    const sortOrder = filters?.sortOrder === 'ASC' ? asc(sortCol) : desc(sortCol);
    const page = Math.max(1, filters?.page || 1);
    const limit = Math.min(100, Math.max(1, filters?.limit || 50));
    const offset = (page - 1) * limit;

    const [totalResult, rows] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(hosts).where(whereClause),
      db.select().from(hosts).where(whereClause).orderBy(sortOrder).limit(limit).offset(offset),
    ]);

    return {
      hosts: rows.map(mapHostRow),
      total: Number(totalResult[0]?.count || 0),
    };
  }

  async getHostByUUID(hostUUID: string): Promise<Host | null> {
    const rows = await db.select().from(hosts).where(eq(hosts.hostUuid, hostUUID)).limit(1);
    if (!rows.length) return null;
    return mapHostRow(rows[0]);
  }

  // === ACCOUNTS ===

  async createAccount(id: string, email: string, passwordHash: string): Promise<Account> {
    const now = new Date().toISOString();
    await db.insert(accounts).values({ id, email: email.toLowerCase(), passwordHash, trialUsed: 0, createdAt: now, updatedAt: now });
    const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return mapAccountRow(rows[0]);
  }

  async getAccountByEmail(email: string): Promise<Account | null> {
    const rows = await db.select().from(accounts).where(eq(accounts.email, email.toLowerCase())).limit(1);
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  async getAccountById(id: string): Promise<Account | null> {
    const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  async getAccountByStripeCustomerId(stripeCustomerId: string): Promise<Account | null> {
    const rows = await db.select().from(accounts).where(eq(accounts.stripeCustomerId, stripeCustomerId)).limit(1);
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  async getAccountBySubscriptionId(subscriptionId: string): Promise<Account | null> {
    const rows = await db.select().from(accounts).where(eq(accounts.subscriptionId, subscriptionId)).limit(1);
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  async getAccountByRazorpayCustomerId(customerId: string): Promise<Account | null> {
    const rows = await db.select().from(accounts).where(eq(accounts.razorpayCustomerId, customerId)).limit(1);
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  async getAccountByRazorpaySubscriptionId(subscriptionId: string): Promise<Account | null> {
    const rows = await db.select().from(accounts).where(eq(accounts.razorpaySubscriptionId, subscriptionId)).limit(1);
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  async getPasswordHash(accountId: string): Promise<string | null> {
    const rows = await db.select({ passwordHash: accounts.passwordHash }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return rows[0]?.passwordHash ?? null;
  }

  async setAccountTrialUsed(accountId: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(accounts).set({ trialUsed: 1, updatedAt: now }).where(eq(accounts.id, accountId));
  }

  async updateAccountUsername(accountId: string, username: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(accounts).set({ username: username.trim() || null, updatedAt: now }).where(eq(accounts.id, accountId));
  }

  async updateAccountPassword(accountId: string, passwordHash: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(accounts).set({ passwordHash, updatedAt: now }).where(eq(accounts.id, accountId));
  }

  async updateAccountRazorpay(accountId: string, updates: { razorpayCustomerId?: string; razorpaySubscriptionId?: string; subscriptionStatus?: string; renewalAt?: string | null; graceEndsAt?: string | null }): Promise<void> {
    const now = new Date().toISOString();
    const set: Record<string, any> = { updatedAt: now };
    if (updates.razorpayCustomerId !== undefined) set.razorpayCustomerId = updates.razorpayCustomerId;
    if (updates.razorpaySubscriptionId !== undefined) set.razorpaySubscriptionId = updates.razorpaySubscriptionId;
    if (updates.subscriptionStatus !== undefined) set.subscriptionStatus = updates.subscriptionStatus;
    if (updates.renewalAt !== undefined) set.renewalAt = updates.renewalAt;
    if (updates.graceEndsAt !== undefined) set.graceEndsAt = updates.graceEndsAt;
    if (Object.keys(set).length === 1) return;
    await db.update(accounts).set(set).where(eq(accounts.id, accountId));
  }

  async updateAccountSubscription(accountId: string, updates: { stripeCustomerId?: string; subscriptionId?: string; subscriptionStatus?: string; renewalAt?: string | null; graceEndsAt?: string | null }): Promise<void> {
    const now = new Date().toISOString();
    const set: Record<string, any> = { updatedAt: now };
    if (updates.stripeCustomerId !== undefined) set.stripeCustomerId = updates.stripeCustomerId;
    if (updates.subscriptionId !== undefined) set.subscriptionId = updates.subscriptionId;
    if (updates.subscriptionStatus !== undefined) set.subscriptionStatus = updates.subscriptionStatus;
    if (updates.renewalAt !== undefined) set.renewalAt = updates.renewalAt;
    if (updates.graceEndsAt !== undefined) set.graceEndsAt = updates.graceEndsAt;
    if (Object.keys(set).length === 1) return;
    await db.update(accounts).set(set).where(eq(accounts.id, accountId));
  }

  async listAccounts(): Promise<Account[]> {
    const rows = await db.select().from(accounts).orderBy(desc(accounts.createdAt));
    return rows.map(mapAccountRow);
  }

  async updateAccountAdminRole(accountId: string, role: string | null): Promise<void> {
    const now = new Date().toISOString();
    await db.update(accounts).set({ adminRole: role, updatedAt: now }).where(eq(accounts.id, accountId));
  }

  async listAdminPanelAccounts(): Promise<Account[]> {
    const rows = await db.select().from(accounts).where(sql`${accounts.adminRole} IS NOT NULL`).orderBy(desc(accounts.createdAt));
    return rows.map(mapAccountRow);
  }

  async updateAccountReferral(accountId: string, updates: { referralCode?: string; referredBy?: string; referralCount?: number; referralDaysEarned?: number }): Promise<void> {
    const now = new Date().toISOString();
    const set: Record<string, any> = { updatedAt: now };
    if (updates.referralCode !== undefined) set.referralCode = updates.referralCode;
    if (updates.referredBy !== undefined) set.referredBy = updates.referredBy;
    if (updates.referralCount !== undefined) set.referralCount = updates.referralCount;
    if (updates.referralDaysEarned !== undefined) set.referralDaysEarned = updates.referralDaysEarned;
    await db.update(accounts).set(set).where(eq(accounts.id, accountId));
  }

  async incrementDeviceChangeCount(accountId: string): Promise<number> {
    const now = new Date().toISOString();
    await db.update(accounts).set({
      deviceChangeCount: sql`COALESCE(${accounts.deviceChangeCount}, 0) + 1`,
      lastDeviceChangeAt: now,
      updatedAt: now,
    }).where(eq(accounts.id, accountId));
    const rows = await db.select({ deviceChangeCount: accounts.deviceChangeCount }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return Number(rows[0]?.deviceChangeCount ?? 1);
  }

  // === LICENSES ===

  async getNextLicenseId(): Promise<string> {
    const result = await db.execute(sql`
      INSERT INTO app_settings ("key", value)
      VALUES ('license_serial_counter', '1')
      ON CONFLICT ("key")
      DO UPDATE SET value = (
        CASE
          WHEN app_settings.value ~ '^[0-9]+$' THEN CAST(app_settings.value AS integer)
          ELSE 0
        END + 1
      )::text
      RETURNING value
    `);
    const nextValue = Number((((result.rows[0] || {}) as { value?: string }).value) ?? 1);

    return `LC_${String(nextValue).padStart(11, "0")}`;
  }

  async createLicense(license: { id: string; accountId: string; tier: string; deviceLimit: number; issuedAt: number; expiresAt: number; state: string; signature: string; planInterval?: string; graceEndsAt?: number; renewalAt?: number; customQuota?: number }): Promise<License> {
    const now = new Date().toISOString();
    await db.insert(licenses).values({
      id: license.id,
      accountId: license.accountId,
      tier: license.tier,
      deviceLimit: license.deviceLimit,
      issuedAt: license.issuedAt,
      expiresAt: license.expiresAt,
      state: license.state,
      signature: license.signature,
      createdAt: now,
      updatedAt: now,
      planInterval: license.planInterval ?? null,
      graceEndsAt: license.graceEndsAt ?? null,
      renewalAt: license.renewalAt ?? null,
      customQuota: license.customQuota ?? null,
    });
    const rows = await db.select().from(licenses).where(eq(licenses.id, license.id)).limit(1);
    return mapLicenseRow(rows[0]);
  }

  async updateLicense(licenseId: string, updates: { state?: string; expiresAt?: number; signature?: string; planInterval?: string; graceEndsAt?: number | null; renewalAt?: number | null; deviceLimit?: number; tier?: string; customQuota?: number | null }): Promise<void> {
    const now = new Date().toISOString();
    const set: Record<string, any> = { updatedAt: now };
    if (updates.state !== undefined) set.state = updates.state;
    if (updates.expiresAt !== undefined) set.expiresAt = updates.expiresAt;
    if (updates.signature !== undefined) set.signature = updates.signature;
    if (updates.planInterval !== undefined) set.planInterval = updates.planInterval;
    if (updates.graceEndsAt !== undefined) set.graceEndsAt = updates.graceEndsAt;
    if (updates.renewalAt !== undefined) set.renewalAt = updates.renewalAt;
    if (updates.deviceLimit !== undefined) set.deviceLimit = updates.deviceLimit;
    if (updates.tier !== undefined) set.tier = updates.tier;
    if (updates.customQuota !== undefined) set.customQuota = updates.customQuota;
    if (Object.keys(set).length === 1) return;
    await db.update(licenses).set(set).where(eq(licenses.id, licenseId));
  }

  async getActiveLicenseForAccount(accountId: string): Promise<License | null> {
    const now = Math.floor(Date.now() / 1000);
    const rows = await db
      .select()
      .from(licenses)
      .where(and(
        eq(licenses.accountId, accountId),
        inArray(licenses.state, ['trial_active', 'active', 'grace']),
        sql`${licenses.expiresAt} > ${now}`
      ))
      .orderBy(desc(licenses.expiresAt))
      .limit(1);
    if (!rows.length) return null;
    return mapLicenseRow(rows[0]);
  }

  async getLatestLicenseForAccount(accountId: string): Promise<License | null> {
    const rows = await db
      .select()
      .from(licenses)
      .where(eq(licenses.accountId, accountId))
      .orderBy(desc(licenses.createdAt))
      .limit(1);
    if (!rows.length) return null;
    return mapLicenseRow(rows[0]);
  }

  async getLicenseById(licenseId: string): Promise<License | null> {
    const rows = await db.select().from(licenses).where(eq(licenses.id, licenseId)).limit(1);
    if (!rows.length) return null;
    return mapLicenseRow(rows[0]);
  }

  async getLicenseHostsCount(licenseId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(licenseHosts)
      .where(eq(licenseHosts.licenseId, licenseId));
    return Number(result[0]?.count ?? 0);
  }

  async addLicenseHost(licenseId: string, hostUuid: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .insert(licenseHosts)
      .values({ licenseId, hostUuid, activatedAt: now })
      .onConflictDoNothing();
  }

  async removeLicenseHost(licenseId: string, hostUuid: string): Promise<void> {
    await db.delete(licenseHosts).where(and(eq(licenseHosts.licenseId, licenseId), eq(licenseHosts.hostUuid, hostUuid)));
  }

  async ensureHostRow(hostUuid: string): Promise<void> {
    const existing = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.hostUuid, hostUuid)).limit(1);
    if (existing.length) return;
    const now = new Date().toISOString();
    await db.insert(hosts).values({
      hostUuid,
      installationId: '',
      firstSeenAt: now,
      lastSeenAt: now,
      firstInstalledAt: now,
      version: '0.0.0',
      platform: 'unknown',
      arch: 'unknown',
      registrationStatus: 'registered',
      createdAt: now,
      updatedAt: now,
    });
  }

  async getLicenseForHost(hostUuid: string): Promise<License | null> {
    const rows = await db
      .select({ license: licenses })
      .from(licenses)
      .innerJoin(licenseHosts, eq(licenses.id, licenseHosts.licenseId))
      .where(eq(licenseHosts.hostUuid, hostUuid))
      .orderBy(desc(licenses.expiresAt))
      .limit(1);
    if (!rows.length) return null;
    return mapLicenseRow(rows[0].license);
  }

  async isHostInLicense(licenseId: string, hostUuid: string): Promise<boolean> {
    const rows = await db
      .select({ id: licenseHosts.id })
      .from(licenseHosts)
      .where(and(eq(licenseHosts.licenseId, licenseId), eq(licenseHosts.hostUuid, hostUuid)))
      .limit(1);
    return rows.length > 0;
  }

  async getHostsForLicense(licenseId: string): Promise<Array<{ host_uuid: string; activated_at: string; last_seen_at: string | null; isOnline: boolean }>> {
    const rows = await db
      .select({
        hostUuid: licenseHosts.hostUuid,
        activatedAt: licenseHosts.activatedAt,
        lastSeenAt: hosts.lastSeenAt,
      })
      .from(licenseHosts)
      .leftJoin(hosts, eq(hosts.hostUuid, licenseHosts.hostUuid))
      .where(eq(licenseHosts.licenseId, licenseId));

    return rows.map(r => ({
      host_uuid: r.hostUuid,
      activated_at: r.activatedAt,
      last_seen_at: r.lastSeenAt || null,
      isOnline: isOnline(r.lastSeenAt),
    }));
  }

  async getLicenseMembers(licenseId: string): Promise<Array<{ accountId: string; email: string; role: string }>> {
    const rows = await db
      .select({
        accountId: licenseMembers.accountId,
        email: accounts.email,
        role: licenseMembers.role,
      })
      .from(licenseMembers)
      .innerJoin(accounts, eq(accounts.id, licenseMembers.accountId))
      .where(eq(licenseMembers.licenseId, licenseId));

    return rows.map(r => ({
      accountId: r.accountId,
      email: r.email,
      role: r.role || 'member',
    }));
  }

  async addLicenseMember(licenseId: string, accountId: string): Promise<void> {
    const now = new Date().toISOString();
    await db.insert(licenseMembers).values({ licenseId, accountId, role: 'member', createdAt: now });
  }

  async removeLicenseMember(licenseId: string, accountId: string): Promise<void> {
    await db.delete(licenseMembers).where(and(eq(licenseMembers.licenseId, licenseId), eq(licenseMembers.accountId, accountId)));
  }

  async getTeamsLicenseUserCount(licenseId: string): Promise<number> {
    const primary = await db.select({ id: licenses.id }).from(licenses).where(eq(licenses.id, licenseId)).limit(1);
    if (!primary.length) return 0;
    const result = await db.select({ c: sql<number>`COUNT(*)` }).from(licenseMembers).where(eq(licenseMembers.licenseId, licenseId));
    return 1 + Number(result[0]?.c ?? 0);
  }

  async listLicensesWithHostCounts(): Promise<Array<License & { hostCount: number; firstDeviceId?: string | null }>> {
    const licenseRows = await db
      .select({
        license: licenses,
        hostCount: sql<number>`CAST(COUNT(${licenseHosts.id}) AS INTEGER)`,
      })
      .from(licenses)
      .leftJoin(licenseHosts, eq(licenseHosts.licenseId, licenses.id))
      .groupBy(licenses.id)
      .orderBy(desc(licenses.createdAt));

    if (licenseRows.length === 0) return [];

    const licenseIds = licenseRows.map(r => r.license.id);
    const firstDeviceRows = await db
      .selectDistinctOn([licenseHosts.licenseId], {
        licenseId: licenseHosts.licenseId,
        hostUuid: licenseHosts.hostUuid,
      })
      .from(licenseHosts)
      .where(inArray(licenseHosts.licenseId, licenseIds))
      .orderBy(licenseHosts.licenseId, asc(licenseHosts.activatedAt));

    const firstDeviceMap = new Map(firstDeviceRows.map(r => [r.licenseId, r.hostUuid]));

    return licenseRows.map(r => ({
      ...mapLicenseRow(r.license),
      hostCount: Number(r.hostCount ?? 0),
      firstDeviceId: firstDeviceMap.get(r.license.id) ?? null,
    }));
  }

  async revokeLicense(licenseId: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(licenses).set({ state: 'revoked', updatedAt: now }).where(eq(licenses.id, licenseId));
  }

  async extendLicense(licenseId: string, newExpiresAt: number): Promise<void> {
    const now = new Date().toISOString();
    await db.update(licenses).set({ expiresAt: newExpiresAt, state: 'active', updatedAt: now }).where(eq(licenses.id, licenseId));
  }

  async upgradeLicenseToPro(licenseId: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(licenses).set({ tier: 'pro', deviceLimit: 30, updatedAt: now }).where(eq(licenses.id, licenseId));
  }

  async updateLicenseBilling(licenseId: string, updates: {
    paymentMethod?: string;
    amountPaid?: number;
    currency?: string;
    paymentProvider?: string;
    invoiceId?: string;
    discountPercent?: number;
    notes?: string;
  }): Promise<void> {
    const set: Record<string, any> = {};
    if (updates.paymentMethod !== undefined) set.paymentMethod = updates.paymentMethod;
    if (updates.amountPaid !== undefined) set.amountPaid = updates.amountPaid;
    if (updates.currency !== undefined) set.currency = updates.currency;
    if (updates.paymentProvider !== undefined) set.paymentProvider = updates.paymentProvider;
    if (updates.invoiceId !== undefined) set.invoiceId = updates.invoiceId;
    if (updates.discountPercent !== undefined) set.discountPercent = updates.discountPercent;
    if (updates.notes !== undefined) set.notes = updates.notes;
    if (Object.keys(set).length === 0) return;
    const now = new Date().toISOString();
    set.updatedAt = now;
    await db.update(licenses).set(set).where(eq(licenses.id, licenseId));
  }

  async updateLicenseOverridesJson(licenseId: string, overridesJson: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .update(licenses)
      .set({ overridesJson, updatedAt: now })
      .where(eq(licenses.id, licenseId));
  }

  // === DEVICE-ONLY LICENSE ===

  async createDeviceOnlyLicense(deviceId: string, tier: string, expiresAt: number, signature: string, licenseId?: string): Promise<License> {
    const now = new Date().toISOString();
    const nowUnix = Math.floor(Date.now() / 1000);
    const resolvedLicenseId = licenseId ?? await this.getNextLicenseId();

    await this.ensureDeviceAccount(deviceId);

    await db.insert(licenses).values({
      id: resolvedLicenseId,
      accountId: deviceId,
      tier,
      deviceLimit: 1,
      issuedAt: nowUnix,
      expiresAt,
      state: tier === 'TRIAL' ? 'trial_active' : 'active',
      signature,
      createdAt: now,
      updatedAt: now,
      isDeviceOnly: 1,
    });

    await this.addLicenseHost(resolvedLicenseId, deviceId);

    const rows = await db.select().from(licenses).where(eq(licenses.id, resolvedLicenseId)).limit(1);
    return mapLicenseRow(rows[0]);
  }

  async getLicenseByDeviceId(deviceId: string): Promise<License | null> {
    return this.getLicenseForHost(deviceId);
  }

  async linkLicenseToAccount(licenseId: string, accountId: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(licenses).set({ accountId, isDeviceOnly: 0, updatedAt: now }).where(eq(licenses.id, licenseId));
  }

  // === DEVICE ACCOUNT ===

  async ensureDeviceAccount(hostUuid: string): Promise<void> {
    const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, hostUuid)).limit(1);
    if (existing.length) return;
    const now = new Date().toISOString();
    const email = `${hostUuid}@device.local`;
    await db.insert(accounts).values({ id: hostUuid, email, passwordHash: '.', trialUsed: 1, createdAt: now, updatedAt: now }).onConflictDoNothing();
  }

  // === DEVICE TRIAL ===

  async isDeviceTrialUsed(hostUuid: string): Promise<boolean> {
    const rows = await db.select().from(deviceTrialUsed).where(eq(deviceTrialUsed.hostUuid, hostUuid)).limit(1);
    return rows.length > 0;
  }

  async setDeviceTrialUsed(hostUuid: string): Promise<void> {
    await db.insert(deviceTrialUsed).values({ hostUuid }).onConflictDoNothing();
  }

  async getOrCreateDeviceTrial(deviceId: string, trialDays = 7): Promise<{ trialStartedAt: string; trialEndsAt: string; trialExtendedAt: string | null }> {
    const now = new Date();
    const nowIso = now.toISOString();
    // In dev mode 1 "day unit" = 1 minute; in production 1 "day unit" = 24 hours.
    const TIME_UNIT_MS = process.env.DEV_MODE === "true" ? 60 * 1000 : 24 * 60 * 60 * 1000;
    const endsAtIso = new Date(now.getTime() + trialDays * TIME_UNIT_MS).toISOString();

    const existing = await db.select().from(deviceTrials).where(eq(deviceTrials.deviceId, deviceId)).limit(1);
    if (existing.length) {
      return {
        trialStartedAt: existing[0].trialStartedAt,
        trialEndsAt: existing[0].trialEndsAt,
        trialExtendedAt: existing[0].trialExtendedAt ?? null,
      };
    }

    await db.insert(deviceTrials).values({
      deviceId,
      trialStartedAt: nowIso,
      trialEndsAt: endsAtIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return { trialStartedAt: nowIso, trialEndsAt: endsAtIso, trialExtendedAt: null };
  }

  async extendDeviceTrial(deviceId: string, extraDays = 7): Promise<{ trialEndsAt: string }> {
    const now = new Date().toISOString();
    const rows = await db.select().from(deviceTrials).where(eq(deviceTrials.deviceId, deviceId)).limit(1);
    if (!rows.length) throw new Error('Device trial not found');
    if (rows[0].trialExtendedAt) throw new Error('Trial already extended');
    const baseEnd = new Date(rows[0].trialEndsAt);
    const TIME_UNIT_MS = process.env.DEV_MODE === "true" ? 60 * 1000 : 24 * 60 * 60 * 1000;
    const newEnds = new Date(baseEnd.getTime() + extraDays * TIME_UNIT_MS).toISOString();
    await db.update(deviceTrials).set({ trialExtendedAt: now, trialEndsAt: newEnds, updatedAt: now }).where(eq(deviceTrials.deviceId, deviceId));
    return { trialEndsAt: newEnds };
  }

  async canExtendDeviceTrial(deviceId: string): Promise<boolean> {
    const rows = await db.select({ trialExtendedAt: deviceTrials.trialExtendedAt }).from(deviceTrials).where(eq(deviceTrials.deviceId, deviceId)).limit(1);
    if (!rows.length) return false;
    return !rows[0].trialExtendedAt;
  }

  // === MONTHLY SHARES ===

  async getMonthlyShareCount(deviceId: string, ym: string): Promise<number> {
    const rows = await db
      .select({ sharesCreated: deviceUsageMonthly.sharesCreated })
      .from(deviceUsageMonthly)
      .where(and(eq(deviceUsageMonthly.deviceId, deviceId), eq(deviceUsageMonthly.ym, ym)))
      .limit(1);
    return Number(rows[0]?.sharesCreated ?? 0);
  }

  async incrementMonthlyShares(deviceId: string, ym: string): Promise<{ count: number }> {
    const now = new Date().toISOString();
    await db
      .insert(deviceUsageMonthly)
      .values({ deviceId, ym, sharesCreated: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: [deviceUsageMonthly.deviceId, deviceUsageMonthly.ym],
        set: {
          sharesCreated: sql`${deviceUsageMonthly.sharesCreated} + 1`,
          updatedAt: now,
        },
      });
    const rows = await db
      .select({ sharesCreated: deviceUsageMonthly.sharesCreated })
      .from(deviceUsageMonthly)
      .where(and(eq(deviceUsageMonthly.deviceId, deviceId), eq(deviceUsageMonthly.ym, ym)))
      .limit(1);
    return { count: Number(rows[0]?.sharesCreated ?? 0) };
  }

  /** Returns share count for the current billing cycle identified by cycleStartSec (Unix seconds). */
  async getShareCountSinceCycleStart(deviceId: string, cycleStartSec: number): Promise<number> {
    const key = String(cycleStartSec);
    return this.getMonthlyShareCount(deviceId, key);
  }

  /** Atomically increments share count for the current billing cycle. */
  async incrementSharesForCycle(deviceId: string, cycleStartSec: number): Promise<{ count: number }> {
    const key = String(cycleStartSec);
    return this.incrementMonthlyShares(deviceId, key);
  }

  // === LOGOUT REQUESTS ===

  async setLogoutRequested(hostUuid: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .insert(deviceLogoutRequests)
      .values({ hostUuid, requestedAt: now })
      .onConflictDoUpdate({ target: deviceLogoutRequests.hostUuid, set: { requestedAt: now } });
  }

  async consumeLogoutRequested(hostUuid: string): Promise<boolean> {
    const rows = await db.select().from(deviceLogoutRequests).where(eq(deviceLogoutRequests.hostUuid, hostUuid)).limit(1);
    if (!rows.length) return false;
    await db.delete(deviceLogoutRequests).where(eq(deviceLogoutRequests.hostUuid, hostUuid));
    return true;
  }

  // === APP SETTINGS ===

  async getSetting(key: string): Promise<string | null> {
    const rows = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  // === IN-APP UPDATES (manifest) ===

  async listUpdateManifestEntries(): Promise<Array<{ id: number; version: string; releaseDate: string; channel: string; changelog: string[]; downloads: { win?: string; mac?: string; linux?: string } }>> {
    const rows = await db.select().from(updateManifestEntries).orderBy(desc(updateManifestEntries.releaseDate));
    return rows.map((r) => {
      let changelog: string[] = [];
      let downloads: { win?: string; mac?: string; linux?: string } = {};
      try {
        const parsed = JSON.parse(r.changelogJson || "[]");
        if (Array.isArray(parsed)) changelog = parsed.filter((x) => typeof x === "string");
      } catch (_) {}
      try {
        const parsed = JSON.parse(r.downloadsJson || "{}");
        if (parsed && typeof parsed === "object") downloads = parsed;
      } catch (_) {}
      return {
        id: r.id,
        version: r.version,
        releaseDate: r.releaseDate,
        channel: r.channel,
        changelog,
        downloads,
      };
    });
  }

  async upsertUpdateManifestEntry(entry: UpdateManifestEntry): Promise<{ id: number; version: string }> {
    const now = new Date().toISOString();
    const version = String(entry.version || "").trim();
    const releaseDate = String(entry.releaseDate || "").trim();
    const channel = String(entry.channel || "stable").trim() || "stable";
    const changelogJson = JSON.stringify(Array.isArray(entry.changelog) ? entry.changelog : []);
    const downloadsJson = JSON.stringify(entry.downloads || {});

    const inserted = await db
      .insert(updateManifestEntries)
      .values({
        version,
        releaseDate,
        channel,
        changelogJson,
        downloadsJson,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: updateManifestEntries.version,
        set: {
          releaseDate,
          channel,
          changelogJson,
          downloadsJson,
          updatedAt: now,
        },
      })
      .returning({ id: updateManifestEntries.id, version: updateManifestEntries.version });

    return { id: inserted[0]!.id, version: inserted[0]!.version };
  }

  async deleteUpdateManifestEntry(version: string): Promise<boolean> {
    const v = String(version || "").trim();
    if (!v) return false;
    const deleted = await db
      .delete(updateManifestEntries)
      .where(eq(updateManifestEntries.version, v))
      .returning({ id: updateManifestEntries.id });
    return deleted.length > 0;
  }

  // === USAGE AGGREGATES ===

  async reportUsageAggregates(
    hostUuid: string,
    aggregates: Array<{ period_start: string; period_end: string; uptime_seconds: number; storage_used_bytes: number; bytes_uploaded: number; bytes_downloaded: number; total_shares: number; total_devices: number }>
  ): Promise<void> {
    const now = new Date().toISOString();
    for (const a of aggregates) {
      await db
        .insert(usageAggregates)
        .values({
          hostUuid,
          periodStart: a.period_start,
          periodEnd: a.period_end,
          uptimeSeconds: a.uptime_seconds ?? 0,
          storageUsedBytes: a.storage_used_bytes ?? 0,
          bytesUploaded: a.bytes_uploaded ?? 0,
          bytesDownloaded: a.bytes_downloaded ?? 0,
          totalShares: a.total_shares ?? 0,
          totalDevices: a.total_devices ?? 0,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [usageAggregates.hostUuid, usageAggregates.periodStart],
          set: {
            periodEnd: a.period_end,
            uptimeSeconds: a.uptime_seconds ?? 0,
            storageUsedBytes: a.storage_used_bytes ?? 0,
            bytesUploaded: a.bytes_uploaded ?? 0,
            bytesDownloaded: a.bytes_downloaded ?? 0,
            totalShares: a.total_shares ?? 0,
            totalDevices: a.total_devices ?? 0,
          },
        });
    }
  }

  async getUsageAggregates(filters?: { hostUuid?: string; limit?: number }): Promise<UsageAggregate[]> {
    const limit = Math.min(500, Math.max(1, filters?.limit ?? 100));
    const whereClause = filters?.hostUuid ? eq(usageAggregates.hostUuid, filters.hostUuid) : undefined;

    const rows = await db
      .select()
      .from(usageAggregates)
      .where(whereClause)
      .orderBy(desc(usageAggregates.periodStart))
      .limit(limit);

    return rows.map(r => ({
      id: r.id,
      hostUuid: r.hostUuid,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      uptimeSeconds: r.uptimeSeconds ?? 0,
      storageUsedBytes: r.storageUsedBytes ?? 0,
      bytesUploaded: r.bytesUploaded ?? 0,
      bytesDownloaded: r.bytesDownloaded ?? 0,
      totalShares: r.totalShares ?? 0,
      totalDevices: r.totalDevices ?? 0,
      createdAt: r.createdAt,
    }));
  }

  // === BILLING ===

  async getBillingSummary(): Promise<BillingSummary> {
    const licRows = await db
      .select({ license: licenses, email: accounts.email })
      .from(licenses)
      .leftJoin(accounts, eq(accounts.id, licenses.accountId))
      .where(inArray(licenses.state, ['active', 'grace', 'trial_active']));

    let totalMonthlyRevenue = 0;
    let totalYearlyRevenue = 0;
    let totalActiveSubscriptions = 0;
    let totalTrialAccounts = 0;
    const tierStats: Record<string, { monthly: number; yearly: number; count: number }> = {};
    const providerStats: Record<string, { amount: number; count: number }> = {};

    for (const { license: lic } of licRows) {
      const amount = Number(lic.amountPaid ?? 0);
      const interval = lic.planInterval ?? 'monthly';
      const tier = lic.tier || 'pro';
      const provider = lic.paymentProvider || 'manual';

      if (lic.state === 'trial_active') { totalTrialAccounts++; continue; }

      totalActiveSubscriptions++;
      const monthlyAmount = interval === 'yearly' ? amount / 12 : amount;
      const yearlyAmount = interval === 'yearly' ? amount : amount * 12;
      totalMonthlyRevenue += monthlyAmount;
      totalYearlyRevenue += yearlyAmount;

      if (!tierStats[tier]) tierStats[tier] = { monthly: 0, yearly: 0, count: 0 };
      tierStats[tier].monthly += monthlyAmount;
      tierStats[tier].yearly += yearlyAmount;
      tierStats[tier].count++;

      if (!providerStats[provider]) providerStats[provider] = { amount: 0, count: 0 };
      providerStats[provider].amount += amount;
      providerStats[provider].count++;
    }

    return {
      totalMonthlyRevenue,
      totalYearlyRevenue,
      totalActiveSubscriptions,
      totalTrialAccounts,
      revenueByTier: Object.entries(tierStats).map(([tier, stats]) => ({ tier, ...stats })),
      revenueByProvider: Object.entries(providerStats).map(([provider, stats]) => ({ provider, ...stats })),
    };
  }

  async getAccountWithBilling(accountId: string): Promise<AccountWithBilling | null> {
    const account = await this.getAccountById(accountId);
    if (!account) return null;
    const license = await this.getActiveLicenseForAccount(accountId);
    let teamMembers: Array<{ accountId: string; email: string; role: string }> = [];
    let teamInvs: TeamInvitation[] = [];
    if (license && license.tier === 'teams') {
      teamMembers = await this.getLicenseMembers(license.id);
      teamInvs = await this.getTeamInvitations(license.id);
    }
    return { ...account, license, teamMembers, teamInvitations: teamInvs };
  }

  async listAccountsWithBilling(): Promise<AccountWithBilling[]> {
    const accs = await this.listAccounts();
    const result: AccountWithBilling[] = [];
    for (const account of accs) {
      const license = await this.getActiveLicenseForAccount(account.id);
      let teamMembers: Array<{ accountId: string; email: string; role: string }> = [];
      let teamInvs: TeamInvitation[] = [];
      if (license && license.tier === 'teams') {
        teamMembers = await this.getLicenseMembers(license.id);
        teamInvs = await this.getTeamInvitations(license.id);
      }
      result.push({ ...account, license, teamMembers, teamInvitations: teamInvs });
    }
    return result;
  }

  // === TEAM INVITATIONS ===

  async getTeamInvitations(licenseId: string): Promise<TeamInvitation[]> {
    const rows = await db
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.licenseId, licenseId))
      .orderBy(desc(teamInvitations.invitedAt));
    return rows.map(r => ({
      id: r.id,
      licenseId: r.licenseId,
      email: r.email,
      invitedBy: r.invitedBy,
      invitedAt: r.invitedAt,
      status: r.status,
    }));
  }

  async addTeamInvitation(licenseId: string, email: string, invitedBy: string): Promise<TeamInvitation> {
    const now = new Date().toISOString();
    const result = await db
      .insert(teamInvitations)
      .values({ licenseId, email: email.toLowerCase(), invitedBy, invitedAt: now, status: 'pending' })
      .returning();
    return {
      id: result[0].id,
      licenseId,
      email: email.toLowerCase(),
      invitedBy,
      invitedAt: now,
      status: 'pending',
    };
  }

  async removeTeamInvitation(invitationId: number): Promise<void> {
    await db.delete(teamInvitations).where(eq(teamInvitations.id, invitationId));
  }

  async getTeamInvitationByEmail(email: string): Promise<TeamInvitation | null> {
    const rows = await db
      .select()
      .from(teamInvitations)
      .where(and(eq(teamInvitations.email, email.toLowerCase()), eq(teamInvitations.status, 'pending')))
      .orderBy(desc(teamInvitations.invitedAt))
      .limit(1);
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, licenseId: r.licenseId, email: r.email, invitedBy: r.invitedBy, invitedAt: r.invitedAt, status: r.status };
  }

  async acceptTeamInvitation(invitationId: number, accountId: string): Promise<void> {
    const rows = await db.select().from(teamInvitations).where(eq(teamInvitations.id, invitationId)).limit(1);
    if (!rows.length) throw new Error('Invitation not found');
    await this.addLicenseMember(rows[0].licenseId, accountId);
    await db.update(teamInvitations).set({ status: 'accepted' }).where(eq(teamInvitations.id, invitationId));
  }

  // === SUBSCRIPTIONS ===

  async createSubscription(subscription: Omit<Subscription, 'createdAt' | 'updatedAt'>): Promise<Subscription> {
    const now = new Date().toISOString();
    await db.insert(subscriptions).values({
      id: subscription.id,
      accountId: subscription.accountId,
      licenseId: subscription.licenseId,
      provider: subscription.provider,
      providerSubscriptionId: subscription.providerSubscriptionId,
      plan: subscription.plan,
      status: subscription.status,
      amount: subscription.amount,
      currency: subscription.currency,
      interval: subscription.interval,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      paymentDueDate: subscription.paymentDueDate,
      graceEndsAt: subscription.graceEndsAt,
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id)).limit(1);
    return mapSubscriptionRow(rows[0]);
  }

  async getSubscriptionById(subscriptionId: string): Promise<Subscription | null> {
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
    if (!rows.length) return null;
    return mapSubscriptionRow(rows[0]);
  }

  async getSubscriptionByAccountId(accountId: string): Promise<Subscription | null> {
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.accountId, accountId)).orderBy(desc(subscriptions.createdAt)).limit(1);
    if (!rows.length) return null;
    return mapSubscriptionRow(rows[0]);
  }

  async getSubscriptionByLicenseId(licenseId: string): Promise<Subscription | null> {
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.licenseId, licenseId)).orderBy(desc(subscriptions.createdAt)).limit(1);
    if (!rows.length) return null;
    return mapSubscriptionRow(rows[0]);
  }

  async updateSubscription(subscriptionId: string, updates: Partial<Subscription>): Promise<void> {
    const now = new Date().toISOString();
    const set: Record<string, any> = { updatedAt: now };
    if (updates.status !== undefined) set.status = updates.status;
    if (updates.currentPeriodStart !== undefined) set.currentPeriodStart = updates.currentPeriodStart;
    if (updates.currentPeriodEnd !== undefined) set.currentPeriodEnd = updates.currentPeriodEnd;
    if (updates.paymentDueDate !== undefined) set.paymentDueDate = updates.paymentDueDate;
    if (updates.graceEndsAt !== undefined) set.graceEndsAt = updates.graceEndsAt;
    if (updates.amount !== undefined) set.amount = updates.amount;
    if (updates.plan !== undefined) set.plan = updates.plan;
    await db.update(subscriptions).set(set).where(eq(subscriptions.id, subscriptionId));
  }

  async listSubscriptions(filters?: { status?: string; provider?: string }): Promise<Subscription[]> {
    const conditions = [];
    if (filters?.status) conditions.push(eq(subscriptions.status, filters.status));
    if (filters?.provider) conditions.push(eq(subscriptions.provider, filters.provider));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(subscriptions).where(whereClause).orderBy(desc(subscriptions.createdAt));
    return rows.map(mapSubscriptionRow);
  }

  // === PAYMENTS ===

  async createPayment(payment: Omit<Payment, 'createdAt'>): Promise<Payment> {
    const now = new Date().toISOString();
    await db.insert(payments).values({
      id: payment.id,
      subscriptionId: payment.subscriptionId,
      accountId: payment.accountId,
      deviceId: payment.deviceId,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      invoiceUrl: payment.invoiceUrl,
      createdAt: now,
    });
    const rows = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
    return mapPaymentRow(rows[0]);
  }

  async getPaymentById(paymentId: string): Promise<Payment | null> {
    const rows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!rows.length) return null;
    return mapPaymentRow(rows[0]);
  }

  async getPaymentsByAccountId(accountId: string): Promise<Payment[]> {
    const rows = await db.select().from(payments).where(eq(payments.accountId, accountId)).orderBy(desc(payments.createdAt));
    return rows.map(mapPaymentRow);
  }

  async getPaymentsBySubscriptionId(subscriptionId: string): Promise<Payment[]> {
    const rows = await db.select().from(payments).where(eq(payments.subscriptionId, subscriptionId)).orderBy(desc(payments.createdAt));
    return rows.map(mapPaymentRow);
  }

  async updatePaymentStatus(paymentId: string, status: string): Promise<void> {
    await db.update(payments).set({ status }).where(eq(payments.id, paymentId));
  }

  // === DEVICE RECOVERY ===

  async createDeviceRecoveryRequest(request: Omit<DeviceRecoveryRequest, 'createdAt' | 'resolvedAt' | 'resolvedBy'>): Promise<DeviceRecoveryRequest> {
    const now = new Date().toISOString();
    await db.insert(deviceRecoveryRequests).values({
      id: request.id,
      accountId: request.accountId,
      oldDeviceId: request.oldDeviceId,
      newDeviceId: request.newDeviceId,
      reason: request.reason,
      status: request.status,
      adminNotes: request.adminNotes,
      createdAt: now,
    });
    const rows = await db.select().from(deviceRecoveryRequests).where(eq(deviceRecoveryRequests.id, request.id)).limit(1);
    return mapRecoveryRow(rows[0]);
  }

  async getDeviceRecoveryRequestById(requestId: string): Promise<DeviceRecoveryRequest | null> {
    const rows = await db.select().from(deviceRecoveryRequests).where(eq(deviceRecoveryRequests.id, requestId)).limit(1);
    if (!rows.length) return null;
    return mapRecoveryRow(rows[0]);
  }

  async getPendingRecoveryRequests(): Promise<DeviceRecoveryRequest[]> {
    const rows = await db.select().from(deviceRecoveryRequests).where(eq(deviceRecoveryRequests.status, 'pending')).orderBy(desc(deviceRecoveryRequests.createdAt));
    return rows.map(mapRecoveryRow);
  }

  async getRecoveryRequestsByAccountId(accountId: string): Promise<DeviceRecoveryRequest[]> {
    const rows = await db.select().from(deviceRecoveryRequests).where(eq(deviceRecoveryRequests.accountId, accountId)).orderBy(desc(deviceRecoveryRequests.createdAt));
    return rows.map(mapRecoveryRow);
  }

  async resolveDeviceRecoveryRequest(requestId: string, status: 'approved' | 'rejected', adminNotes: string, resolvedBy: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .update(deviceRecoveryRequests)
      .set({ status, adminNotes, resolvedAt: now, resolvedBy })
      .where(eq(deviceRecoveryRequests.id, requestId));

    if (status === 'approved') {
      const request = await this.getDeviceRecoveryRequestById(requestId);
      if (request) {
        const oldLicense = await this.getLicenseForHost(request.oldDeviceId);
        if (oldLicense) {
          await this.removeLicenseHost(oldLicense.id, request.oldDeviceId);
          await this.addLicenseHost(oldLicense.id, request.newDeviceId);
        }
      }
    }
  }

  // === REFERRALS ===

  async createReferral(referral: Omit<Referral, 'createdAt'>): Promise<Referral> {
    const now = new Date().toISOString();
    await db.insert(referrals).values({
      id: referral.id,
      referrerAccountId: referral.referrerAccountId,
      referredAccountId: referral.referredAccountId,
      referralCode: referral.referralCode,
      daysGranted: referral.daysGranted,
      status: referral.status,
      createdAt: now,
    });
    const rows = await db.select().from(referrals).where(eq(referrals.id, referral.id)).limit(1);
    return mapReferralRow(rows[0]);
  }

  async getReferralsByReferrerId(referrerAccountId: string): Promise<Referral[]> {
    const rows = await db.select().from(referrals).where(eq(referrals.referrerAccountId, referrerAccountId)).orderBy(desc(referrals.createdAt));
    return rows.map(mapReferralRow);
  }

  async getReferralByReferredId(referredAccountId: string): Promise<Referral | null> {
    const rows = await db.select().from(referrals).where(eq(referrals.referredAccountId, referredAccountId)).limit(1);
    if (!rows.length) return null;
    return mapReferralRow(rows[0]);
  }

  async getAccountByReferralCode(referralCode: string): Promise<Account | null> {
    const rows = await db.select().from(accounts).where(eq(accounts.referralCode, referralCode)).limit(1);
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  async getReferralStats(accountId: string): Promise<ReferralStats> {
    const account = await this.getAccountById(accountId);
    if (!account) {
      return { referralCode: '', referralLink: '', totalReferrals: 0, daysEarned: 0, referrals: [] };
    }

    const refs = await this.getReferralsByReferrerId(accountId);
    const referralDetails: Array<{ email: string; date: number; daysGranted: number }> = [];

    for (const ref of refs) {
      const referredAccount = await this.getAccountById(ref.referredAccountId);
      if (referredAccount) {
        const emailParts = referredAccount.email.split('@');
        const maskedEmail = emailParts[0].substring(0, 2) + '***@' + emailParts[1];
        referralDetails.push({
          email: maskedEmail,
          date: Math.floor(new Date(ref.createdAt).getTime() / 1000),
          daysGranted: ref.daysGranted,
        });
      }
    }

    return {
      referralCode: account.referralCode || '',
      referralLink: account.referralCode ? `https://joincloud.in/r/${account.referralCode}` : '',
      totalReferrals: account.referralCount || 0,
      daysEarned: account.referralDaysEarned || 0,
      referrals: referralDetails,
    };
  }

  // === LICENSE CHECK ===

  async getLicenseCheckResponse(deviceId: string): Promise<LicenseCheckResponse> {
    const webUrl = process.env.JOINCLOUD_WEB_URL || 'https://dashboard.joincloud.in';
    const now = Math.floor(Date.now() / 1000);

    const host = await this.getHostByUUID(deviceId);
    const hostRow = host ? await db.select({ suspended: hosts.suspended }).from(hosts).where(eq(hosts.hostUuid, deviceId)).limit(1) : [];
    const isSuspended = hostRow.length > 0 && hostRow[0].suspended === 1;

    const license = await this.getLicenseForHost(deviceId);
    let account: Account | null = null;
    let subscription: Subscription | null = null;

    if (license && license.accountId && !license.accountId.includes('@device.local')) {
      account = await this.getAccountById(license.accountId);
      subscription = await this.getSubscriptionByAccountId(license.accountId);
    }

    const daysRemaining = license ? Math.max(0, Math.ceil((license.expiresAt - now) / (24 * 60 * 60))) : null;
    const graceDaysRemaining = license?.graceEndsAt ? Math.max(0, Math.ceil((license.graceEndsAt - now) / (24 * 60 * 60))) : null;

    let state = 'expired';
    if (license) {
      if (license.state === 'revoked') {
        state = 'revoked';
      } else if (isSuspended) {
        state = 'suspended';
      } else if (license.expiresAt > now) {
        state = license.state;
      } else if (license.graceEndsAt && license.graceEndsAt > now) {
        state = 'grace';
      } else {
        state = 'expired';
      }
    }

    const hasAccount = !!account && !account.email.includes('@device.local');
    const isFreeTierActive = state === 'active' && (license?.tier === 'FREE' || (license?.tier || '').toUpperCase() === 'FREE');
    const isBlocked = (state === 'expired' || state === 'suspended' || state === 'revoked') && !isFreeTierActive;

    let primaryButton = { label: 'Sign In', action: 'sign_in', url: `${webUrl}/auth/login?deviceId=${deviceId}` };
    let secondaryButton: { label: string; action: string; url: string } | null = null;
    let bannerText = 'Welcome to JoinCloud';
    let bannerStyle = 'info';
    let blockingMessage: string | null = null;

    if (state === 'trial_active') {
      if (hasAccount) {
        primaryButton = { label: 'Dashboard', action: 'dashboard', url: `${webUrl}/dashboard` };
        secondaryButton = { label: 'Upgrade', action: 'upgrade', url: `${webUrl}/pricing` };
      }
      bannerText = `Trial: ${daysRemaining} days remaining`;
    } else if (state === 'active' && (license?.tier === 'FREE' || (license?.tier || '').toUpperCase() === 'FREE')) {
      primaryButton = { label: 'Dashboard', action: 'dashboard', url: `${webUrl}/dashboard` };
      secondaryButton = { label: 'Upgrade', action: 'upgrade', url: `${webUrl}/pricing` };
      bannerText = 'Free Tier - Active';
      blockingMessage = null;
    } else if (state === 'active') {
      primaryButton = { label: 'Dashboard', action: 'dashboard', url: `${webUrl}/dashboard` };
      bannerText = `${license?.tier?.toUpperCase() || 'PRO'} - Active`;
    } else if (state === 'grace') {
      primaryButton = { label: 'Complete Payment', action: 'payment', url: `${webUrl}/billing` };
      secondaryButton = { label: 'Dashboard', action: 'dashboard', url: `${webUrl}/dashboard` };
      bannerText = `Payment Due - ${graceDaysRemaining} days grace remaining`;
      bannerStyle = 'warning';
    } else if (state === 'suspended') {
      primaryButton = { label: 'Resolve Payment', action: 'resolve_payment', url: `${webUrl}/billing/resolve` };
      secondaryButton = { label: 'Contact Support', action: 'support', url: `${webUrl}/support` };
      bannerText = 'Account Suspended - Payment Required';
      bannerStyle = 'error';
      blockingMessage = 'Your account is suspended due to payment failure. Please resolve to continue.';
    } else if (state === 'expired') {
      if (hasAccount) {
        primaryButton = { label: 'Renew', action: 'renew', url: `${webUrl}/pricing` };
        secondaryButton = { label: 'View Plans', action: 'plans', url: `${webUrl}/pricing` };
        blockingMessage = 'Your subscription has expired. Renew to continue using JoinCloud.';
      } else {
        primaryButton = { label: 'Sign In to Continue', action: 'sign_in', url: `${webUrl}/auth/login?deviceId=${deviceId}` };
        secondaryButton = { label: 'View Plans', action: 'plans', url: `${webUrl}/pricing` };
        blockingMessage = 'Your trial has expired. Sign in to continue or view our plans.';
      }
      bannerText = license?.tier === 'TRIAL' ? 'Trial Expired' : 'Subscription Expired';
      bannerStyle = 'error';
    } else if (state === 'revoked') {
      primaryButton = { label: 'Contact Support', action: 'support', url: `${webUrl}/support` };
      bannerText = 'License Revoked';
      bannerStyle = 'error';
      blockingMessage = 'Your license has been revoked. Please contact support for assistance.';
    }

    return {
      deviceId,
      license: {
        id: license?.id || null,
        tier: license?.tier || 'TRIAL',
        state,
        expiresAt: license?.expiresAt || null,
        daysRemaining,
        graceEndsAt: license?.graceEndsAt || null,
        graceDaysRemaining,
      },
      account: {
        linked: hasAccount,
        email: account?.email || null,
        hasPaymentMethod: !!subscription,
      },
      subscription: subscription ? {
        active: subscription.status === 'active',
        status: subscription.status,
        renewalDate: subscription.currentPeriodEnd,
        paymentDueDate: subscription.paymentDueDate,
      } : null,
      ui: {
        primaryButton,
        secondaryButton,
        showSignOut: hasAccount,
        bannerText,
        bannerStyle,
        isBlocked,
        blockingMessage,
      },
    };
  }

  // === SUBSCRIPTION REQUESTS ===

  async createSubscriptionRequest(request: {
    id: string;
    status: "pending" | "approved" | "rejected";
    planId: string;
    email: string;
    phone?: string | null;
    accountId?: string | null;
    deviceId?: string | null;
    customUsers?: number | null;
    customDevices?: number | null;
    requestedDays?: number | null;
    requestedShareLimit?: number | null;
    requestedDeviceLimit?: number | null;
    notes?: string | null;
    licenseId?: string | null;
    approvedBy?: string | null;
    approvedAt?: string | null;
    createdAt: string;
  }): Promise<void> {
    await db.insert(subscriptionRequests).values({
      id: request.id,
      status: request.status,
      planId: request.planId,
      email: request.email,
      phone: request.phone ?? null,
      accountId: request.accountId ?? null,
      deviceId: request.deviceId ?? null,
      customUsers: request.customUsers ?? null,
      customDevices: request.customDevices ?? null,
      requestedDays: request.requestedDays ?? null,
      requestedShareLimit: request.requestedShareLimit ?? null,
      requestedDeviceLimit: request.requestedDeviceLimit ?? null,
      notes: request.notes ?? null,
      licenseId: request.licenseId ?? null,
      approvedBy: request.approvedBy ?? null,
      approvedAt: request.approvedAt ?? null,
      createdAt: request.createdAt,
    });
  }

  async listSubscriptionRequests(filters?: { status?: string }): Promise<any[]> {
    const whereClause = filters?.status ? eq(subscriptionRequests.status, filters.status) : undefined;
    return db.select().from(subscriptionRequests).where(whereClause).orderBy(desc(subscriptionRequests.createdAt));
  }

  async getSubscriptionRequestById(id: string): Promise<any | null> {
    const rows = await db.select().from(subscriptionRequests).where(eq(subscriptionRequests.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async updateSubscriptionRequest(id: string, updates: Partial<{
    status: "pending" | "approved" | "rejected";
    notes: string | null;
    licenseId: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
  }>): Promise<void> {
    const set: Record<string, any> = {};
    if (updates.status !== undefined) set.status = updates.status;
    if (updates.notes !== undefined) set.notes = updates.notes;
    if (updates.licenseId !== undefined) set.licenseId = updates.licenseId;
    if (updates.approvedBy !== undefined) set.approvedBy = updates.approvedBy;
    if (updates.approvedAt !== undefined) set.approvedAt = updates.approvedAt;
    if (Object.keys(set).length === 0) return;
    await db.update(subscriptionRequests).set(set).where(eq(subscriptionRequests.id, id));
  }

  // === SUSPENSION ===

  async suspendHost(hostUuid: string, reason: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(hosts).set({ suspended: 1, suspensionReason: reason, updatedAt: now }).where(eq(hosts.hostUuid, hostUuid));
  }

  async unsuspendHost(hostUuid: string): Promise<void> {
    const now = new Date().toISOString();
    await db.update(hosts).set({ suspended: 0, suspensionReason: null, updatedAt: now }).where(eq(hosts.hostUuid, hostUuid));
  }

  async isHostSuspended(hostUuid: string): Promise<boolean> {
    const rows = await db.select({ suspended: hosts.suspended }).from(hosts).where(eq(hosts.hostUuid, hostUuid)).limit(1);
    return rows[0]?.suspended === 1;
  }

  // === SUBSCRIPTION STATS ===

  async getSubscriptionStats(): Promise<SubscriptionStats> {
    const now = Math.floor(Date.now() / 1000);
    const oneMonthAgo = now - (30 * 24 * 60 * 60);

    const allSubs = await db.select().from(subscriptions);
    const activeSubs = allSubs.filter(s => s.status === 'active');

    let mrr = 0;
    for (const sub of activeSubs) {
      const amount = Number(sub.amount ?? 0);
      if (sub.interval === 'year') {
        mrr += amount / 12;
      } else {
        mrr += amount;
      }
    }

    const trialResult = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(licenses)
      .where(eq(licenses.state, 'trial_active'));

    const cancelledLastMonth = allSubs.filter(s =>
      s.status === 'cancelled' &&
      new Date(s.updatedAt).getTime() / 1000 > oneMonthAgo
    ).length;
    const churnRate = activeSubs.length > 0
      ? (cancelledLastMonth / (activeSubs.length + cancelledLastMonth)) * 100
      : 0;

    const planStats: Record<string, { count: number; revenue: number }> = {};
    for (const sub of activeSubs) {
      const plan = sub.plan || 'unknown';
      if (!planStats[plan]) planStats[plan] = { count: 0, revenue: 0 };
      planStats[plan].count++;
      planStats[plan].revenue += Number(sub.amount ?? 0);
    }

    const deviceStats = await db
      .select({
        platform: hosts.platform,
        count: sql<number>`COUNT(DISTINCT ${licenseHosts.hostUuid})`,
      })
      .from(licenseHosts)
      .innerJoin(hosts, eq(hosts.hostUuid, licenseHosts.hostUuid))
      .innerJoin(licenses, eq(licenses.id, licenseHosts.licenseId))
      .where(inArray(licenses.state, ['active', 'trial_active', 'grace']))
      .groupBy(hosts.platform);

    return {
      totalMonthlyRevenue: mrr,
      totalYearlyRevenue: mrr * 12,
      mrr,
      arr: mrr * 12,
      activeSubscriptions: activeSubs.length,
      trialUsers: Number(trialResult[0]?.c ?? 0),
      churnRate: Math.round(churnRate * 100) / 100,
      byCountry: [],
      byPlan: Object.entries(planStats).map(([plan, stats]) => ({ plan, ...stats })),
      byDevice: deviceStats.map(d => ({ platform: d.platform || 'unknown', count: Number(d.count ?? 0) })),
    };
  }
}

// Seed default app settings on first run
async function seedDefaultSettings() {
  const paymentMode = await db.select().from(appSettings).where(eq(appSettings.key, 'payment_mode')).limit(1);
  if (!paymentMode.length) {
    await db.insert(appSettings).values({ key: 'payment_mode', value: 'LIVE' }).onConflictDoNothing();
  }
  const subMode = await db.select().from(appSettings).where(eq(appSettings.key, 'subscription_mode')).limit(1);
  if (!subMode.length) {
    await db.insert(appSettings).values({ key: 'subscription_mode', value: 'automatic' }).onConflictDoNothing();
  }
}

seedDefaultSettings().catch(console.error);

export const storage = new DrizzleStorage();
