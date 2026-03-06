import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import { 
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
} from "@shared/schema";

const dbPath = process.env.JOINCLOUD_CONTROL_PLANE_DB_PATH || join(process.cwd(), 'data', 'telemetry.db');
const dbDir = dirname(dbPath);
mkdirSync(dbDir, { recursive: true });
const db = new Database(dbPath);

// Initialize schema with Phase 1 control plane tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    device_index INTEGER,
    first_seen TEXT,
    last_seen TEXT,
    last_heartbeat TEXT,
    app_version TEXT,
    os TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_metrics (
    user_id TEXT,
    date TEXT,
    uptime_seconds INTEGER,
    files_uploaded INTEGER,
    files_downloaded INTEGER,
    bytes_uploaded INTEGER,
    bytes_downloaded INTEGER,
    shares_created INTEGER,
    public_shares INTEGER,
    lan_shares INTEGER,
    network_visibility_enabled INTEGER DEFAULT 1,
    network_peers_detected INTEGER DEFAULT 0,
    display_name_customized INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, date)
  );

  CREATE TABLE IF NOT EXISTS support_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_uuid TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    sender TEXT NOT NULL CHECK(sender IN ('device', 'admin', 'user')),
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES support_threads(id)
  );

  CREATE TABLE IF NOT EXISTS hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_uuid TEXT NOT NULL UNIQUE,
    installation_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    first_installed_at TEXT NOT NULL,
    version TEXT NOT NULL,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    trial_start_at TEXT,
    registration_status TEXT NOT NULL DEFAULT 'registered',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hosts_host_uuid ON hosts(host_uuid);
  CREATE INDEX IF NOT EXISTS idx_hosts_last_seen ON hosts(last_seen_at);

  CREATE TABLE IF NOT EXISTS device_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_uuid TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    context TEXT,
    timestamp TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

// Add device_index column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE users ADD COLUMN device_index INTEGER`);
} catch (e) { /* column already exists */ }

// Add last_heartbeat column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE users ADD COLUMN last_heartbeat TEXT`);
} catch (e) { /* column already exists */ }

// Add network presence columns if they don't exist (migration)
try {
  db.exec(`ALTER TABLE daily_metrics ADD COLUMN network_visibility_enabled INTEGER DEFAULT 1`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE daily_metrics ADD COLUMN network_peers_detected INTEGER DEFAULT 0`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE daily_metrics ADD COLUMN display_name_customized INTEGER DEFAULT 0`);
} catch (e) { /* column already exists */ }

// Add trial_start_at column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE hosts ADD COLUMN trial_start_at TEXT`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE hosts ADD COLUMN trial_ends_at TEXT`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE hosts ADD COLUMN trial_extended_at TEXT`);
} catch (e) { /* column already exists */ }

// Device trial bootstrap + monthly share usage
db.exec(`
  CREATE TABLE IF NOT EXISTS device_trials (
    device_id TEXT PRIMARY KEY,
    trial_started_at TEXT NOT NULL,
    trial_ends_at TEXT NOT NULL,
    trial_extended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS device_usage_monthly (
    device_id TEXT NOT NULL,
    ym TEXT NOT NULL,
    shares_created INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (device_id, ym)
  );
`);

// Phase 3: Stripe subscription fields on accounts
try { db.exec(`ALTER TABLE accounts ADD COLUMN stripe_customer_id TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN subscription_id TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN subscription_status TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN renewal_at TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN grace_ends_at TEXT`); } catch (e) { /* exists */ }
// Phase 3: license lifecycle fields
try { db.exec(`ALTER TABLE licenses ADD COLUMN plan_interval TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN grace_ends_at INTEGER`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN renewal_at INTEGER`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN custom_quota INTEGER`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN user_limit INTEGER`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN team_limit INTEGER`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN share_limit_monthly INTEGER`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN devices_per_user INTEGER`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN overrides_json TEXT`); } catch (e) { /* exists */ }
// Razorpay: payment provider fields
try { db.exec(`ALTER TABLE accounts ADD COLUMN razorpay_customer_id TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN razorpay_subscription_id TEXT`); } catch (e) { /* exists */ }
// Username for display name (Join <username>)
try { db.exec(`ALTER TABLE accounts ADD COLUMN username TEXT`); } catch (e) { /* exists */ }

// Billing/Payment tracking fields
try { db.exec(`ALTER TABLE licenses ADD COLUMN payment_method TEXT`); } catch (e) { /* exists */ } // 'online' | 'offline' | 'offer'
try { db.exec(`ALTER TABLE licenses ADD COLUMN amount_paid INTEGER`); } catch (e) { /* exists */ } // in smallest currency unit (e.g., paise/cents)
try { db.exec(`ALTER TABLE licenses ADD COLUMN currency TEXT DEFAULT 'INR'`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN payment_provider TEXT`); } catch (e) { /* exists */ } // 'stripe' | 'razorpay' | 'manual'
try { db.exec(`ALTER TABLE licenses ADD COLUMN invoice_id TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN discount_percent INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE licenses ADD COLUMN notes TEXT`); } catch (e) { /* exists */ }

// Team invitation emails (pending team members before signup)
db.exec(`
  CREATE TABLE IF NOT EXISTS team_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id TEXT NOT NULL,
    email TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    invited_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE(license_id, email),
    FOREIGN KEY (license_id) REFERENCES licenses(id),
    FOREIGN KEY (invited_by) REFERENCES accounts(id)
  );
`);
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON team_invitations(email)`); } catch (e) { /* exists */ }
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_team_invitations_license ON team_invitations(license_id)`); } catch (e) { /* exists */ }

// Create index for log cleanup
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_device_logs_expires ON device_logs(expires_at)`);
} catch (e) { /* index exists */ }

// === PHASE 2: ACCOUNTS, LICENSES, USAGE AGGREGATES ===
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    trial_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    device_limit INTEGER NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    state TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS license_hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id TEXT NOT NULL,
    host_uuid TEXT NOT NULL,
    activated_at TEXT NOT NULL,
    UNIQUE(license_id, host_uuid),
    FOREIGN KEY (license_id) REFERENCES licenses(id)
  );

  CREATE TABLE IF NOT EXISTS license_members (
    license_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL,
    PRIMARY KEY (license_id, account_id),
    FOREIGN KEY (license_id) REFERENCES licenses(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS usage_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_uuid TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    uptime_seconds INTEGER NOT NULL DEFAULT 0,
    storage_used_bytes INTEGER NOT NULL DEFAULT 0,
    bytes_uploaded INTEGER NOT NULL DEFAULT 0,
    bytes_downloaded INTEGER NOT NULL DEFAULT 0,
    total_shares INTEGER NOT NULL DEFAULT 0,
    total_devices INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(host_uuid, period_start)
  );
`);

try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_license_hosts_license ON license_hosts(license_id)`);
} catch (e) { /* exists */ }
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_license_hosts_host ON license_hosts(host_uuid)`);
} catch (e) { /* exists */ }
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_license_members_license ON license_members(license_id)`);
} catch (e) { /* exists */ }
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_license_members_account ON license_members(account_id)`);
} catch (e) { /* exists */ }
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_aggregates_host ON usage_aggregates(host_uuid)`);
} catch (e) { /* exists */ }

// App settings (key-value, e.g. payment_mode)
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
try { db.exec(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('payment_mode', 'LIVE')`); } catch (e) { /* exists */ }
try { db.exec(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('subscription_mode', 'automatic')`); } catch (e) { /* exists */ }

// Device-only trial: track which devices have ever used a trial (to block second trial after revoke/expiry)
db.exec(`
  CREATE TABLE IF NOT EXISTS device_trial_used (
    host_uuid TEXT PRIMARY KEY
  );
`);

// Admin-triggered logout: when set, next config fetch for this host returns logout_requested and clears local auth
db.exec(`
  CREATE TABLE IF NOT EXISTS device_logout_requests (
    host_uuid TEXT PRIMARY KEY,
    requested_at TEXT NOT NULL
  );
`);

// === NEW TABLES FOR LICENSE ACCOUNT MANAGEMENT SYSTEM ===

// Subscriptions table - tracks payment subscriptions separately from licenses
db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    license_id TEXT,
    provider TEXT NOT NULL,
    provider_subscription_id TEXT,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    interval TEXT NOT NULL DEFAULT 'month',
    current_period_start INTEGER,
    current_period_end INTEGER,
    payment_due_date INTEGER,
    grace_ends_at INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (license_id) REFERENCES licenses(id)
  );
  CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_license ON subscriptions(license_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
`);

// Manual subscription requests (for manual subscription_mode)
db.exec(`
  CREATE TABLE IF NOT EXISTS subscription_requests (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    plan_id TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    account_id TEXT,
    device_id TEXT,
    custom_users INTEGER,
    custom_devices INTEGER,
    notes TEXT,
    license_id TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (license_id) REFERENCES licenses(id)
  );
  CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON subscription_requests(status);
  CREATE INDEX IF NOT EXISTS idx_subscription_requests_account ON subscription_requests(account_id);
`);

// Payments table - tracks individual payment transactions
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    subscription_id TEXT,
    account_id TEXT NOT NULL,
    device_id TEXT,
    provider TEXT NOT NULL,
    provider_payment_id TEXT,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'pending',
    invoice_url TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id);
  CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id);
  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
`);

// Device recovery requests - for device ID mismatch recovery
db.exec(`
  CREATE TABLE IF NOT EXISTS device_recovery_requests (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    old_device_id TEXT NOT NULL,
    new_device_id TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_notes TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_recovery_account ON device_recovery_requests(account_id);
  CREATE INDEX IF NOT EXISTS idx_recovery_status ON device_recovery_requests(status);
`);

// Referrals table - tracks referral relationships
db.exec(`
  CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrer_account_id TEXT NOT NULL,
    referred_account_id TEXT NOT NULL,
    referral_code TEXT NOT NULL,
    days_granted INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    FOREIGN KEY (referrer_account_id) REFERENCES accounts(id),
    FOREIGN KEY (referred_account_id) REFERENCES accounts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_account_id);
  CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_account_id);
`);

// Add new columns to hosts table for suspension
try { db.exec(`ALTER TABLE hosts ADD COLUMN suspended INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE hosts ADD COLUMN suspension_reason TEXT`); } catch (e) { /* exists */ }

// Add new columns to accounts table for referrals and device tracking
try { db.exec(`ALTER TABLE accounts ADD COLUMN referral_code TEXT UNIQUE`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN referred_by TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN referral_count INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN referral_days_earned INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN device_change_count INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE accounts ADD COLUMN last_device_change_at TEXT`); } catch (e) { /* exists */ }

// Add account_id as nullable to licenses (for device-only licenses without account)
try { db.exec(`ALTER TABLE licenses ADD COLUMN is_device_only INTEGER DEFAULT 0`); } catch (e) { /* exists */ }

// Create index for referral codes
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_referral_code ON accounts(referral_code)`); } catch (e) { /* exists */ }

// Teams: license_members (migration for existing DBs)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS license_members (
      license_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      PRIMARY KEY (license_id, account_id),
      FOREIGN KEY (license_id) REFERENCES licenses(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_license_members_license ON license_members(license_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_license_members_account ON license_members(account_id)`);
} catch (e) { /* exists */ }

// Get next device index
function getNextDeviceIndex(): number {
  const result = db.prepare('SELECT MAX(device_index) as max_index FROM users').get() as any;
  return (result?.max_index || 0) + 1;
}

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

// Phase 2 types
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
  // Referral fields
  referralCode?: string | null;
  referredBy?: string | null;
  referralCount?: number;
  referralDaysEarned?: number;
  // Device tracking
  deviceChangeCount?: number;
  lastDeviceChangeAt?: string | null;
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
}

export interface TeamInvitation {
  id: number;
  licenseId: string;
  email: string;
  invitedBy: string;
  invitedAt: string;
  status: string;
}

