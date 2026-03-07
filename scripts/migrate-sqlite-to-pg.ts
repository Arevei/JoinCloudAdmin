/**
 * One-time migration script: copies all data from the local SQLite database
 * (data/telemetry.db) into the Neon PostgreSQL database.
 *
 * Usage:
 *   npx tsx scripts/migrate-sqlite-to-pg.ts
 *
 * Prerequisites:
 *   - DATABASE_URL must be set in .env (pointing to Neon)
 *   - The SQLite file must exist at ./data/telemetry.db (or JOINCLOUD_CONTROL_PLANE_DB_PATH)
 *   - Run `npx drizzle-kit push` first so all tables exist in Postgres
 *
 * This script is safe to re-run; it uses INSERT ... ON CONFLICT DO NOTHING
 * (via Drizzle's onConflictDoNothing) so it won't duplicate records.
 */

import 'dotenv/config';
import BetterSqlite3 from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../server/db';
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
  subscriptions,
  subscriptionRequests,
  payments,
  deviceRecoveryRequests,
  referrals,
} from '../shared/schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.JOINCLOUD_CONTROL_PLANE_DB_PATH || join(__dirname, '..', 'data', 'telemetry.db');

function boolOrInt(val: any): boolean | null {
  if (val === null || val === undefined) return null;
  return val === 1 || val === true;
}

async function migrateBatch<T extends Record<string, any>>(
  label: string,
  rows: T[],
  insertFn: (batch: T[]) => Promise<void>
) {
  if (!rows.length) {
    console.log(`  [${label}] No rows, skipping.`);
    return;
  }
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await insertFn(rows.slice(i, i + BATCH));
    inserted += Math.min(BATCH, rows.length - i);
  }
  console.log(`  [${label}] Migrated ${inserted} rows.`);
}

