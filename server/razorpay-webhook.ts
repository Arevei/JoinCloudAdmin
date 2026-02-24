import crypto from "crypto";
import { storage } from "./storage";
import { signLicense } from "./license-sign";

const GRACE_DAYS = 7;

/** Verify Razorpay webhook signature. Returns true if valid. */
export function verifyRazorpaySignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** Map Razorpay subscription status to license state. */
function razorpayStatusToLicenseState(status: string): {
  state: string;
  graceEndsAt: number | null;
} {
  const now = Math.floor(Date.now() / 1000);
  switch (status) {
    case "created":
    case "authenticated":
    case "active":
      return { state: "active", graceEndsAt: null };
    case "pending":
      return { state: "grace", graceEndsAt: now + GRACE_DAYS * 24 * 3600 };
    case "halted":
    case "cancelled":
    case "completed":
    case "expired":
      return { state: "expired", graceEndsAt: null };
    default:
      return { state: "active", graceEndsAt: null };
  }
}

/** Get device limit from Razorpay subscription notes/metadata. */
function getDeviceLimit(notes: Record<string, string> | null | undefined, plan: string | null): number {
  if (notes?.device_limit) return Math.max(1, parseInt(notes.device_limit, 10) || 1);
  if (plan?.toLowerCase().includes("team")) return 5;
  return parseInt(process.env.JOINCLOUD_PRO_DEVICE_LIMIT || "30", 10);
}

/** Get plan interval from Razorpay subscription. */
function getPlanInterval(sub: any): string {
  const period = sub?.plan_id?.period || sub?.period;
  if (period === "yearly" || period === "year") return "yearly";
  return "monthly";
}

/** Apply a Razorpay subscription to a license (create or update). */
async function applySubscriptionToLicense(
  accountId: string,
  sub: any,
  statusOverride?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const status = statusOverride ?? sub.status;
  const { state, graceEndsAt } = razorpayStatusToLicenseState(status);
  const expiresAt = sub.end_at ?? sub.charge_at ?? now + 30 * 24 * 3600;
  const renewalAt = sub.charge_at ?? expiresAt;
  const deviceLimit = getDeviceLimit(sub.notes, sub.plan_id);
  const planInterval = getPlanInterval(sub);

  await storage.updateAccountRazorpay(accountId, {
    razorpaySubscriptionId: sub.id,
    subscriptionStatus: status,
    renewalAt: new Date(renewalAt * 1000).toISOString(),
    graceEndsAt: graceEndsAt ? new Date(graceEndsAt * 1000).toISOString() : null,
  });

  let license = await storage.getActiveLicenseForAccount(accountId);
  const licenseId = license?.id ?? `LIC-${Date.now()}-${(sub.id || "rp").slice(-8)}`;
  const issuedAt = license?.issuedAt ?? now;
  const tier = sub.notes?.tier ?? "pro";

  const payload = {
    license_id: licenseId,
    account_id: accountId,
    tier,
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
      tier,
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
      tier,
    });
  }
}

/** Handle a Razorpay webhook event payload. */
export async function handleRazorpayWebhook(event: any): Promise<void> {
  const entity = event.payload?.subscription?.entity ?? event.payload?.payment?.entity ?? {};
  const subscriptionId: string | null = entity.subscription_id ?? entity.id ?? null;
  const notes: Record<string, string> | null = entity.notes ?? null;

  switch (event.event) {
    case "subscription.activated":
    case "subscription.charged": {
      const sub = event.payload?.subscription?.entity;
      if (!sub) break;
      const accountId = sub.notes?.account_id ?? sub.id;
      const account = sub.notes?.account_id
        ? await storage.getAccountById(sub.notes.account_id)
        : await storage.getAccountByRazorpaySubscriptionId(sub.id);
      if (!account) {
        console.warn("Razorpay webhook: no account for subscription", sub.id);
        break;
      }
      await applySubscriptionToLicense(account.id, sub, "active");
      console.log("Razorpay webhook: subscription activated/charged", { subscriptionId: sub.id, accountId: account.id });
      break;
    }

    case "subscription.pending": {
      const sub = event.payload?.subscription?.entity;
      if (!sub) break;
      const account = sub.notes?.account_id
        ? await storage.getAccountById(sub.notes.account_id)
        : await storage.getAccountByRazorpaySubscriptionId(sub.id);
      if (!account) break;
      await applySubscriptionToLicense(account.id, sub, "pending");
      const now = Math.floor(Date.now() / 1000);
      const license = await storage.getActiveLicenseForAccount(account.id);
      if (license) {
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
        await storage.updateAccountRazorpay(license.accountId, {
          graceEndsAt: new Date(graceEndsAt * 1000).toISOString(),
        });
      }
      console.log("Razorpay webhook: payment pending/failed, license in grace", { subscriptionId: sub.id });
      break;
    }

    case "subscription.halted":
    case "subscription.cancelled":
    case "subscription.completed": {
      const sub = event.payload?.subscription?.entity;
      if (!sub) break;
      const account = sub.notes?.account_id
        ? await storage.getAccountById(sub.notes.account_id)
        : await storage.getAccountByRazorpaySubscriptionId(sub.id);
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
      console.log("Razorpay webhook: subscription ended, license expired", { subscriptionId: sub.id });
      break;
    }

    case "payment.captured": {
      const payment = event.payload?.payment?.entity;
      if (!payment) break;
      const subId = payment.subscription_id ?? notes?.subscription_id;
      if (!subId) break;
      const account = await storage.getAccountByRazorpaySubscriptionId(subId);
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
      console.log("Razorpay webhook: payment captured, license renewed", { licenseId: license.id });
      break;
    }

    default:
      break;
  }
}
