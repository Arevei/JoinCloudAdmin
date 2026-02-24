import Stripe from "stripe";
import { storage } from "./storage";
import { signLicense } from "./license-sign";

const GRACE_DAYS = 7;

/** Map Stripe subscription status to license state and optional grace_ends_at (Unix s). */
function subscriptionStatusToState(
  status: string,
  currentPeriodEnd: number
): { state: string; expiresAt: number; graceEndsAt: number | null; renewalAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const renewalAt = currentPeriodEnd;
  switch (status) {
    case "trialing":
      return { state: "trial_active", expiresAt: currentPeriodEnd, graceEndsAt: null, renewalAt };
    case "active":
      return { state: "active", expiresAt: currentPeriodEnd, graceEndsAt: null, renewalAt };
    case "past_due":
      const graceEndsAt = now + GRACE_DAYS * 24 * 3600;
      return { state: "grace", expiresAt: currentPeriodEnd, graceEndsAt, renewalAt };
    case "unpaid":
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
      return { state: "expired", expiresAt: now, graceEndsAt: null, renewalAt };
    default:
      return { state: "active", expiresAt: currentPeriodEnd, graceEndsAt: null, renewalAt };
  }
}

/** Resolve device_limit from Stripe subscription (metadata or price). Pro=1, Team=5 default. */
function getDeviceLimitFromSubscription(sub: Stripe.Subscription): number {
  const meta = sub.metadata?.device_limit;
  if (meta) return Math.max(1, parseInt(meta, 10) || 1);
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  if (!priceId) return 1;
  if (typeof process.env.STRIPE_PRICE_TEAM === "string" && priceId === process.env.STRIPE_PRICE_TEAM) return 5;
  return 1;
}

/** Get plan interval from subscription (monthly/yearly). */
function getPlanInterval(sub: Stripe.Subscription): string {
  const item = sub.items?.data?.[0];
  const interval = item?.price?.recurring?.interval;
  return interval === "year" ? "yearly" : "monthly";
}

/** Ensure a license exists for account and update it from subscription; re-sign and persist. */
async function applySubscriptionToLicense(
  accountId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId = subscription.customer as string;
  const status = subscription.status;
  const currentPeriodEnd = subscription.current_period_end;
  const { state, expiresAt, graceEndsAt, renewalAt } = subscriptionStatusToState(status, currentPeriodEnd);
  const deviceLimit = getDeviceLimitFromSubscription(subscription);
  const planInterval = getPlanInterval(subscription);

  await storage.updateAccountSubscription(accountId, {
    subscriptionId: subscription.id,
    subscriptionStatus: status,
    renewalAt: new Date(subscription.current_period_end * 1000).toISOString(),
    graceEndsAt: graceEndsAt ? new Date(graceEndsAt * 1000).toISOString() : null,
  });

  let license = await storage.getActiveLicenseForAccount(accountId);
  const now = Math.floor(Date.now() / 1000);
  const licenseId = license?.id ?? `LIC-${Date.now()}-${subscription.id.slice(-8)}`;
  const issuedAt = license?.issuedAt ?? now;

  const payload = {
    license_id: licenseId,
    account_id: accountId,
    tier: subscription.metadata?.tier ?? "pro",
    device_limit: deviceLimit,
    issued_at: issuedAt,
    expires_at: expiresAt,
    state,
    grace_ends_at: graceEndsAt ?? undefined,
    features: { smart_workspaces: true, activity_feed: true },
  };
  const signature = signLicense(payload);

  if (!license) {
    await storage.createLicense({
      id: licenseId,
      accountId,
      tier: payload.tier,
      deviceLimit,
      issuedAt,
      expiresAt,
      state,
      signature,
      planInterval,
      graceEndsAt: graceEndsAt ?? undefined,
      renewalAt,
    });
  } else {
    await storage.updateLicense(licenseId, {
      state,
      expiresAt,
      signature,
      planInterval,
      graceEndsAt: graceEndsAt ?? null,
      renewalAt,
      deviceLimit,
      tier: payload.tier,
    });
  }
}

/** Handle Stripe webhook event; returns true if handled. */
export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (!customerId) break;
      const account = await storage.getAccountByStripeCustomerId(customerId);
      if (!account) {
        console.warn("Stripe webhook: no account for customer", customerId);
        break;
      }
      await applySubscriptionToLicense(account.id, sub);
      console.log("Stripe webhook: subscription updated", { subscriptionId: sub.id, accountId: account.id });
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.subscription as string | null;
      if (!subId) break;
      const account = await storage.getAccountBySubscriptionId(subId);
      if (!account) break;
      const license = await storage.getActiveLicenseForAccount(account.id);
      if (!license) break;
      const payload = {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: license.expiresAt,
        state: "active",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.updateLicense(license.id, { state: "active", signature });
      console.log("Stripe webhook: payment succeeded, license renewed", { licenseId: license.id });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.subscription as string | null;
      if (!subId) break;
      const account = await storage.getAccountBySubscriptionId(subId);
      if (!account) break;
      const license = await storage.getActiveLicenseForAccount(account.id);
      if (!license) break;
      const now = Math.floor(Date.now() / 1000);
      const graceEndsAt = now + GRACE_DAYS * 24 * 3600;
      const payload = {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: license.expiresAt,
        state: "grace",
        grace_ends_at: graceEndsAt,
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.updateLicense(license.id, { state: "grace", signature, graceEndsAt });
      await storage.updateAccountSubscription(license.accountId, {
        graceEndsAt: new Date(graceEndsAt * 1000).toISOString(),
      });
      console.log("Stripe webhook: payment failed, license in grace", { licenseId: license.id });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (!customerId) break;
      const account = await storage.getAccountByStripeCustomerId(customerId);
      if (!account) break;
      const license = await storage.getLatestLicenseForAccount(account.id);
      if (!license) break;
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: now,
        state: "expired",
        features: { smart_workspaces: true, activity_feed: true },
      };
      const signature = signLicense(payload);
      await storage.updateLicense(license.id, { state: "expired", expiresAt: now, signature, graceEndsAt: null, renewalAt: null });
      console.log("Stripe webhook: subscription deleted, license expired", { licenseId: license.id });
      break;
    }
    default:
      break;
  }
}