// === NEW TYPES FOR LICENSE ACCOUNT MANAGEMENT SYSTEM ===

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
  // Phase 1 additions
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
  // UI restructure additions
  getUserStats(deviceUUID: string): Promise<UserStats | null>;
  getLeaderboard(): Promise<LeaderboardData>;
  getSupportThreadPreviews(): Promise<SupportThreadPreview[]>;
  // Host registration (Phase 1)
  registerHost(payload: HostRegisterPayload): Promise<Host>;
  hostHeartbeat(payload: HostHeartbeatPayload): Promise<void>;
  getHosts(filters?: { platform?: string; version?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }): Promise<{ hosts: Host[]; total: number }>;
  getHostByUUID(hostUUID: string): Promise<Host | null>;
  // Phase 2: accounts, licenses, usage
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
  getPasswordHash(accountId: string): string | null;
  setAccountTrialUsed(accountId: string): Promise<void>;
  createLicense(license: { id: string; accountId: string; tier: string; deviceLimit: number; issuedAt: number; expiresAt: number; state: string; signature: string; planInterval?: string; graceEndsAt?: number; renewalAt?: number; customQuota?: number }): Promise<License>;
  updateLicense(licenseId: string, updates: { state?: string; expiresAt?: number; signature?: string; planInterval?: string; graceEndsAt?: number | null; renewalAt?: number | null; deviceLimit?: number; tier?: string; customQuota?: number | null }): Promise<void>;
  getActiveLicenseForAccount(accountId: string): Promise<License | null>;
  getLatestLicenseForAccount(accountId: string): Promise<License | null>;
  getLicenseById(licenseId: string): Promise<License | null>;
  getLicenseHostsCount(licenseId: string): number;
  addLicenseHost(licenseId: string, hostUuid: string): Promise<void>;
  removeLicenseHost(licenseId: string, hostUuid: string): Promise<void>;
  ensureHostRow(hostUuid: string): Promise<void>;
  getLicenseForHost(hostUuid: string): Promise<License | null>;
  isHostInLicense(licenseId: string, hostUuid: string): boolean;
  getHostsForLicense(licenseId: string): Promise<Array<{ host_uuid: string; activated_at: string; last_seen_at: string | null; isOnline: boolean }>>;
  getLicenseMembers(licenseId: string): Promise<Array<{ accountId: string; email: string; role: string }>>;
  addLicenseMember(licenseId: string, accountId: string): Promise<void>;
  removeLicenseMember(licenseId: string, accountId: string): Promise<void>;
  getTeamsLicenseUserCount(licenseId: string): number;
  reportUsageAggregates(hostUuid: string, aggregates: Array<{ period_start: string; period_end: string; uptime_seconds: number; storage_used_bytes: number; bytes_uploaded: number; bytes_downloaded: number; total_shares: number; total_devices: number }>): Promise<void>;
  getUsageAggregates(filters?: { hostUuid?: string; limit?: number }): Promise<UsageAggregate[]>;
  listAccounts(): Promise<Account[]>;
  updateAccountSubscription(accountId: string, updates: { stripeCustomerId?: string; subscriptionId?: string; subscriptionStatus?: string; renewalAt?: string | null; graceEndsAt?: string | null }): Promise<void>;
  listLicensesWithHostCounts(): Promise<Array<License & { hostCount: number }>>;
  revokeLicense(licenseId: string): Promise<void>;
  extendLicense(licenseId: string, newExpiresAt: number): Promise<void>;
  upgradeLicenseToPro(licenseId: string): Promise<void>;
  ensureDeviceAccount(hostUuid: string): Promise<void>;
  isDeviceTrialUsed(hostUuid: string): boolean;
  setDeviceTrialUsed(hostUuid: string): void;
  // Device trial bootstrap (no auth)
  getOrCreateDeviceTrial(deviceId: string, trialDays?: number): Promise<{ trialStartedAt: string; trialEndsAt: string; trialExtendedAt: string | null }>;
  extendDeviceTrial(deviceId: string, extraDays: number): Promise<{ trialEndsAt: string }>;
  canExtendDeviceTrial(deviceId: string): boolean;
  // Monthly share usage
  getMonthlyShareCount(deviceId: string, ym: string): number;
  incrementMonthlyShares(deviceId: string, ym: string): Promise<{ count: number }>;
  
  // === NEW METHODS FOR LICENSE ACCOUNT MANAGEMENT SYSTEM ===
  
  // Subscriptions
  createSubscription(subscription: Omit<Subscription, 'createdAt' | 'updatedAt'>): Promise<Subscription>;
  getSubscriptionById(subscriptionId: string): Promise<Subscription | null>;
  getSubscriptionByAccountId(accountId: string): Promise<Subscription | null>;
  getSubscriptionByLicenseId(licenseId: string): Promise<Subscription | null>;
  updateSubscription(subscriptionId: string, updates: Partial<Subscription>): Promise<void>;
  listSubscriptions(filters?: { status?: string; provider?: string }): Promise<Subscription[]>;
  
  // Payments
  createPayment(payment: Omit<Payment, 'createdAt'>): Promise<Payment>;
  getPaymentById(paymentId: string): Promise<Payment | null>;
  getPaymentsByAccountId(accountId: string): Promise<Payment[]>;
  getPaymentsBySubscriptionId(subscriptionId: string): Promise<Payment[]>;
  updatePaymentStatus(paymentId: string, status: string): Promise<void>;
  
  // Device Recovery
  createDeviceRecoveryRequest(request: Omit<DeviceRecoveryRequest, 'createdAt' | 'resolvedAt' | 'resolvedBy'>): Promise<DeviceRecoveryRequest>;
  getDeviceRecoveryRequestById(requestId: string): Promise<DeviceRecoveryRequest | null>;
  getPendingRecoveryRequests(): Promise<DeviceRecoveryRequest[]>;
  getRecoveryRequestsByAccountId(accountId: string): Promise<DeviceRecoveryRequest[]>;
  resolveDeviceRecoveryRequest(requestId: string, status: 'approved' | 'rejected', adminNotes: string, resolvedBy: string): Promise<void>;
  
  // Referrals
  createReferral(referral: Omit<Referral, 'createdAt'>): Promise<Referral>;
  getReferralsByReferrerId(referrerAccountId: string): Promise<Referral[]>;
  getReferralByReferredId(referredAccountId: string): Promise<Referral | null>;
  getAccountByReferralCode(referralCode: string): Promise<Account | null>;
  updateAccountReferral(accountId: string, updates: { referralCode?: string; referredBy?: string; referralCount?: number; referralDaysEarned?: number }): Promise<void>;
  getReferralStats(accountId: string): Promise<ReferralStats>;
  
  // License check for desktop app
  getLicenseCheckResponse(deviceId: string): Promise<LicenseCheckResponse>;
  
  // Device-only license (no account required)
  createDeviceOnlyLicense(deviceId: string, tier: string, expiresAt: number, signature: string): Promise<License>;
  getLicenseByDeviceId(deviceId: string): Promise<License | null>;
  linkLicenseToAccount(licenseId: string, accountId: string): Promise<void>;

  // Manual subscription requests
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
  
  // Suspension
  suspendHost(hostUuid: string, reason: string): Promise<void>;
  unsuspendHost(hostUuid: string): Promise<void>;
  isHostSuspended(hostUuid: string): boolean;
  
  // Account device tracking
  incrementDeviceChangeCount(accountId: string): Promise<number>;
  
  // Subscription stats
  getSubscriptionStats(): Promise<SubscriptionStats>;
}

export class SqliteStorage implements IStorage {
  async enforceRetention(): Promise<void> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const dateStr = twelveMonthsAgo.toISOString().split('T')[0];
    
    db.prepare('DELETE FROM daily_metrics WHERE date < ?').run(dateStr);
    
    db.prepare(`
      DELETE FROM users 
      WHERE user_id NOT IN (SELECT DISTINCT user_id FROM daily_metrics)
    `).run();