async function main() {
  console.log(`Reading SQLite from: ${dbPath}`);
  let sqlite: BetterSqlite3.Database;
  try {
    sqlite = new BetterSqlite3(dbPath, { readonly: true });
  } catch (e) {
    console.error(`Could not open SQLite: ${e}`);
    process.exit(1);
  }

  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
  console.log('Tables found:', tables.join(', '));

  // Migrate in dependency order (parents before children)

  if (tables.includes('users')) {
    const rows = sqlite.prepare('SELECT * FROM users').all() as any[];
    await migrateBatch('users', rows, async (batch) => {
      await db.insert(users).values(batch.map(r => ({
        userId: r.user_id,
        deviceIndex: r.device_index ?? null,
        firstSeen: r.first_seen ?? null,
        lastSeen: r.last_seen ?? null,
        lastHeartbeat: r.last_heartbeat ?? null,
        appVersion: r.app_version ?? null,
        os: r.os ?? null,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('daily_metrics')) {
    const rows = sqlite.prepare('SELECT * FROM daily_metrics').all() as any[];
    await migrateBatch('daily_metrics', rows, async (batch) => {
      await db.insert(dailyMetrics).values(batch.map(r => ({
        userId: r.user_id,
        date: r.date,
        uptimeSeconds: r.uptime_seconds ?? 0,
        filesUploaded: r.files_uploaded ?? 0,
        filesDownloaded: r.files_downloaded ?? 0,
        bytesUploaded: r.bytes_uploaded ?? 0,
        bytesDownloaded: r.bytes_downloaded ?? 0,
        sharesCreated: r.shares_created ?? 0,
        publicShares: r.public_shares ?? 0,
        lanShares: r.lan_shares ?? 0,
        networkVisibilityEnabled: r.network_visibility_enabled === 1 || r.network_visibility_enabled === true,
        networkPeersDetected: r.network_peers_detected ?? 0,
        displayNameCustomized: r.display_name_customized === 1 || r.display_name_customized === true,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('support_threads')) {
    const rows = sqlite.prepare('SELECT * FROM support_threads').all() as any[];
    await migrateBatch('support_threads', rows, async (batch) => {
      for (const r of batch) {
        await db.insert(supportThreads).values({
          id: r.id,
          deviceUuid: r.device_uuid,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }).onConflictDoNothing();
      }
    });
  }

  if (tables.includes('support_messages')) {
    const rows = sqlite.prepare('SELECT * FROM support_messages').all() as any[];
    await migrateBatch('support_messages', rows, async (batch) => {
      for (const r of batch) {
        await db.insert(supportMessages).values({
          id: r.id,
          threadId: r.thread_id,
          sender: r.sender,
          text: r.text,
          timestamp: r.timestamp,
        }).onConflictDoNothing();
      }
    });
  }

  if (tables.includes('hosts')) {
    const rows = sqlite.prepare('SELECT * FROM hosts').all() as any[];
    await migrateBatch('hosts', rows, async (batch) => {
      await db.insert(hosts).values(batch.map(r => ({
        id: r.id,
        hostUuid: r.host_uuid,
        installationId: r.installation_id ?? '',
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
        firstInstalledAt: r.first_installed_at,
        version: r.version,
        platform: r.platform,
        arch: r.arch,
        trialStartAt: r.trial_start_at ?? null,
        trialEndsAt: r.trial_ends_at ?? null,
        trialExtendedAt: r.trial_extended_at ?? null,
        registrationStatus: r.registration_status ?? 'registered',
        suspended: r.suspended ?? 0,
        suspensionReason: r.suspension_reason ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('device_logs')) {
    const rows = sqlite.prepare('SELECT * FROM device_logs').all() as any[];
    await migrateBatch('device_logs', rows, async (batch) => {
      for (const r of batch) {
        await db.insert(deviceLogs).values({
          id: r.id,
          deviceUuid: r.device_uuid,
          level: r.level,
          message: r.message,
          context: r.context ?? null,
          timestamp: r.timestamp,
          expiresAt: r.expires_at,
        }).onConflictDoNothing();
      }
    });
  }

  if (tables.includes('device_trials')) {
    const rows = sqlite.prepare('SELECT * FROM device_trials').all() as any[];
    await migrateBatch('device_trials', rows, async (batch) => {
      await db.insert(deviceTrials).values(batch.map(r => ({
        deviceId: r.device_id,
        trialStartedAt: r.trial_started_at,
        trialEndsAt: r.trial_ends_at,
        trialExtendedAt: r.trial_extended_at ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('device_usage_monthly')) {
    const rows = sqlite.prepare('SELECT * FROM device_usage_monthly').all() as any[];
    await migrateBatch('device_usage_monthly', rows, async (batch) => {
      await db.insert(deviceUsageMonthly).values(batch.map(r => ({
        deviceId: r.device_id,
        ym: r.ym,
        sharesCreated: r.shares_created ?? 0,
        updatedAt: r.updated_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('device_trial_used')) {
    const rows = sqlite.prepare('SELECT * FROM device_trial_used').all() as any[];
    await migrateBatch('device_trial_used', rows, async (batch) => {
      await db.insert(deviceTrialUsed).values(batch.map(r => ({ hostUuid: r.host_uuid }))).onConflictDoNothing();
    });
  }

  if (tables.includes('device_logout_requests')) {
    const rows = sqlite.prepare('SELECT * FROM device_logout_requests').all() as any[];
    await migrateBatch('device_logout_requests', rows, async (batch) => {
      await db.insert(deviceLogoutRequests).values(batch.map(r => ({
        hostUuid: r.host_uuid,
        requestedAt: r.requested_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('accounts')) {
    const rows = sqlite.prepare('SELECT * FROM accounts').all() as any[];
    await migrateBatch('accounts', rows, async (batch) => {
      await db.insert(accounts).values(batch.map(r => ({
        id: r.id,
        email: r.email,
        passwordHash: r.password_hash,
        trialUsed: r.trial_used ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        stripeCustomerId: r.stripe_customer_id ?? null,
        subscriptionId: r.subscription_id ?? null,
        subscriptionStatus: r.subscription_status ?? null,
        renewalAt: r.renewal_at ?? null,
        graceEndsAt: r.grace_ends_at ?? null,
        razorpayCustomerId: r.razorpay_customer_id ?? null,
        razorpaySubscriptionId: r.razorpay_subscription_id ?? null,
        username: r.username ?? null,
        referralCode: r.referral_code ?? null,
        referredBy: r.referred_by ?? null,
        referralCount: r.referral_count ?? 0,
        referralDaysEarned: r.referral_days_earned ?? 0,
        deviceChangeCount: r.device_change_count ?? 0,
        lastDeviceChangeAt: r.last_device_change_at ?? null,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('licenses')) {
    const rows = sqlite.prepare('SELECT * FROM licenses').all() as any[];
    await migrateBatch('licenses', rows, async (batch) => {
      await db.insert(licenses).values(batch.map(r => ({
        id: r.id,
        accountId: r.account_id,
        tier: r.tier,
        deviceLimit: r.device_limit,
        issuedAt: r.issued_at,
        expiresAt: r.expires_at,
        state: r.state,
        signature: r.signature,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        planInterval: r.plan_interval ?? null,
        graceEndsAt: r.grace_ends_at ?? null,
        renewalAt: r.renewal_at ?? null,
        customQuota: r.custom_quota ?? null,
        userLimit: r.user_limit ?? null,
        teamLimit: r.team_limit ?? null,
        shareLimitMonthly: r.share_limit_monthly ?? null,
        devicesPerUser: r.devices_per_user ?? null,
        overridesJson: r.overrides_json ?? null,
        paymentMethod: r.payment_method ?? null,
        amountPaid: r.amount_paid ?? null,
        currency: r.currency ?? 'INR',
        paymentProvider: r.payment_provider ?? null,
        invoiceId: r.invoice_id ?? null,
        discountPercent: r.discount_percent ?? 0,
        notes: r.notes ?? null,
        isDeviceOnly: r.is_device_only ?? 0,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('license_hosts')) {
    const rows = sqlite.prepare('SELECT * FROM license_hosts').all() as any[];
    await migrateBatch('license_hosts', rows, async (batch) => {
      for (const r of batch) {
        await db.insert(licenseHosts).values({
          id: r.id,
          licenseId: r.license_id,
          hostUuid: r.host_uuid,
          activatedAt: r.activated_at,
        }).onConflictDoNothing();
      }
    });
  }

  if (tables.includes('license_members')) {
    const rows = sqlite.prepare('SELECT * FROM license_members').all() as any[];
    await migrateBatch('license_members', rows, async (batch) => {
      await db.insert(licenseMembers).values(batch.map(r => ({
        licenseId: r.license_id,
        accountId: r.account_id,
        role: r.role ?? 'member',
        createdAt: r.created_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('team_invitations')) {
    const rows = sqlite.prepare('SELECT * FROM team_invitations').all() as any[];
    await migrateBatch('team_invitations', rows, async (batch) => {
      for (const r of batch) {
        await db.insert(teamInvitations).values({
          id: r.id,
          licenseId: r.license_id,
          email: r.email,
          invitedBy: r.invited_by,
          invitedAt: r.invited_at,
          status: r.status ?? 'pending',
        }).onConflictDoNothing();
      }
    });
  }

  if (tables.includes('usage_aggregates')) {
    const rows = sqlite.prepare('SELECT * FROM usage_aggregates').all() as any[];
    await migrateBatch('usage_aggregates', rows, async (batch) => {
      for (const r of batch) {
        await db.insert(usageAggregates).values({
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
        }).onConflictDoNothing();
      }
    });
  }

  if (tables.includes('app_settings')) {
    const rows = sqlite.prepare('SELECT * FROM app_settings').all() as any[];
    await migrateBatch('app_settings', rows, async (batch) => {
      await db.insert(appSettings).values(batch.map(r => ({
        key: r.key,
        value: r.value,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('subscriptions')) {
    const rows = sqlite.prepare('SELECT * FROM subscriptions').all() as any[];
    await migrateBatch('subscriptions', rows, async (batch) => {
      await db.insert(subscriptions).values(batch.map(r => ({
        id: r.id,
        accountId: r.account_id,
        licenseId: r.license_id ?? null,
        provider: r.provider,
        providerSubscriptionId: r.provider_subscription_id ?? null,
        plan: r.plan,
        status: r.status ?? 'active',
        amount: r.amount,
        currency: r.currency ?? 'INR',
        interval: r.interval ?? 'month',
        currentPeriodStart: r.current_period_start ?? null,
        currentPeriodEnd: r.current_period_end ?? null,
        paymentDueDate: r.payment_due_date ?? null,
        graceEndsAt: r.grace_ends_at ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('subscription_requests')) {
    const rows = sqlite.prepare('SELECT * FROM subscription_requests').all() as any[];
    await migrateBatch('subscription_requests', rows, async (batch) => {
      await db.insert(subscriptionRequests).values(batch.map(r => ({
        id: r.id,
        status: r.status ?? 'pending',
        planId: r.plan_id,
        email: r.email,
        phone: r.phone ?? null,
        accountId: r.account_id ?? null,
        deviceId: r.device_id ?? null,
        customUsers: r.custom_users ?? null,
        customDevices: r.custom_devices ?? null,
        notes: r.notes ?? null,
        licenseId: r.license_id ?? null,
        approvedBy: r.approved_by ?? null,
        approvedAt: r.approved_at ?? null,
        createdAt: r.created_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('payments')) {
    const rows = sqlite.prepare('SELECT * FROM payments').all() as any[];
    await migrateBatch('payments', rows, async (batch) => {
      await db.insert(payments).values(batch.map(r => ({
        id: r.id,
        subscriptionId: r.subscription_id ?? null,
        accountId: r.account_id,
        deviceId: r.device_id ?? null,
        provider: r.provider,
        providerPaymentId: r.provider_payment_id ?? null,
        amount: r.amount,
        currency: r.currency ?? 'INR',
        status: r.status ?? 'pending',
        invoiceUrl: r.invoice_url ?? null,
        createdAt: r.created_at,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('device_recovery_requests')) {
    const rows = sqlite.prepare('SELECT * FROM device_recovery_requests').all() as any[];
    await migrateBatch('device_recovery_requests', rows, async (batch) => {
      await db.insert(deviceRecoveryRequests).values(batch.map(r => ({
        id: r.id,
        accountId: r.account_id,
        oldDeviceId: r.old_device_id,
        newDeviceId: r.new_device_id,
        reason: r.reason ?? null,
        status: r.status ?? 'pending',
        adminNotes: r.admin_notes ?? null,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at ?? null,
        resolvedBy: r.resolved_by ?? null,
      }))).onConflictDoNothing();
    });
  }

  if (tables.includes('referrals')) {
    const rows = sqlite.prepare('SELECT * FROM referrals').all() as any[];
    await migrateBatch('referrals', rows, async (batch) => {
      await db.insert(referrals).values(batch.map(r => ({
        id: r.id,
        referrerAccountId: r.referrer_account_id,
        referredAccountId: r.referred_account_id,
        referralCode: r.referral_code,
        daysGranted: r.days_granted ?? 10,
        status: r.status ?? 'completed',
        createdAt: r.created_at,
      }))).onConflictDoNothing();
    });
  }

  sqlite.close();
  console.log('\nMigration complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