    // Also cleanup expired logs
    await this.cleanupExpiredLogs();
  }

  async ingestTelemetry(payload: TelemetryPayload): Promise<void> {
    const now = new Date().toISOString();

    // Check if this is a new device
    const existingUser = db.prepare('SELECT device_index FROM users WHERE user_id = ?').get(payload.user_id) as any;
    const deviceIndex = existingUser?.device_index ?? getNextDeviceIndex();

    // Upsert User with device_index
    const userStmt = db.prepare(`
      INSERT INTO users (user_id, device_index, first_seen, last_seen, app_version, os)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        app_version = excluded.app_version,
        os = excluded.os
    `);
    userStmt.run(payload.user_id, deviceIndex, now, now, payload.app_version, payload.os);

    // Upsert Daily Metrics: client sends full-day cumulative snapshots; we overwrite by (user_id, date)
    // so re-sends of the same day do not double-count (last value wins).
    const metricStmt = db.prepare(`
      INSERT INTO daily_metrics (
        user_id, date, uptime_seconds, files_uploaded, files_downloaded,
        bytes_uploaded, bytes_downloaded, shares_created, public_shares, lan_shares,
        network_visibility_enabled, network_peers_detected, display_name_customized
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        uptime_seconds = excluded.uptime_seconds,
        files_uploaded = excluded.files_uploaded,
        files_downloaded = excluded.files_downloaded,
        bytes_uploaded = excluded.bytes_uploaded,
        bytes_downloaded = excluded.bytes_downloaded,
        shares_created = excluded.shares_created,
        public_shares = excluded.public_shares,
        lan_shares = excluded.lan_shares,
        network_visibility_enabled = excluded.network_visibility_enabled,
        network_peers_detected = excluded.network_peers_detected,
        display_name_customized = excluded.display_name_customized
    `);
    
    const networkVisibility = payload.network_visibility_enabled !== undefined ? (payload.network_visibility_enabled ? 1 : 0) : 1;
    const peersDetected = payload.network_peers_detected ?? 0;
    const displayNameCustomized = payload.display_name_customized !== undefined ? (payload.display_name_customized ? 1 : 0) : 0;
    
    metricStmt.run(
      payload.user_id,
      payload.date,
      payload.uptime_seconds,
      payload.metrics.files_uploaded,
      payload.metrics.files_downloaded,
      payload.metrics.bytes_uploaded,
      payload.metrics.bytes_downloaded,
      payload.metrics.shares_created,
      payload.metrics.public_shares,
      payload.metrics.lan_shares,
      networkVisibility,
      peersDetected,
      displayNameCustomized
    );
  }

  // === PHASE 1: HEARTBEAT ===
  async recordHeartbeat(payload: HeartbeatPayload): Promise<void> {
    const now = new Date().toISOString();
    const os = payload.platform?.trim() || null;

    // Check if device exists
    const existingUser = db.prepare('SELECT device_index, os FROM users WHERE user_id = ?').get(payload.deviceUUID) as any;

    if (existingUser) {
      // Update existing device; set os from payload if provided, else keep current
      const newOs = os ?? existingUser.os ?? 'unknown';
      db.prepare(`
        UPDATE users SET 
          last_heartbeat = ?,
          last_seen = ?,
          app_version = ?,
          os = ?
        WHERE user_id = ?
      `).run(now, now, payload.appVersion, newOs, payload.deviceUUID);
    } else {
      // Register new device on first heartbeat
      const deviceIndex = getNextDeviceIndex();
      db.prepare(`
        INSERT INTO users (user_id, device_index, first_seen, last_seen, last_heartbeat, app_version, os)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(payload.deviceUUID, deviceIndex, now, now, now, payload.appVersion, os || 'unknown');
    }
  }

  // === PHASE 1: DEVICES ===
  async getDevices(): Promise<Device[]> {
    const rows = db.prepare(`
      SELECT user_id, device_index, os, app_version, first_seen, last_seen, last_heartbeat
      FROM users
      ORDER BY device_index ASC
    `).all() as any[];

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const lastActivity = (row: { last_heartbeat?: string; last_seen?: string }) =>
      row.last_heartbeat || row.last_seen;
    return rows.map(row => ({
      deviceUUID: row.user_id,
      deviceIndex: row.device_index || 0,
      platform: row.os || 'unknown',
      appVersion: row.app_version || 'unknown',
      firstSeenAt: row.first_seen,
      lastSeenAt: row.last_seen,
      lastHeartbeat: row.last_heartbeat,
      isOnline: !!lastActivity(row) && lastActivity(row)! >= fiveMinutesAgo,
    }));
  }

  async getDevicesWithAccountInfo(): Promise<Array<Device & { accountEmail: string | null; licenseId: string | null; tier: string | null }>> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const lastActivity = (row: { last_heartbeat?: string | null; last_seen?: string | null }) =>
      row.last_heartbeat || row.last_seen;
    const isActive = (ts: string | null | undefined) => !!ts && ts >= fiveMinutesAgo;

    const fromUsers = db.prepare(`
      SELECT
        u.user_id,
        u.device_index,
        u.os,
        u.app_version,
        h.version AS host_version,
        u.first_seen,
        u.last_seen,
        u.last_heartbeat,
        a.email AS account_email,
        l.id AS license_id,
        l.tier AS license_tier
      FROM users u
      LEFT JOIN hosts h ON h.host_uuid = u.user_id
      LEFT JOIN license_hosts lh ON lh.host_uuid = u.user_id
      LEFT JOIN licenses l ON l.id = lh.license_id AND l.state IN ('active', 'trial_active', 'grace')
      LEFT JOIN accounts a ON a.id = l.account_id
      ORDER BY u.device_index ASC
    `).all() as any[];

    const seenUuids = new Set<string>();
    const result: Array<Device & { accountEmail: string | null; licenseId: string | null; tier: string | null }> = [];

    for (const row of fromUsers) {
      seenUuids.add(row.user_id);
      const activity = lastActivity(row);
      const version = (row.app_version && row.app_version !== 'unknown') ? row.app_version : (row.host_version || row.app_version || 'unknown');
      result.push({
        deviceUUID: row.user_id,
        deviceIndex: row.device_index || 0,
        platform: row.os || 'unknown',
        appVersion: version || 'unknown',
        firstSeenAt: row.first_seen || '',
        lastSeenAt: row.last_seen || row.first_seen || '',
        lastHeartbeat: row.last_heartbeat ?? null,
        isOnline: !!activity && activity >= fiveMinutesAgo,
        accountEmail: row.account_email ?? null,
        licenseId: row.license_id ?? null,
        tier: row.license_tier ?? null,
      });
    }

    const licensedHostsNotInUsers = db.prepare(`
      SELECT lh.host_uuid, h.platform, h.version, h.last_seen_at, h.first_seen_at,
             a.email AS account_email, l.id AS license_id, l.tier AS license_tier
      FROM license_hosts lh
      INNER JOIN licenses l ON l.id = lh.license_id AND l.state IN ('active', 'trial_active', 'grace')
      INNER JOIN accounts a ON a.id = l.account_id
      LEFT JOIN hosts h ON h.host_uuid = lh.host_uuid
      WHERE lh.host_uuid NOT IN (SELECT user_id FROM users)
    `).all() as any[];

    let deviceIndex = result.length > 0 ? Math.max(...result.map(d => d.deviceIndex), 0) + 1 : 1;
    for (const row of licensedHostsNotInUsers) {
      if (seenUuids.has(row.host_uuid)) continue;
      seenUuids.add(row.host_uuid);
      const lastSeen = row.last_seen_at || row.first_seen_at || '';
      result.push({
        deviceUUID: row.host_uuid,
        deviceIndex: deviceIndex++,
        platform: row.platform || 'unknown',
        appVersion: row.version || 'unknown',
        firstSeenAt: row.first_seen_at || '',
        lastSeenAt: lastSeen,
        lastHeartbeat: null,
        isOnline: !!lastSeen && lastSeen >= fiveMinutesAgo,
        accountEmail: row.account_email ?? null,
        licenseId: row.license_id ?? null,
        tier: row.license_tier ?? null,
      });
    }

    return result;
  }

  async getDevice(deviceUUID: string): Promise<Device | null> {
    const row = db.prepare(`
      SELECT user_id, device_index, os, app_version, first_seen, last_seen, last_heartbeat
      FROM users
      WHERE user_id = ?
    `).get(deviceUUID) as any;

    if (!row) return null;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const lastActivity = row.last_heartbeat || row.last_seen;
    return {
      deviceUUID: row.user_id,
      deviceIndex: row.device_index || 0,
      platform: row.os || 'unknown',
      appVersion: row.app_version || 'unknown',
      firstSeenAt: row.first_seen,
      lastSeenAt: row.last_seen,
      lastHeartbeat: row.last_heartbeat,
      isOnline: !!lastActivity && lastActivity >= fiveMinutesAgo,
    };
  }

  // === PHASE 1: SUPPORT MESSAGING ===
  async getOrCreateThread(deviceUUID: string): Promise<SupportThread> {
    const existing = await this.getThreadByDevice(deviceUUID);
    if (existing) return existing;

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO support_threads (device_uuid, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(deviceUUID, now, now);

    return {
      id: Number(result.lastInsertRowid),
      deviceUUID,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  async getThreadByDevice(deviceUUID: string): Promise<SupportThread | null> {
    const thread = db.prepare(`
      SELECT id, device_uuid, created_at, updated_at
      FROM support_threads
      WHERE device_uuid = ?
    `).get(deviceUUID) as any;

    if (!thread) return null;

    const messages = db.prepare(`
      SELECT id, thread_id, sender, text, timestamp
      FROM support_messages
      WHERE thread_id = ?
      ORDER BY timestamp ASC
    `).all(thread.id) as any[];

    return {
      id: thread.id,
      deviceUUID: thread.device_uuid,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      messages: messages.map(m => ({
        id: m.id,
        threadId: m.thread_id,
        sender: m.sender,
        text: m.text,
        timestamp: m.timestamp,
      })),
    };
  }

  async getAllThreads(): Promise<SupportThread[]> {
    const threads = db.prepare(`
      SELECT id, device_uuid, created_at, updated_at
      FROM support_threads
      ORDER BY updated_at DESC
    `).all() as any[];

    return Promise.all(threads.map(async (thread) => {
      const messages = db.prepare(`
        SELECT id, thread_id, sender, text, timestamp
        FROM support_messages
        WHERE thread_id = ?
        ORDER BY timestamp ASC
      `).all(thread.id) as any[];

      return {
        id: thread.id,
        deviceUUID: thread.device_uuid,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        messages: messages.map(m => ({
          id: m.id,
          threadId: m.thread_id,
          sender: m.sender,
          text: m.text,
          timestamp: m.timestamp,
        })),
      };
    }));
  }

  async addMessage(deviceUUID: string, sender: 'device' | 'admin' | 'user', text: string): Promise<SupportMessage> {
    const thread = await this.getOrCreateThread(deviceUUID);
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO support_messages (thread_id, sender, text, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(thread.id, sender, text, now);

    // Update thread's updated_at
    db.prepare(`UPDATE support_threads SET updated_at = ? WHERE id = ?`).run(now, thread.id);

    return {
      id: Number(result.lastInsertRowid),
      threadId: thread.id,
      sender,
      text,
      timestamp: now,
    };
  }

  async deleteThreadByDevice(deviceUUID: string): Promise<boolean> {
    const thread = db.prepare(`SELECT id FROM support_threads WHERE device_uuid = ?`).get(deviceUUID) as { id: number } | undefined;
    if (!thread) return false;
    db.prepare(`DELETE FROM support_messages WHERE thread_id = ?`).run(thread.id);
    db.prepare(`DELETE FROM support_threads WHERE id = ?`).run(thread.id);
    return true;
  }

  // === PHASE 1: LOGS ===
  async ingestLogs(payload: LogsBatchPayload): Promise<void> {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const expiresAt = thirtyDaysFromNow.toISOString();

    const stmt = db.prepare(`
      INSERT INTO device_logs (device_uuid, level, message, context, timestamp, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((logs: typeof payload.logs) => {
      for (const log of logs) {
        const timestamp = log.timestamp || new Date().toISOString();
        const context = log.context ? JSON.stringify(log.context) : null;
        stmt.run(payload.deviceUUID, log.level, log.message, context, timestamp, expiresAt);
      }
    });

    insertMany(payload.logs);
  }

  async cleanupExpiredLogs(): Promise<void> {
    const now = new Date().toISOString();
    db.prepare('DELETE FROM device_logs WHERE expires_at < ?').run(now);
  }

  // === NETWORK PRESENCE STATS ===
  private getNetworkPresenceStats(): NetworkPresenceStats {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split('T')[0];

    const totalActiveResult = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM daily_metrics WHERE date >= ?
    `).get(dateStr) as any;
    const totalActive = Number(totalActiveResult?.count || 0);

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

    const usersWithPeers = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count 
      FROM daily_metrics 
      WHERE date >= ? AND network_peers_detected >= 1
    `).get(dateStr) as any;
    const peerDetectionRate = (Number(usersWithPeers?.count || 0) / totalActive) * 100;

    const avgPeersResult = db.prepare(`
      SELECT AVG(max_peers) as avg FROM (
        SELECT user_id, MAX(network_peers_detected) as max_peers
        FROM daily_metrics
        WHERE date >= ?
        GROUP BY user_id
      )
    `).get(dateStr) as any;
    const avgPeersPerUser = Number(avgPeersResult?.avg || 0);

    const visibilityStats = db.prepare(`
      SELECT 
        SUM(CASE WHEN dm.network_visibility_enabled = 1 THEN 1 ELSE 0 END) as vis_on,
        SUM(CASE WHEN dm.network_visibility_enabled = 0 THEN 1 ELSE 0 END) as vis_off
      FROM daily_metrics dm
      INNER JOIN (
        SELECT user_id, MAX(date) as max_date
        FROM daily_metrics
        WHERE date >= ?
        GROUP BY user_id
      ) latest ON dm.user_id = latest.user_id AND dm.date = latest.max_date
    `).get(dateStr) as any;
    const visOn = Number(visibilityStats?.vis_on || 0);
    const visOff = Number(visibilityStats?.vis_off || 0);
    const visTotal = visOn + visOff;
    const visibilityOnRate = visTotal > 0 ? (visOn / visTotal) * 100 : 100;
    const visibilityOffRate = visTotal > 0 ? (visOff / visTotal) * 100 : 0;

    const uptimeByVisibility = db.prepare(`
      SELECT 
        network_visibility_enabled,
        AVG(uptime_seconds) as avg_uptime
      FROM daily_metrics
      WHERE date >= ?
      GROUP BY network_visibility_enabled
    `).all(dateStr) as any[];
    
    let avgUptimeVisibilityOn = 0;
    let avgUptimeVisibilityOff = 0;
    uptimeByVisibility.forEach((row) => {
      if (row.network_visibility_enabled === 1) {
        avgUptimeVisibilityOn = Number(row.avg_uptime || 0);
      } else {
        avgUptimeVisibilityOff = Number(row.avg_uptime || 0);
      }
    });

    const customizedResult = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count 
      FROM daily_metrics 
      WHERE date >= ? AND display_name_customized = 1
    `).get(dateStr) as any;
    const displayNameCustomizationRate = (Number(customizedResult?.count || 0) / totalActive) * 100;

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

  async getDashboardStats(): Promise<DashboardStats> {
    const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activeUsers7d = (db.prepare('SELECT COUNT(*) as count FROM users WHERE last_seen >= ?').get(sevenDaysAgo.toISOString()) as any).count;

    const uptimeResult = db.prepare(`
      SELECT AVG(daily_avg_uptime) as avg_daily_uptime
      FROM (
        SELECT date, AVG(uptime_seconds) as daily_avg_uptime
        FROM daily_metrics
        GROUP BY date
      )
    `).get() as any;

    const aggregateStats = db.prepare(`
      SELECT 
        SUM(bytes_uploaded + bytes_downloaded) as totalProcessed,
        SUM(shares_created) as totalShares,
        SUM(bytes_uploaded) as totalUpload,
        SUM(bytes_downloaded) as totalDownload
      FROM daily_metrics
    `).get() as any;

    const versions = db.prepare('SELECT app_version, COUNT(*) as count FROM users GROUP BY app_version').all() as any[];
    const versionDist: Record<string, number> = {};
    versions.forEach(v => versionDist[v.app_version || 'unknown'] = v.count);

    const platforms = db.prepare('SELECT os, COUNT(*) as count FROM users GROUP BY os').all() as any[];
    const osDist: Record<string, number> = {};
    platforms.forEach(p => osDist[p.os || 'unknown'] = p.count);

    const dailyRows = db.prepare(`
      SELECT 
        date,
        COUNT(DISTINCT user_id) as activeUsers,
        SUM(files_uploaded) as filesUploaded,
        SUM(files_downloaded) as filesDownloaded,
        SUM(shares_created) as sharesCreated,
        AVG(uptime_seconds) / 3600.0 as avgUptimeHours,
        SUM(bytes_uploaded + bytes_downloaded) as dataProcessed,
        SUM(bytes_uploaded) as uploadBytes,
        SUM(bytes_downloaded) as downloadBytes
      FROM daily_metrics
      GROUP BY date
      ORDER BY date DESC
      LIMIT 365
    `).all() as any[];

    const advancedTelemetry = this.getAdvancedTelemetryStats();

    return {
      totalUsers: Number(totalUsers || 0),
      activeUsers7d: Number(activeUsers7d || 0),
      avgDailyUptimeSeconds: Number(uptimeResult?.avg_daily_uptime || 0),
      totalDataProcessedBytes: Number(aggregateStats?.totalProcessed || 0),
      totalShares: Number(aggregateStats?.totalShares || 0),
      uploadBandwidthBytes: Number(aggregateStats?.totalUpload || 0),
      downloadBandwidthBytes: Number(aggregateStats?.totalDownload || 0),
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

  private getAdvancedTelemetryStats(): {
    devicesReportingLast1h: number;
    devicesReportingLast24h: number;
    devicesReportingLast7d: number;
    totalUploadBytes7d: number;
    totalDownloadBytes7d: number;
    totalFilesUploaded7d: number;
    totalFilesDownloaded7d: number;
    topVersions: Array<{ version: string; count: number }>;
    topPlatforms: Array<{ platform: string; count: number }>;
  } {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgoDate = sevenDaysAgoIso.split('T')[0];
    const devices1h = (db.prepare('SELECT COUNT(*) as c FROM users WHERE last_heartbeat >= ? OR last_seen >= ?').get(oneHourAgo, oneHourAgo) as any)?.c ?? 0;
    const devices24h = (db.prepare('SELECT COUNT(*) as c FROM users WHERE last_heartbeat >= ? OR last_seen >= ?').get(oneDayAgo, oneDayAgo) as any)?.c ?? 0;
    const devices7d = (db.prepare('SELECT COUNT(*) as c FROM users WHERE last_heartbeat >= ? OR last_seen >= ?').get(sevenDaysAgoIso, sevenDaysAgoIso) as any)?.c ?? 0;
    const transfer7d = db.prepare(`
      SELECT
        COALESCE(SUM(bytes_uploaded), 0) as upload,
        COALESCE(SUM(bytes_downloaded), 0) as download,
        COALESCE(SUM(files_uploaded), 0) as files_up,
        COALESCE(SUM(files_downloaded), 0) as files_down
      FROM daily_metrics WHERE date >= ?
    `).get(sevenDaysAgoDate) as any;
    const versionRows = db.prepare('SELECT app_version as version, COUNT(*) as count FROM users GROUP BY app_version ORDER BY count DESC LIMIT 10').all() as any[];
    const platformRows = db.prepare('SELECT os as platform, COUNT(*) as count FROM users GROUP BY os ORDER BY count DESC LIMIT 10').all() as any[];
    return {
      devicesReportingLast1h: Number(devices1h),
      devicesReportingLast24h: Number(devices24h),
      devicesReportingLast7d: Number(devices7d),
      totalUploadBytes7d: Number(transfer7d?.upload ?? 0),
      totalDownloadBytes7d: Number(transfer7d?.download ?? 0),
      totalFilesUploaded7d: Number(transfer7d?.files_up ?? 0),
      totalFilesDownloaded7d: Number(transfer7d?.files_down ?? 0),
      topVersions: versionRows.map(r => ({ version: r.version || 'unknown', count: Number(r.count) })),
      topPlatforms: platformRows.map(r => ({ platform: r.platform || 'unknown', count: Number(r.count) })),
    };
  }

  // === UI RESTRUCTURE: USER STATS ===
  async getUserStats(deviceUUID: string): Promise<UserStats | null> {
    let device = await this.getDevice(deviceUUID);
    if (!device) {
      const hostRow = db.prepare('SELECT host_uuid, platform, version, first_seen_at, last_seen_at FROM hosts WHERE host_uuid = ?').get(deviceUUID) as any;
      if (!hostRow) return null;
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const lastSeen = hostRow.last_seen_at || hostRow.first_seen_at || '';
      device = {
        deviceUUID: hostRow.host_uuid,
        deviceIndex: 0,
        platform: hostRow.platform || 'unknown',
        appVersion: hostRow.version || 'unknown',
        firstSeenAt: hostRow.first_seen_at || '',
        lastSeenAt: lastSeen,
        lastHeartbeat: null,
        isOnline: !!lastSeen && lastSeen >= fiveMinutesAgo,
      };
    }

    const stats = db.prepare(`
      SELECT 
        COALESCE(SUM(uptime_seconds), 0) as totalUptime,
        COALESCE(SUM(files_uploaded), 0) as filesUploaded,
        COALESCE(SUM(files_downloaded), 0) as filesDownloaded,
        COALESCE(SUM(shares_created), 0) as sharesCreated,
        COALESCE(SUM(bytes_uploaded), 0) as bytesUploaded,
        COALESCE(SUM(bytes_downloaded), 0) as bytesDownloaded,
        COALESCE(SUM(lan_shares), 0) as lanShares,
        COALESCE(SUM(public_shares), 0) as publicShares
      FROM daily_metrics
      WHERE user_id = ?
    `).get(deviceUUID) as any;

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

  // === UI RESTRUCTURE: LEADERBOARD ===
  async getLeaderboard(): Promise<LeaderboardData> {
    const byUptime = db.prepare(`
      SELECT 
        u.user_id as deviceUUID,
        u.device_index as deviceIndex,
        u.os as platform,
        COALESCE(SUM(dm.uptime_seconds), 0) as value
      FROM users u
      LEFT JOIN daily_metrics dm ON u.user_id = dm.user_id
      GROUP BY u.user_id
      ORDER BY value DESC
      LIMIT 10
    `).all() as any[];

    const byFilesUploaded = db.prepare(`
      SELECT 
        u.user_id as deviceUUID,
        u.device_index as deviceIndex,
        u.os as platform,
        COALESCE(SUM(dm.files_uploaded), 0) as value
      FROM users u
      LEFT JOIN daily_metrics dm ON u.user_id = dm.user_id
      GROUP BY u.user_id
      ORDER BY value DESC
      LIMIT 10
    `).all() as any[];

    const bySharesCreated = db.prepare(`
      SELECT 
        u.user_id as deviceUUID,
        u.device_index as deviceIndex,
        u.os as platform,
        COALESCE(SUM(dm.shares_created), 0) as value
      FROM users u
      LEFT JOIN daily_metrics dm ON u.user_id = dm.user_id
      GROUP BY u.user_id
      ORDER BY value DESC
      LIMIT 10
    `).all() as any[];

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

  // === UI RESTRUCTURE: SUPPORT THREAD PREVIEWS ===
  async getSupportThreadPreviews(): Promise<SupportThreadPreview[]> {
    const threads = db.prepare(`
      SELECT 
        st.device_uuid,
        u.device_index,
        st.updated_at,
        (SELECT COUNT(*) FROM support_messages WHERE thread_id = st.id) as message_count
      FROM support_threads st
      LEFT JOIN users u ON st.device_uuid = u.user_id
      ORDER BY st.updated_at DESC
    `).all() as any[];

    return threads.map((thread) => {
      const lastMessage = db.prepare(`
        SELECT sender, text, timestamp
        FROM support_messages
        WHERE thread_id = (SELECT id FROM support_threads WHERE device_uuid = ?)
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(thread.device_uuid) as any;

      return {
        deviceUUID: thread.device_uuid,
        deviceIndex: thread.device_index || 0,
        lastMessageText: lastMessage?.text || '(No messages yet)',
        lastMessageSender: lastMessage?.sender || 'device',
        lastActivityAt: thread.updated_at,
        messageCount: Number(thread.message_count || 0),
        hasUnread: lastMessage ? lastMessage.sender !== 'admin' : false,
      };
    });
  }
  // === HOST REGISTRATION (Phase 1) ===

  private static readonly ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

  private mapHostRow(row: any): Host {
    const fiveMinutesAgo = new Date(Date.now() - SqliteStorage.ONLINE_THRESHOLD_MS).toISOString();
    return {
      id: row.id,
      hostUUID: row.host_uuid,
      installationId: row.installation_id,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      firstInstalledAt: row.first_installed_at,
      version: row.version,
      platform: row.platform,
      arch: row.arch,
      trialStartAt: row.trial_start_at || null,
      registrationStatus: row.registration_status,
      isOnline: !!(row.last_seen_at && row.last_seen_at >= fiveMinutesAgo),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async registerHost(payload: HostRegisterPayload): Promise<Host> {
    const now = new Date().toISOString();
    const firstInstalledAt = new Date(payload.first_installed_at * 1000).toISOString();

    const existing = db.prepare('SELECT id FROM hosts WHERE host_uuid = ?').get(payload.host_uuid) as any;

    if (existing) {
      db.prepare(`
        UPDATE hosts SET 
          last_seen_at = ?,
          version = ?,
          platform = ?,
          arch = ?,
          updated_at = ?
        WHERE host_uuid = ?
      `).run(now, payload.version, payload.platform, payload.arch, now, payload.host_uuid);
    } else {
      db.prepare(`
        INSERT INTO hosts (host_uuid, installation_id, first_seen_at, last_seen_at, first_installed_at, version, platform, arch, trial_start_at, registration_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?)
      `).run(payload.host_uuid, payload.installation_id, now, now, firstInstalledAt, payload.version, payload.platform, payload.arch, now, now, now);
    }

    const host = await this.getHostByUUID(payload.host_uuid);
    return host!;
  }

  async hostHeartbeat(payload: HostHeartbeatPayload): Promise<void> {
    const now = new Date().toISOString();

    const result = db.prepare(`
      UPDATE hosts SET 
        last_seen_at = ?,
        version = ?,
        updated_at = ?
      WHERE host_uuid = ?
    `).run(now, payload.version, now, payload.host_uuid);

    if (result.changes === 0) {
      db.prepare(`
        INSERT INTO hosts (host_uuid, installation_id, first_seen_at, last_seen_at, first_installed_at, version, platform, arch, registration_status, created_at, updated_at)
        VALUES (?, '', ?, ?, ?, ?, 'unknown', 'unknown', 'registered', ?, ?)
      `).run(payload.host_uuid, now, now, now, payload.version, now, now);
    }
  }

  async getHosts(filters?: { platform?: string; version?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }): Promise<{ hosts: Host[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.platform) {
      conditions.push('platform = ?');
      params.push(filters.platform);
    }
    if (filters?.version) {
      conditions.push('version = ?');
      params.push(filters.version);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const validSortColumns: Record<string, string> = {
      last_seen_at: 'last_seen_at',
      first_seen_at: 'first_seen_at',
      first_installed_at: 'first_installed_at',
      version: 'version',
      platform: 'platform',
      host_uuid: 'host_uuid',
    };
    const sortBy = validSortColumns[filters?.sortBy || 'last_seen_at'] || 'last_seen_at';
    const sortOrder = filters?.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const page = Math.max(1, filters?.page || 1);
    const limit = Math.min(100, Math.max(1, filters?.limit || 50));
    const offset = (page - 1) * limit;

    const totalResult = db.prepare(`SELECT COUNT(*) as count FROM hosts ${whereClause}`).get(...params) as any;
    const total = Number(totalResult?.count || 0);

    const rows = db.prepare(`
      SELECT * FROM hosts ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      hosts: rows.map(row => this.mapHostRow(row)),
      total,
    };
  }

  async getHostByUUID(hostUUID: string): Promise<Host | null> {
    const row = db.prepare('SELECT * FROM hosts WHERE host_uuid = ?').get(hostUUID) as any;
    if (!row) return null;
    return this.mapHostRow(row);
  }

  // === PHASE 2: ACCOUNTS ===
  async createAccount(id: string, email: string, passwordHash: string): Promise<Account> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO accounts (id, email, password_hash, trial_used, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(id, email.toLowerCase(), passwordHash, now, now);
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any;
    return this.mapAccountRow(row);
  }

  async getAccountByEmail(email: string): Promise<Account | null> {
    const row = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email.toLowerCase()) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  async getAccountById(id: string): Promise<Account | null> {
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  async getAccountByStripeCustomerId(stripeCustomerId: string): Promise<Account | null> {
    const row = db.prepare('SELECT * FROM accounts WHERE stripe_customer_id = ?').get(stripeCustomerId) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  async getAccountBySubscriptionId(subscriptionId: string): Promise<Account | null> {
    const row = db.prepare('SELECT * FROM accounts WHERE subscription_id = ?').get(subscriptionId) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  getPasswordHash(accountId: string): string | null {
    const row = db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(accountId) as any;
    return row?.password_hash ?? null;
  }

  async setAccountTrialUsed(accountId: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare('UPDATE accounts SET trial_used = 1, updated_at = ? WHERE id = ?').run(now, accountId);
  }

  private mapAccountRow(row: any): Account {
    return {
      id: row.id,
      email: row.email,
      username: row.username ?? null,
      trialUsed: row.trial_used === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stripeCustomerId: row.stripe_customer_id ?? null,
      subscriptionId: row.subscription_id ?? null,
      subscriptionStatus: row.subscription_status ?? null,
      renewalAt: row.renewal_at ?? null,
      graceEndsAt: row.grace_ends_at ?? null,
      razorpayCustomerId: row.razorpay_customer_id ?? null,
      razorpaySubscriptionId: row.razorpay_subscription_id ?? null,
      // Referral fields
      referralCode: row.referral_code ?? null,
      referredBy: row.referred_by ?? null,
      referralCount: Number(row.referral_count ?? 0),
      referralDaysEarned: Number(row.referral_days_earned ?? 0),
      // Device tracking
      deviceChangeCount: Number(row.device_change_count ?? 0),
      lastDeviceChangeAt: row.last_device_change_at ?? null,
    };
  }

  async updateAccountUsername(accountId: string, username: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare("UPDATE accounts SET username = ?, updated_at = ? WHERE id = ?").run(username.trim() || null, now, accountId);
  }

  async updateAccountPassword(accountId: string, passwordHash: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare("UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now, accountId);
  }

  async getAccountByRazorpayCustomerId(customerId: string): Promise<Account | null> {
    const row = db.prepare('SELECT * FROM accounts WHERE razorpay_customer_id = ?').get(customerId) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  async getAccountByRazorpaySubscriptionId(subscriptionId: string): Promise<Account | null> {
    const row = db.prepare('SELECT * FROM accounts WHERE razorpay_subscription_id = ?').get(subscriptionId) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  async updateAccountRazorpay(accountId: string, updates: { razorpayCustomerId?: string; razorpaySubscriptionId?: string; subscriptionStatus?: string; renewalAt?: string | null; graceEndsAt?: string | null }): Promise<void> {
    const now = new Date().toISOString();
    const parts: string[] = ['updated_at = ?'];
    const values: any[] = [now];
    if (updates.razorpayCustomerId !== undefined) { parts.push('razorpay_customer_id = ?'); values.push(updates.razorpayCustomerId); }
    if (updates.razorpaySubscriptionId !== undefined) { parts.push('razorpay_subscription_id = ?'); values.push(updates.razorpaySubscriptionId); }
    if (updates.subscriptionStatus !== undefined) { parts.push('subscription_status = ?'); values.push(updates.subscriptionStatus); }
    if (updates.renewalAt !== undefined) { parts.push('renewal_at = ?'); values.push(updates.renewalAt); }
    if (updates.graceEndsAt !== undefined) { parts.push('grace_ends_at = ?'); values.push(updates.graceEndsAt); }
    if (values.length === 1) return;
    values.push(accountId);
    db.prepare(`UPDATE accounts SET ${parts.join(', ')} WHERE id = ?`).run(...values);
  }

  // === PHASE 2: LICENSES ===
  async createLicense(license: { id: string; accountId: string; tier: string; deviceLimit: number; issuedAt: number; expiresAt: number; state: string; signature: string; planInterval?: string; graceEndsAt?: number; renewalAt?: number; customQuota?: number }): Promise<License> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO licenses (id, account_id, tier, device_limit, issued_at, expires_at, state, signature, created_at, updated_at, plan_interval, grace_ends_at, renewal_at, custom_quota)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      license.id, license.accountId, license.tier, license.deviceLimit, license.issuedAt, license.expiresAt, license.state, license.signature, now, now,
      license.planInterval ?? null, license.graceEndsAt ?? null, license.renewalAt ?? null, license.customQuota ?? null
    );
    const row = db.prepare('SELECT * FROM licenses WHERE id = ?').get(license.id) as any;
    return this.mapLicenseRow(row);
  }

  async updateLicense(licenseId: string, updates: { state?: string; expiresAt?: number; signature?: string; planInterval?: string; graceEndsAt?: number | null; renewalAt?: number | null; deviceLimit?: number; tier?: string; customQuota?: number | null }): Promise<void> {
    const now = new Date().toISOString();
    const row = db.prepare('SELECT id FROM licenses WHERE id = ?').get(licenseId) as any;
    if (!row) return;
    const parts: string[] = ['updated_at = ?'];
    const values: any[] = [now];
    if (updates.state !== undefined) { parts.push('state = ?'); values.push(updates.state); }
    if (updates.expiresAt !== undefined) { parts.push('expires_at = ?'); values.push(updates.expiresAt); }
    if (updates.signature !== undefined) { parts.push('signature = ?'); values.push(updates.signature); }
    if (updates.planInterval !== undefined) { parts.push('plan_interval = ?'); values.push(updates.planInterval); }
    if (updates.graceEndsAt !== undefined) { parts.push('grace_ends_at = ?'); values.push(updates.graceEndsAt); }
    if (updates.renewalAt !== undefined) { parts.push('renewal_at = ?'); values.push(updates.renewalAt); }
    if (updates.deviceLimit !== undefined) { parts.push('device_limit = ?'); values.push(updates.deviceLimit); }
    if (updates.tier !== undefined) { parts.push('tier = ?'); values.push(updates.tier); }
    if (updates.customQuota !== undefined) { parts.push('custom_quota = ?'); values.push(updates.customQuota); }
    if (values.length === 1) return;
    values.push(licenseId);
    db.prepare(`UPDATE licenses SET ${parts.join(', ')} WHERE id = ?`).run(...values);
  }

  async updateAccountSubscription(accountId: string, updates: { stripeCustomerId?: string; subscriptionId?: string; subscriptionStatus?: string; renewalAt?: string | null; graceEndsAt?: string | null }): Promise<void> {
    const now = new Date().toISOString();
    const parts: string[] = ['updated_at = ?'];
    const values: any[] = [now];
    if (updates.stripeCustomerId !== undefined) { parts.push('stripe_customer_id = ?'); values.push(updates.stripeCustomerId); }
    if (updates.subscriptionId !== undefined) { parts.push('subscription_id = ?'); values.push(updates.subscriptionId); }
    if (updates.subscriptionStatus !== undefined) { parts.push('subscription_status = ?'); values.push(updates.subscriptionStatus); }
    if (updates.renewalAt !== undefined) { parts.push('renewal_at = ?'); values.push(updates.renewalAt); }
    if (updates.graceEndsAt !== undefined) { parts.push('grace_ends_at = ?'); values.push(updates.graceEndsAt); }
    if (values.length === 1) return;
    values.push(accountId);
    db.prepare(`UPDATE accounts SET ${parts.join(', ')} WHERE id = ?`).run(...values);
  }

  async getActiveLicenseForAccount(accountId: string): Promise<License | null> {
    const now = Math.floor(Date.now() / 1000);
    const row = db.prepare(`
      SELECT * FROM licenses
      WHERE account_id = ? AND state IN ('trial_active', 'active', 'grace') AND expires_at > ?
      ORDER BY expires_at DESC LIMIT 1
    `).get(accountId, now) as any;
    if (!row) return null;
    return this.mapLicenseRow(row);
  }

  async getLatestLicenseForAccount(accountId: string): Promise<License | null> {
    const row = db.prepare(`
      SELECT * FROM licenses WHERE account_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(accountId) as any;
    if (!row) return null;
    return this.mapLicenseRow(row);
  }

  async getLicenseById(licenseId: string): Promise<License | null> {
    const row = db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId) as any;
    if (!row) return null;
    return this.mapLicenseRow(row);
  }

  getLicenseHostsCount(licenseId: string): number {
    const result = db.prepare('SELECT COUNT(*) as count FROM license_hosts WHERE license_id = ?').get(licenseId) as any;
    return Number(result?.count ?? 0);
  }

  async addLicenseHost(licenseId: string, hostUuid: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO license_hosts (license_id, host_uuid, activated_at)
      VALUES (?, ?, ?)
    `).run(licenseId, hostUuid, now);
  }

  async removeLicenseHost(licenseId: string, hostUuid: string): Promise<void> {
    db.prepare('DELETE FROM license_hosts WHERE license_id = ? AND host_uuid = ?').run(licenseId, hostUuid);
  }

  async ensureHostRow(hostUuid: string): Promise<void> {
    const existing = db.prepare('SELECT id FROM hosts WHERE host_uuid = ?').get(hostUuid) as any;
    if (existing) return;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO hosts (host_uuid, installation_id, first_seen_at, last_seen_at, first_installed_at, version, platform, arch, registration_status, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, '0.0.0', 'unknown', 'unknown', 'registered', ?, ?)
    `).run(hostUuid, now, now, now, now, now);
  }

  async getLicenseForHost(hostUuid: string): Promise<License | null> {
    const row = db.prepare(`
      SELECT l.* FROM licenses l
      INNER JOIN license_hosts lh ON l.id = lh.license_id
      WHERE lh.host_uuid = ?
      ORDER BY l.expires_at DESC LIMIT 1
    `).get(hostUuid) as any;
    if (!row) return null;
    return this.mapLicenseRow(row);
  }

  isHostInLicense(licenseId: string, hostUuid: string): boolean {
    const row = db.prepare("SELECT 1 FROM license_hosts WHERE license_id = ? AND host_uuid = ?").get(licenseId, hostUuid) as any;
    return !!row;
  }

  async getHostsForLicense(licenseId: string): Promise<Array<{ host_uuid: string; activated_at: string; last_seen_at: string | null; isOnline: boolean }>> {
    const rows = db.prepare(`
      SELECT lh.host_uuid, lh.activated_at, h.last_seen_at
      FROM license_hosts lh
      LEFT JOIN hosts h ON h.host_uuid = lh.host_uuid
      WHERE lh.license_id = ?
    `).all(licenseId) as any[];
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    return rows.map((r) => ({
      host_uuid: r.host_uuid,
      activated_at: r.activated_at,
      last_seen_at: r.last_seen_at || null,
      isOnline: !!(r.last_seen_at && r.last_seen_at >= fiveMinutesAgo),
    }));
  }

  async getLicenseMembers(licenseId: string): Promise<Array<{ accountId: string; email: string; role: string }>> {
    const rows = db.prepare(`
      SELECT lm.account_id, a.email, lm.role
      FROM license_members lm
      INNER JOIN accounts a ON a.id = lm.account_id
      WHERE lm.license_id = ?
    `).all(licenseId) as any[];
    return rows.map((r) => ({
      accountId: r.account_id,
      email: r.email,
      role: r.role || "member",
    }));
  }

  async addLicenseMember(licenseId: string, accountId: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO license_members (license_id, account_id, role, created_at)
      VALUES (?, ?, 'member', ?)
    `).run(licenseId, accountId, now);
  }

  async removeLicenseMember(licenseId: string, accountId: string): Promise<void> {
    db.prepare("DELETE FROM license_members WHERE license_id = ? AND account_id = ?").run(licenseId, accountId);
  }

  getTeamsLicenseUserCount(licenseId: string): number {
    const primary = db.prepare("SELECT id FROM licenses WHERE id = ?").get(licenseId) as any;
    if (!primary) return 0;
    const memberCount = db.prepare("SELECT COUNT(*) as c FROM license_members WHERE license_id = ?").get(licenseId) as any;
    return 1 + Number(memberCount?.c ?? 0);
  }

  private mapLicenseRow(row: any): License {
    return {
      id: row.id,
      accountId: row.account_id,
      tier: row.tier,
      deviceLimit: row.device_limit,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      state: row.state,
      signature: row.signature,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      planInterval: row.plan_interval ?? null,
      graceEndsAt: row.grace_ends_at != null ? Number(row.grace_ends_at) : null,
      renewalAt: row.renewal_at != null ? Number(row.renewal_at) : null,
      customQuota: row.custom_quota != null ? Number(row.custom_quota) : null,
      paymentMethod: row.payment_method ?? null,
      amountPaid: row.amount_paid != null ? Number(row.amount_paid) : null,
      currency: row.currency ?? 'INR',
      paymentProvider: row.payment_provider ?? null,
      invoiceId: row.invoice_id ?? null,
      discountPercent: row.discount_percent != null ? Number(row.discount_percent) : null,
      notes: row.notes ?? null,
    };
  }

  // === PHASE 2: USAGE AGGREGATES ===
  async reportUsageAggregates(
    hostUuid: string,
    aggregates: Array<{ period_start: string; period_end: string; uptime_seconds: number; storage_used_bytes: number; bytes_uploaded: number; bytes_downloaded: number; total_shares: number; total_devices: number }>
  ): Promise<void> {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO usage_aggregates (host_uuid, period_start, period_end, uptime_seconds, storage_used_bytes, bytes_uploaded, bytes_downloaded, total_shares, total_devices, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_uuid, period_start) DO UPDATE SET
        period_end = excluded.period_end,
        uptime_seconds = excluded.uptime_seconds,
        storage_used_bytes = excluded.storage_used_bytes,
        bytes_uploaded = excluded.bytes_uploaded,
        bytes_downloaded = excluded.bytes_downloaded,
        total_shares = excluded.total_shares,
        total_devices = excluded.total_devices
    `);
    for (const a of aggregates) {
      stmt.run(hostUuid, a.period_start, a.period_end, a.uptime_seconds ?? 0, a.storage_used_bytes ?? 0, a.bytes_uploaded ?? 0, a.bytes_downloaded ?? 0, a.total_shares ?? 0, a.total_devices ?? 0, now);
    }
  }

  async getUsageAggregates(filters?: { hostUuid?: string; limit?: number }): Promise<UsageAggregate[]> {
    const limit = Math.min(500, Math.max(1, filters?.limit ?? 100));
    let sql = 'SELECT * FROM usage_aggregates';
    const params: any[] = [];
    if (filters?.hostUuid) {
      sql += ' WHERE host_uuid = ?';
      params.push(filters.hostUuid);
    }
    sql += ' ORDER BY period_start DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      hostUuid: r.host_uuid,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      uptimeSeconds: r.uptime_seconds ?? 0,
      storageUsedBytes: r.storage_used_bytes ?? 0,
      bytesUploaded: r.bytes_uploaded ?? 0,
      bytesDownloaded: r.bytes_downloaded ?? 0,
      totalShares: r.total_shares ?? 0,
      totalDevices: r.total_devices ?? 0,
      createdAt: r.created_at,
    }));
  }

  async listAccounts(): Promise<Account[]> {
    const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all() as any[];
    return rows.map(r => this.mapAccountRow(r));
  }

  async listLicensesWithHostCounts(): Promise<Array<License & { hostCount: number; firstDeviceId?: string | null }>> {
    const rows = db.prepare(`
      SELECT l.*,
        (SELECT COUNT(*) FROM license_hosts WHERE license_id = l.id) as host_count,
        (SELECT host_uuid FROM license_hosts WHERE license_id = l.id ORDER BY activated_at ASC LIMIT 1) as first_device_id
      FROM licenses l
      ORDER BY l.created_at DESC
    `).all() as any[];
    return rows.map(r => ({
      ...this.mapLicenseRow(r),
      hostCount: Number(r.host_count ?? 0),
      firstDeviceId: r.first_device_id ?? null,
    }));
  }

  async revokeLicense(licenseId: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare("UPDATE licenses SET state = 'revoked', updated_at = ? WHERE id = ?").run(now, licenseId);
  }

  async extendLicense(licenseId: string, newExpiresAt: number): Promise<void> {
    const now = new Date().toISOString();
    db.prepare('UPDATE licenses SET expires_at = ?, state = ?, updated_at = ? WHERE id = ?').run(newExpiresAt, 'active', now, licenseId);
  }

  async upgradeLicenseToPro(licenseId: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare('UPDATE licenses SET tier = ?, device_limit = 30, updated_at = ? WHERE id = ?').run('pro', now, licenseId);
  }

  async ensureDeviceAccount(hostUuid: string): Promise<void> {
    const existing = db.prepare('SELECT id FROM accounts WHERE id = ?').get(hostUuid) as any;
    if (existing) return;
    const now = new Date().toISOString();
    const email = `${hostUuid}@device.local`;
    db.prepare(`
      INSERT OR IGNORE INTO accounts (id, email, password_hash, trial_used, created_at, updated_at)
      VALUES (?, ?, '.', 1, ?, ?)
    `).run(hostUuid, email, now, now);
  }

  isDeviceTrialUsed(hostUuid: string): boolean {
    const row = db.prepare('SELECT 1 FROM device_trial_used WHERE host_uuid = ?').get(hostUuid) as any;
    return !!row;
  }

  setDeviceTrialUsed(hostUuid: string): void {
    db.prepare('INSERT OR IGNORE INTO device_trial_used (host_uuid) VALUES (?)').run(hostUuid);
  }

  async getOrCreateDeviceTrial(deviceId: string, trialDays = 7): Promise<{ trialStartedAt: string; trialEndsAt: string; trialExtendedAt: string | null }> {
    const now = new Date();
    const nowIso = now.toISOString();
    const endsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const endsAtIso = endsAt.toISOString();

    const existing = db.prepare('SELECT trial_started_at, trial_ends_at, trial_extended_at FROM device_trials WHERE device_id = ?').get(deviceId) as any;
    if (existing) {
      return {
        trialStartedAt: existing.trial_started_at,
        trialEndsAt: existing.trial_ends_at,
        trialExtendedAt: existing.trial_extended_at ?? null,
      };
    }

    db.prepare(`
      INSERT INTO device_trials (device_id, trial_started_at, trial_ends_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(deviceId, nowIso, endsAtIso, nowIso, nowIso);
    return { trialStartedAt: nowIso, trialEndsAt: endsAtIso, trialExtendedAt: null };
  }

  async extendDeviceTrial(deviceId: string, extraDays = 7): Promise<{ trialEndsAt: string }> {
    const now = new Date().toISOString();
    const row = db.prepare('SELECT trial_ends_at, trial_extended_at FROM device_trials WHERE device_id = ?').get(deviceId) as any;
    if (!row) throw new Error('Device trial not found');
    if (row.trial_extended_at) throw new Error('Trial already extended');
    const baseEnd = new Date(row.trial_ends_at);
    const newEnds = new Date(baseEnd.getTime() + extraDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE device_trials SET trial_extended_at = ?, trial_ends_at = ?, updated_at = ? WHERE device_id = ?').run(now, newEnds, now, deviceId);
    return { trialEndsAt: newEnds };
  }

  canExtendDeviceTrial(deviceId: string): boolean {
    const row = db.prepare('SELECT trial_extended_at FROM device_trials WHERE device_id = ?').get(deviceId) as any;
    if (!row) return false;
    return !row.trial_extended_at;
  }

  getMonthlyShareCount(deviceId: string, ym: string): number {
    const row = db.prepare('SELECT shares_created FROM device_usage_monthly WHERE device_id = ? AND ym = ?').get(deviceId, ym) as any;
    return Number(row?.shares_created ?? 0);
  }

  async incrementMonthlyShares(deviceId: string, ym: string): Promise<{ count: number }> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO device_usage_monthly (device_id, ym, shares_created, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(device_id, ym) DO UPDATE SET
        shares_created = shares_created + 1,
        updated_at = excluded.updated_at
    `).run(deviceId, ym, now);
    const row = db.prepare('SELECT shares_created FROM device_usage_monthly WHERE device_id = ? AND ym = ?').get(deviceId, ym) as any;
    return { count: Number(row?.shares_created ?? 0) };
  }

  setLogoutRequested(hostUuid: string): void {
    const now = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO device_logout_requests (host_uuid, requested_at) VALUES (?, ?)').run(hostUuid, now);
  }

  consumeLogoutRequested(hostUuid: string): boolean {
    const row = db.prepare('SELECT 1 FROM device_logout_requests WHERE host_uuid = ?').get(hostUuid) as any;
    if (!row) return false;
    db.prepare('DELETE FROM device_logout_requests WHERE host_uuid = ?').run(hostUuid);
    return true;
  }

  getSetting(key: string): string | null {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
  }

  // === BILLING & SUBSCRIPTIONS ===
  async getBillingSummary(): Promise<BillingSummary> {
    const now = Math.floor(Date.now() / 1000);
    
    // Get all active licenses with payment info
    const licenses = db.prepare(`
      SELECT l.*, a.email 
      FROM licenses l
      LEFT JOIN accounts a ON l.account_id = a.id
      WHERE l.state IN ('active', 'grace', 'trial_active')
    `).all() as any[];
    
    let totalMonthlyRevenue = 0;
    let totalYearlyRevenue = 0;
    let totalActiveSubscriptions = 0;
    let totalTrialAccounts = 0;
    
    const tierStats: Record<string, { monthly: number; yearly: number; count: number }> = {};
    const providerStats: Record<string, { amount: number; count: number }> = {};
    
    for (const lic of licenses) {
      const amount = Number(lic.amount_paid ?? 0);
      const interval = lic.plan_interval ?? 'monthly';
      const tier = lic.tier || 'pro';
      const provider = lic.payment_provider || 'manual';
      
      if (lic.state === 'trial_active') {
        totalTrialAccounts++;
        continue;
      }
      
      totalActiveSubscriptions++;
      
      // Calculate monthly equivalent
      const monthlyAmount = interval === 'yearly' ? amount / 12 : amount;
      const yearlyAmount = interval === 'yearly' ? amount : amount * 12;
      
      totalMonthlyRevenue += monthlyAmount;
      totalYearlyRevenue += yearlyAmount;
      
      // By tier
      if (!tierStats[tier]) tierStats[tier] = { monthly: 0, yearly: 0, count: 0 };
      tierStats[tier].monthly += monthlyAmount;
      tierStats[tier].yearly += yearlyAmount;
      tierStats[tier].count++;
      
      // By provider
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
    let teamInvitations: TeamInvitation[] = [];
    
    if (license && license.tier === 'teams') {
      teamMembers = await this.getLicenseMembers(license.id);
      teamInvitations = await this.getTeamInvitations(license.id);
    }
    
    return {
      ...account,
      license,
      teamMembers,
      teamInvitations,
    };
  }

  async listAccountsWithBilling(): Promise<AccountWithBilling[]> {
    const accounts = await this.listAccounts();
    const result: AccountWithBilling[] = [];
    
    for (const account of accounts) {
      const license = await this.getActiveLicenseForAccount(account.id);
      let teamMembers: Array<{ accountId: string; email: string; role: string }> = [];
      let teamInvitations: TeamInvitation[] = [];
      
      if (license && license.tier === 'teams') {
        teamMembers = await this.getLicenseMembers(license.id);
        teamInvitations = await this.getTeamInvitations(license.id);
      }
      
      result.push({
        ...account,
        license,
        teamMembers,
        teamInvitations,
      });
    }
    
    return result;
  }

  // === TEAM INVITATIONS ===
  async getTeamInvitations(licenseId: string): Promise<TeamInvitation[]> {
    const rows = db.prepare(`
      SELECT * FROM team_invitations WHERE license_id = ? ORDER BY invited_at DESC
    `).all(licenseId) as any[];
    
    return rows.map(r => ({
      id: r.id,
      licenseId: r.license_id,
      email: r.email,
      invitedBy: r.invited_by,
      invitedAt: r.invited_at,
      status: r.status,
    }));
  }

  async addTeamInvitation(licenseId: string, email: string, invitedBy: string): Promise<TeamInvitation> {
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO team_invitations (license_id, email, invited_by, invited_at, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(licenseId, email.toLowerCase(), invitedBy, now);
    
    return {
      id: Number(result.lastInsertRowid),
      licenseId,
      email: email.toLowerCase(),
      invitedBy,
      invitedAt: now,
      status: 'pending',
    };
  }

  async removeTeamInvitation(invitationId: number): Promise<void> {
    db.prepare('DELETE FROM team_invitations WHERE id = ?').run(invitationId);
  }

  async getTeamInvitationByEmail(email: string): Promise<TeamInvitation | null> {
    const row = db.prepare(`
      SELECT * FROM team_invitations WHERE email = ? AND status = 'pending' ORDER BY invited_at DESC LIMIT 1
    `).get(email.toLowerCase()) as any;
    
    if (!row) return null;
    
    return {
      id: row.id,
      licenseId: row.license_id,
      email: row.email,
      invitedBy: row.invited_by,
      invitedAt: row.invited_at,
      status: row.status,
    };
  }

  async acceptTeamInvitation(invitationId: number, accountId: string): Promise<void> {
    const invitation = db.prepare('SELECT * FROM team_invitations WHERE id = ?').get(invitationId) as any;
    if (!invitation) throw new Error('Invitation not found');
    
    // Add member to license
    await this.addLicenseMember(invitation.license_id, accountId);
    
    // Mark invitation as accepted
    db.prepare("UPDATE team_invitations SET status = 'accepted' WHERE id = ?").run(invitationId);
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
    const parts: string[] = [];
    const values: any[] = [];
    
    if (updates.paymentMethod !== undefined) { parts.push('payment_method = ?'); values.push(updates.paymentMethod); }
    if (updates.amountPaid !== undefined) { parts.push('amount_paid = ?'); values.push(updates.amountPaid); }
    if (updates.currency !== undefined) { parts.push('currency = ?'); values.push(updates.currency); }
    if (updates.paymentProvider !== undefined) { parts.push('payment_provider = ?'); values.push(updates.paymentProvider); }
    if (updates.invoiceId !== undefined) { parts.push('invoice_id = ?'); values.push(updates.invoiceId); }
    if (updates.discountPercent !== undefined) { parts.push('discount_percent = ?'); values.push(updates.discountPercent); }
    if (updates.notes !== undefined) { parts.push('notes = ?'); values.push(updates.notes); }
    
    if (parts.length === 0) return;
    
    const now = new Date().toISOString();
    parts.push('updated_at = ?');
    values.push(now);
    values.push(licenseId);
    
    db.prepare(`UPDATE licenses SET ${parts.join(', ')} WHERE id = ?`).run(...values);
  }

  // === NEW METHODS FOR LICENSE ACCOUNT MANAGEMENT SYSTEM ===

  // Helper to generate referral code
  private generateReferralCode(email: string): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(email + Date.now()).digest('hex');
    return 'JC-' + hash.substring(0, 5).toUpperCase();
  }

  // Helper to map subscription row
  private mapSubscriptionRow(row: any): Subscription {
    return {
      id: row.id,
      accountId: row.account_id,
      licenseId: row.license_id ?? null,
      provider: row.provider,
      providerSubscriptionId: row.provider_subscription_id ?? null,
      plan: row.plan,
      status: row.status,
      amount: Number(row.amount ?? 0),
      currency: row.currency ?? 'INR',
      interval: row.interval ?? 'month',
      currentPeriodStart: row.current_period_start ? Number(row.current_period_start) : null,
      currentPeriodEnd: row.current_period_end ? Number(row.current_period_end) : null,
      paymentDueDate: row.payment_due_date ? Number(row.payment_due_date) : null,
      graceEndsAt: row.grace_ends_at ? Number(row.grace_ends_at) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Helper to map payment row
  private mapPaymentRow(row: any): Payment {
    return {
      id: row.id,
      subscriptionId: row.subscription_id ?? null,
      accountId: row.account_id,
      deviceId: row.device_id ?? null,
      provider: row.provider,
      providerPaymentId: row.provider_payment_id ?? null,
      amount: Number(row.amount ?? 0),
      currency: row.currency ?? 'INR',
      status: row.status,
      invoiceUrl: row.invoice_url ?? null,
      createdAt: row.created_at,
    };
  }

  // Helper to map recovery request row
  private mapRecoveryRequestRow(row: any): DeviceRecoveryRequest {
    return {
      id: row.id,
      accountId: row.account_id,
      oldDeviceId: row.old_device_id,
      newDeviceId: row.new_device_id,
      reason: row.reason ?? null,
      status: row.status,
      adminNotes: row.admin_notes ?? null,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? null,
      resolvedBy: row.resolved_by ?? null,
    };
  }

  // Helper to map referral row
  private mapReferralRow(row: any): Referral {
    return {
      id: row.id,
      referrerAccountId: row.referrer_account_id,
      referredAccountId: row.referred_account_id,
      referralCode: row.referral_code,
      daysGranted: Number(row.days_granted ?? 10),
      status: row.status,
      createdAt: row.created_at,
    };
  }

  // === SUBSCRIPTIONS ===

  async createSubscription(subscription: Omit<Subscription, 'createdAt' | 'updatedAt'>): Promise<Subscription> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO subscriptions (id, account_id, license_id, provider, provider_subscription_id, plan, status, amount, currency, interval, current_period_start, current_period_end, payment_due_date, grace_ends_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subscription.id,
      subscription.accountId,
      subscription.licenseId,
      subscription.provider,
      subscription.providerSubscriptionId,
      subscription.plan,
      subscription.status,
      subscription.amount,
      subscription.currency,
      subscription.interval,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
      subscription.paymentDueDate,
      subscription.graceEndsAt,
      now,
      now
    );
    const row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscription.id) as any;
    return this.mapSubscriptionRow(row);
  }

  async getSubscriptionById(subscriptionId: string): Promise<Subscription | null> {
    const row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as any;
    if (!row) return null;
    return this.mapSubscriptionRow(row);
  }

  async getSubscriptionByAccountId(accountId: string): Promise<Subscription | null> {
    const row = db.prepare('SELECT * FROM subscriptions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1').get(accountId) as any;
    if (!row) return null;
    return this.mapSubscriptionRow(row);
  }

  async getSubscriptionByLicenseId(licenseId: string): Promise<Subscription | null> {
    const row = db.prepare('SELECT * FROM subscriptions WHERE license_id = ? ORDER BY created_at DESC LIMIT 1').get(licenseId) as any;
    if (!row) return null;
    return this.mapSubscriptionRow(row);
  }

  async updateSubscription(subscriptionId: string, updates: Partial<Subscription>): Promise<void> {
    const now = new Date().toISOString();
    const parts: string[] = ['updated_at = ?'];
    const values: any[] = [now];
    
    if (updates.status !== undefined) { parts.push('status = ?'); values.push(updates.status); }
    if (updates.currentPeriodStart !== undefined) { parts.push('current_period_start = ?'); values.push(updates.currentPeriodStart); }
    if (updates.currentPeriodEnd !== undefined) { parts.push('current_period_end = ?'); values.push(updates.currentPeriodEnd); }
    if (updates.paymentDueDate !== undefined) { parts.push('payment_due_date = ?'); values.push(updates.paymentDueDate); }
    if (updates.graceEndsAt !== undefined) { parts.push('grace_ends_at = ?'); values.push(updates.graceEndsAt); }
    if (updates.amount !== undefined) { parts.push('amount = ?'); values.push(updates.amount); }
    if (updates.plan !== undefined) { parts.push('plan = ?'); values.push(updates.plan); }
    
    values.push(subscriptionId);
    db.prepare(`UPDATE subscriptions SET ${parts.join(', ')} WHERE id = ?`).run(...values);
  }

  async listSubscriptions(filters?: { status?: string; provider?: string }): Promise<Subscription[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.provider) {
      conditions.push('provider = ?');
      params.push(filters.provider);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM subscriptions ${whereClause} ORDER BY created_at DESC`).all(...params) as any[];
    return rows.map(r => this.mapSubscriptionRow(r));
  }

  // === PAYMENTS ===

  async createPayment(payment: Omit<Payment, 'createdAt'>): Promise<Payment> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO payments (id, subscription_id, account_id, device_id, provider, provider_payment_id, amount, currency, status, invoice_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.id,
      payment.subscriptionId,
      payment.accountId,
      payment.deviceId,
      payment.provider,
      payment.providerPaymentId,
      payment.amount,
      payment.currency,
      payment.status,
      payment.invoiceUrl,
      now
    );
    const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id) as any;
    return this.mapPaymentRow(row);
  }

  async getPaymentById(paymentId: string): Promise<Payment | null> {
    const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
    if (!row) return null;
    return this.mapPaymentRow(row);
  }

  async getPaymentsByAccountId(accountId: string): Promise<Payment[]> {
    const rows = db.prepare('SELECT * FROM payments WHERE account_id = ? ORDER BY created_at DESC').all(accountId) as any[];
    return rows.map(r => this.mapPaymentRow(r));
  }

  async getPaymentsBySubscriptionId(subscriptionId: string): Promise<Payment[]> {
    const rows = db.prepare('SELECT * FROM payments WHERE subscription_id = ? ORDER BY created_at DESC').all(subscriptionId) as any[];
    return rows.map(r => this.mapPaymentRow(r));
  }

  async updatePaymentStatus(paymentId: string, status: string): Promise<void> {
    db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, paymentId);
  }

  // === DEVICE RECOVERY ===

  async createDeviceRecoveryRequest(request: Omit<DeviceRecoveryRequest, 'createdAt' | 'resolvedAt' | 'resolvedBy'>): Promise<DeviceRecoveryRequest> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO device_recovery_requests (id, account_id, old_device_id, new_device_id, reason, status, admin_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.id,
      request.accountId,
      request.oldDeviceId,
      request.newDeviceId,
      request.reason,
      request.status,
      request.adminNotes,
      now
    );
    const row = db.prepare('SELECT * FROM device_recovery_requests WHERE id = ?').get(request.id) as any;
    return this.mapRecoveryRequestRow(row);
  }

  async getDeviceRecoveryRequestById(requestId: string): Promise<DeviceRecoveryRequest | null> {
    const row = db.prepare('SELECT * FROM device_recovery_requests WHERE id = ?').get(requestId) as any;
    if (!row) return null;
    return this.mapRecoveryRequestRow(row);
  }

  async getPendingRecoveryRequests(): Promise<DeviceRecoveryRequest[]> {
    const rows = db.prepare("SELECT * FROM device_recovery_requests WHERE status = 'pending' ORDER BY created_at DESC").all() as any[];
    return rows.map(r => this.mapRecoveryRequestRow(r));
  }

  async getRecoveryRequestsByAccountId(accountId: string): Promise<DeviceRecoveryRequest[]> {
    const rows = db.prepare('SELECT * FROM device_recovery_requests WHERE account_id = ? ORDER BY created_at DESC').all(accountId) as any[];
    return rows.map(r => this.mapRecoveryRequestRow(r));
  }

  async resolveDeviceRecoveryRequest(requestId: string, status: 'approved' | 'rejected', adminNotes: string, resolvedBy: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE device_recovery_requests 
      SET status = ?, admin_notes = ?, resolved_at = ?, resolved_by = ?
      WHERE id = ?
    `).run(status, adminNotes, now, resolvedBy, requestId);
    
    // If approved, transfer the license to the new device
    if (status === 'approved') {
      const request = await this.getDeviceRecoveryRequestById(requestId);
      if (request) {
        // Find license for old device and update to new device
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
    db.prepare(`
      INSERT INTO referrals (id, referrer_account_id, referred_account_id, referral_code, days_granted, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      referral.id,
      referral.referrerAccountId,
      referral.referredAccountId,
      referral.referralCode,
      referral.daysGranted,
      referral.status,
      now
    );
    const row = db.prepare('SELECT * FROM referrals WHERE id = ?').get(referral.id) as any;
    return this.mapReferralRow(row);
  }

  async getReferralsByReferrerId(referrerAccountId: string): Promise<Referral[]> {
    const rows = db.prepare('SELECT * FROM referrals WHERE referrer_account_id = ? ORDER BY created_at DESC').all(referrerAccountId) as any[];
    return rows.map(r => this.mapReferralRow(r));
  }

  async getReferralByReferredId(referredAccountId: string): Promise<Referral | null> {
    const row = db.prepare('SELECT * FROM referrals WHERE referred_account_id = ?').get(referredAccountId) as any;
    if (!row) return null;
    return this.mapReferralRow(row);
  }

  async getAccountByReferralCode(referralCode: string): Promise<Account | null> {
    const row = db.prepare('SELECT * FROM accounts WHERE referral_code = ?').get(referralCode) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  async updateAccountReferral(accountId: string, updates: { referralCode?: string; referredBy?: string; referralCount?: number; referralDaysEarned?: number }): Promise<void> {
    const now = new Date().toISOString();
    const parts: string[] = ['updated_at = ?'];
    const values: any[] = [now];
    
    if (updates.referralCode !== undefined) { parts.push('referral_code = ?'); values.push(updates.referralCode); }
    if (updates.referredBy !== undefined) { parts.push('referred_by = ?'); values.push(updates.referredBy); }
    if (updates.referralCount !== undefined) { parts.push('referral_count = ?'); values.push(updates.referralCount); }
    if (updates.referralDaysEarned !== undefined) { parts.push('referral_days_earned = ?'); values.push(updates.referralDaysEarned); }
    
    values.push(accountId);
    db.prepare(`UPDATE accounts SET ${parts.join(', ')} WHERE id = ?`).run(...values);
  }

  async getReferralStats(accountId: string): Promise<ReferralStats> {
    const account = await this.getAccountById(accountId);
    if (!account) {
      return {
        referralCode: '',
        referralLink: '',
        totalReferrals: 0,
        daysEarned: 0,
        referrals: [],
      };
    }
    
    const referrals = await this.getReferralsByReferrerId(accountId);
    const referralDetails: Array<{ email: string; date: number; daysGranted: number }> = [];
    
    for (const ref of referrals) {
      const referredAccount = await this.getAccountById(ref.referredAccountId);
      if (referredAccount) {
        // Mask email for privacy
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

  // === LICENSE CHECK FOR DESKTOP APP ===

  async getLicenseCheckResponse(deviceId: string): Promise<LicenseCheckResponse> {
    const webUrl = process.env.JOINCLOUD_WEB_URL || 'https://dashboard.joincloud.in';
    const now = Math.floor(Date.now() / 1000);
    
    // Check if host is suspended
    const host = await this.getHostByUUID(deviceId);
    const isSuspended = host && (db.prepare('SELECT suspended FROM hosts WHERE host_uuid = ?').get(deviceId) as any)?.suspended === 1;
    
    // Get license for this device
    const license = await this.getLicenseForHost(deviceId);
    
    // Get account if license exists
    let account: Account | null = null;
    let subscription: Subscription | null = null;
    
    if (license && license.accountId && !license.accountId.includes('@device.local')) {
      account = await this.getAccountById(license.accountId);
      subscription = await this.getSubscriptionByAccountId(license.accountId);
    }
    
    // Calculate days remaining
    const daysRemaining = license ? Math.max(0, Math.ceil((license.expiresAt - now) / (24 * 60 * 60))) : null;
    const graceDaysRemaining = license?.graceEndsAt ? Math.max(0, Math.ceil((license.graceEndsAt - now) / (24 * 60 * 60))) : null;
    
    // Determine license state
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
    
    // Determine UI state
    const hasAccount = !!account && !account.email.includes('@device.local');
    const isBlocked = state === 'expired' || state === 'suspended' || state === 'revoked';
    
    // Determine buttons and banner based on state
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
    notes?: string | null;
    licenseId?: string | null;
    approvedBy?: string | null;
    approvedAt?: string | null;
    createdAt: string;
  }): Promise<void> {
    db.prepare(`
      INSERT INTO subscription_requests (
        id, status, plan_id, email, phone, account_id, device_id,
        custom_users, custom_devices, notes, license_id, approved_by, approved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.id,
      request.status,
      request.planId,
      request.email,
      request.phone ?? null,
      request.accountId ?? null,
      request.deviceId ?? null,
      request.customUsers ?? null,
      request.customDevices ?? null,
      request.notes ?? null,
      request.licenseId ?? null,
      request.approvedBy ?? null,
      request.approvedAt ?? null,
      request.createdAt,
    );
  }

  async listSubscriptionRequests(filters?: { status?: string }): Promise<any[]> {
    if (filters?.status) {
      return db.prepare(
        `SELECT * FROM subscription_requests WHERE status = ? ORDER BY created_at DESC`
      ).all(filters.status) as any[];
    }
    return db.prepare(
      `SELECT * FROM subscription_requests ORDER BY created_at DESC`
    ).all() as any[];
  }

  async getSubscriptionRequestById(id: string): Promise<any | null> {
    const row = db.prepare(
      `SELECT * FROM subscription_requests WHERE id = ?`
    ).get(id) as any;
    return row || null;
  }

  async updateSubscriptionRequest(id: string, updates: Partial<{
    status: "pending" | "approved" | "rejected";
    notes: string | null;
    licenseId: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
  }>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.notes !== undefined) {
      sets.push("notes = ?");
      params.push(updates.notes);
    }
    if (updates.licenseId !== undefined) {
      sets.push("license_id = ?");
      params.push(updates.licenseId);
    }
    if (updates.approvedBy !== undefined) {
      sets.push("approved_by = ?");
      params.push(updates.approvedBy);
    }
    if (updates.approvedAt !== undefined) {
      sets.push("approved_at = ?");
      params.push(updates.approvedAt);
    }
    if (!sets.length) return;
    params.push(id);
    db.prepare(
      `UPDATE subscription_requests SET ${sets.join(", ")} WHERE id = ?`
    ).run(...params);
  }

  // === DEVICE-ONLY LICENSE ===

  async createDeviceOnlyLicense(deviceId: string, tier: string, expiresAt: number, signature: string): Promise<License> {
    const now = new Date().toISOString();
    const nowUnix = Math.floor(Date.now() / 1000);
    const licenseId = require('crypto').randomUUID();
    
    // Create a device-only account (placeholder)
    const deviceAccountId = deviceId;
    const deviceEmail = `${deviceId}@device.local`;
    
    // Ensure device account exists
    await this.ensureDeviceAccount(deviceId);
    
    // Create the license
    db.prepare(`
      INSERT INTO licenses (id, account_id, tier, device_limit, issued_at, expires_at, state, signature, created_at, updated_at, is_device_only)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      licenseId,
      deviceAccountId,
      tier,
      1,
      nowUnix,
      expiresAt,
      tier === 'TRIAL' ? 'trial_active' : 'active',
      signature,
      now,
      now
    );
    
    // Link license to device
    await this.addLicenseHost(licenseId, deviceId);
    
    const row = db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId) as any;
    return this.mapLicenseRow(row);
  }

  async getLicenseByDeviceId(deviceId: string): Promise<License | null> {
    return this.getLicenseForHost(deviceId);
  }

  async linkLicenseToAccount(licenseId: string, accountId: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare('UPDATE licenses SET account_id = ?, is_device_only = 0, updated_at = ? WHERE id = ?').run(accountId, now, licenseId);
  }

  // === SUSPENSION ===

  async suspendHost(hostUuid: string, reason: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare('UPDATE hosts SET suspended = 1, suspension_reason = ?, updated_at = ? WHERE host_uuid = ?').run(reason, now, hostUuid);
  }

  async unsuspendHost(hostUuid: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare('UPDATE hosts SET suspended = 0, suspension_reason = NULL, updated_at = ? WHERE host_uuid = ?').run(now, hostUuid);
  }

  isHostSuspended(hostUuid: string): boolean {
    const row = db.prepare('SELECT suspended FROM hosts WHERE host_uuid = ?').get(hostUuid) as any;
    return row?.suspended === 1;
  }

  // === ACCOUNT DEVICE TRACKING ===

  async incrementDeviceChangeCount(accountId: string): Promise<number> {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE accounts 
      SET device_change_count = COALESCE(device_change_count, 0) + 1, 
          last_device_change_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, accountId);
    
    const row = db.prepare('SELECT device_change_count FROM accounts WHERE id = ?').get(accountId) as any;
    return Number(row?.device_change_count ?? 1);
  }

  // === SUBSCRIPTION STATS ===

  async getSubscriptionStats(): Promise<SubscriptionStats> {
    const now = Math.floor(Date.now() / 1000);
    const oneMonthAgo = now - (30 * 24 * 60 * 60);
    
    // Get all subscriptions
    const subscriptions = db.prepare('SELECT * FROM subscriptions').all() as any[];
    const activeSubscriptions = subscriptions.filter(s => s.status === 'active');
    
    // Calculate MRR
    let mrr = 0;
    for (const sub of activeSubscriptions) {
      const amount = Number(sub.amount ?? 0);
      if (sub.interval === 'year') {
        mrr += amount / 12;
      } else {
        mrr += amount;
      }
    }
    
    // Get trial users
    const trialUsers = db.prepare("SELECT COUNT(*) as c FROM licenses WHERE state = 'trial_active'").get() as any;
    
    // Calculate churn (simplified: cancelled in last 30 days / active at start)
    const cancelledLastMonth = subscriptions.filter(s => 
      s.status === 'cancelled' && 
      new Date(s.updated_at).getTime() / 1000 > oneMonthAgo
    ).length;
    const churnRate = activeSubscriptions.length > 0 
      ? (cancelledLastMonth / (activeSubscriptions.length + cancelledLastMonth)) * 100 
      : 0;
    
    // By plan
    const planStats: Record<string, { count: number; revenue: number }> = {};
    for (const sub of activeSubscriptions) {
      const plan = sub.plan || 'unknown';
      if (!planStats[plan]) planStats[plan] = { count: 0, revenue: 0 };
      planStats[plan].count++;
      planStats[plan].revenue += Number(sub.amount ?? 0);
    }
    
    // By device platform
    const deviceStats = db.prepare(`
      SELECT h.platform, COUNT(DISTINCT lh.host_uuid) as count
      FROM license_hosts lh
      INNER JOIN hosts h ON h.host_uuid = lh.host_uuid
      INNER JOIN licenses l ON l.id = lh.license_id
      WHERE l.state IN ('active', 'trial_active', 'grace')
      GROUP BY h.platform
    `).all() as any[];
    
    return {
      totalMonthlyRevenue: mrr,
      totalYearlyRevenue: mrr * 12,
      mrr,
      arr: mrr * 12,
      activeSubscriptions: activeSubscriptions.length,
      trialUsers: Number(trialUsers?.c ?? 0),
      churnRate: Math.round(churnRate * 100) / 100,
      byCountry: [], // Would need country data from payment provider
      byPlan: Object.entries(planStats).map(([plan, stats]) => ({ plan, ...stats })),
      byDevice: deviceStats.map(d => ({ platform: d.platform || 'unknown', count: Number(d.count ?? 0) })),
    };
  }
}

export const storage = new SqliteStorage();
