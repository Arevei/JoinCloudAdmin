import { storage } from "./storage";
import { signLicense } from "./license-sign";
import { secondsFromDayUnits } from "./license-time";

const GRACE_PERIOD_DAYS = 7;

interface SubscriptionCheckResult {
  processed: number;
  suspended: number;
  graceStarted: number;
  errors: string[];
}

/**
 * Check all subscriptions and handle payment due logic:
 * - Payment due on 2nd of each month
 * - 7-day grace period (2nd - 9th)
 * - After grace: Suspend account
 */
export async function runSubscriptionCheck(): Promise<SubscriptionCheckResult> {
  const result: SubscriptionCheckResult = {
    processed: 0,
    suspended: 0,
    graceStarted: 0,
    errors: [],
  };

  try {
    const now = Math.floor(Date.now() / 1000);
    const subscriptions = await storage.listSubscriptions();

    for (const subscription of subscriptions) {
      result.processed++;

      try {
        // Skip if already suspended or cancelled
        if (subscription.status === "suspended" || subscription.status === "cancelled") {
          continue;
        }

        // Check if payment is past due
        if (subscription.paymentDueDate && subscription.paymentDueDate < now) {
          // Check grace period
          if (subscription.graceEndsAt) {
            if (subscription.graceEndsAt < now) {
              // Grace period expired - suspend
              await suspendSubscription(subscription.id, subscription.accountId, subscription.licenseId);
              result.suspended++;
            }
            // Still in grace period - already marked as past_due
          } else {
            // Start grace period
            const graceEndsAt = now + secondsFromDayUnits(GRACE_PERIOD_DAYS);
            await storage.updateSubscription(subscription.id, {
              status: "past_due",
              graceEndsAt,
            });

            // Update license to grace state
            if (subscription.licenseId) {
              const license = await storage.getLicenseById(subscription.licenseId);
              if (license) {
                const newSignature = signLicense({
                  license_id: license.id,
                  account_id: license.accountId,
                  tier: license.tier,
                  device_limit: license.deviceLimit,
                  issued_at: license.issuedAt,
                  expires_at: license.expiresAt,
                  state: "grace",
                });
                await storage.updateLicense(subscription.licenseId, {
                  state: "grace",
                  graceEndsAt,
                  signature: newSignature,
                });
              }
            }

            result.graceStarted++;
            console.log(`Subscription ${subscription.id} entered grace period until ${new Date(graceEndsAt * 1000).toISOString()}`);
          }
        }
      } catch (subErr) {
        const errMsg = `Error processing subscription ${subscription.id}: ${subErr}`;
        result.errors.push(errMsg);
        console.error(errMsg);
      }
    }
  } catch (err) {
    const errMsg = `Subscription check failed: ${err}`;
    result.errors.push(errMsg);
    console.error(errMsg);
  }

  return result;
}

/**
 * Suspend a subscription and all associated resources
 */
async function suspendSubscription(
  subscriptionId: string,
  accountId: string,
  licenseId: string | null
): Promise<void> {
  // Update subscription status
  await storage.updateSubscription(subscriptionId, {
    status: "suspended",
  });

  // Update license state
  if (licenseId) {
    const license = await storage.getLicenseById(licenseId);
    if (license) {
      const newSignature = signLicense({
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: license.expiresAt,
        state: "suspended",
      });
      await storage.updateLicense(licenseId, {
        state: "suspended",
        signature: newSignature,
      });

      // Suspend all hosts linked to this license
      const hosts = await storage.getHostsForLicense(licenseId);
      for (const host of hosts) {
        await storage.suspendHost(host.host_uuid, "payment_failed");
      }
    }
  }

  console.log(`Subscription ${subscriptionId} suspended due to payment failure`);
}

/**
 * Unsuspend a subscription after payment is resolved
 */
export async function unsuspendSubscription(
  subscriptionId: string,
  newPeriodEnd: number
): Promise<void> {
  const subscription = await storage.getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new Error("Subscription not found");
  }

  // Calculate next payment due date (2nd of next month)
  const nextMonth = new Date(newPeriodEnd * 1000);
  nextMonth.setDate(2);
  const paymentDueDate = Math.floor(nextMonth.getTime() / 1000);

  // Update subscription
  await storage.updateSubscription(subscriptionId, {
    status: "active",
    currentPeriodEnd: newPeriodEnd,
    paymentDueDate,
    graceEndsAt: undefined,
  });

  // Update license
  if (subscription.licenseId) {
    const license = await storage.getLicenseById(subscription.licenseId);
    if (license) {
      const newSignature = signLicense({
        license_id: license.id,
        account_id: license.accountId,
        tier: license.tier,
        device_limit: license.deviceLimit,
        issued_at: license.issuedAt,
        expires_at: newPeriodEnd,
        state: "active",
      });
      await storage.updateLicense(subscription.licenseId, {
        state: "active",
        expiresAt: newPeriodEnd,
        graceEndsAt: null,
        signature: newSignature,
      });

      // Unsuspend all hosts
      const hosts = await storage.getHostsForLicense(subscription.licenseId);
      for (const host of hosts) {
        await storage.unsuspendHost(host.host_uuid);
      }
    }
  }

  console.log(`Subscription ${subscriptionId} unsuspended after payment`);
}

/**
 * Handle successful payment from webhook
 */
export async function handlePaymentSuccess(
  subscriptionId: string,
  paymentId: string,
  amount: number,
  currency: string,
  provider: string,
  providerPaymentId: string,
  invoiceUrl?: string
): Promise<void> {
  const subscription = await storage.getSubscriptionById(subscriptionId);
  if (!subscription) {
    console.error(`Subscription ${subscriptionId} not found for payment`);
    return;
  }

  // Record the payment
  await storage.createPayment({
    id: paymentId,
    subscriptionId,
    accountId: subscription.accountId,
    deviceId: null,
    provider,
    providerPaymentId,
    amount,
    currency,
    status: "captured",
    invoiceUrl: invoiceUrl || null,
  });

  // If subscription was suspended or past_due, unsuspend it
  if (subscription.status === "suspended" || subscription.status === "past_due") {
    const now = Math.floor(Date.now() / 1000);
    const newPeriodEnd = subscription.interval === "year"
      ? now + secondsFromDayUnits(365)
      : now + secondsFromDayUnits(30);
    
    await unsuspendSubscription(subscriptionId, newPeriodEnd);
  } else {
    // Update period end for active subscription
    const now = Math.floor(Date.now() / 1000);
    const newPeriodEnd = subscription.interval === "year"
      ? now + secondsFromDayUnits(365)
      : now + secondsFromDayUnits(30);
    
    const nextMonth = new Date(newPeriodEnd * 1000);
    nextMonth.setDate(2);
    const paymentDueDate = Math.floor(nextMonth.getTime() / 1000);

    await storage.updateSubscription(subscriptionId, {
      currentPeriodEnd: newPeriodEnd,
      paymentDueDate,
    });

    // Update license expiry
    if (subscription.licenseId) {
      const license = await storage.getLicenseById(subscription.licenseId);
      if (license) {
        const newSignature = signLicense({
          license_id: license.id,
          account_id: license.accountId,
          tier: license.tier,
          device_limit: license.deviceLimit,
          issued_at: license.issuedAt,
          expires_at: newPeriodEnd,
          state: license.state,
        });
        await storage.updateLicense(subscription.licenseId, {
          expiresAt: newPeriodEnd,
          renewalAt: newPeriodEnd,
          signature: newSignature,
        });
      }
    }
  }

  console.log(`Payment ${paymentId} processed for subscription ${subscriptionId}`);
}

/**
 * Handle failed payment from webhook
 */
export async function handlePaymentFailed(
  subscriptionId: string,
  paymentId: string,
  amount: number,
  currency: string,
  provider: string,
  providerPaymentId: string
): Promise<void> {
  const subscription = await storage.getSubscriptionById(subscriptionId);
  if (!subscription) {
    console.error(`Subscription ${subscriptionId} not found for failed payment`);
    return;
  }

  // Record the failed payment
  await storage.createPayment({
    id: paymentId,
    subscriptionId,
    accountId: subscription.accountId,
    deviceId: null,
    provider,
    providerPaymentId,
    amount,
    currency,
    status: "failed",
    invoiceUrl: null,
  });

  // If not already in grace/suspended, start grace period
  if (subscription.status === "active") {
    const now = Math.floor(Date.now() / 1000);
    const graceEndsAt = now + secondsFromDayUnits(GRACE_PERIOD_DAYS);

    await storage.updateSubscription(subscriptionId, {
      status: "past_due",
      graceEndsAt,
    });

    if (subscription.licenseId) {
      const license = await storage.getLicenseById(subscription.licenseId);
      if (license) {
        const newSignature = signLicense({
          license_id: license.id,
          account_id: license.accountId,
          tier: license.tier,
          device_limit: license.deviceLimit,
          issued_at: license.issuedAt,
          expires_at: license.expiresAt,
          state: "grace",
        });
        await storage.updateLicense(subscription.licenseId, {
          state: "grace",
          graceEndsAt,
          signature: newSignature,
        });
      }
    }
  }

  console.log(`Payment failed for subscription ${subscriptionId}`);
}

/**
 * Start the subscription check cron job
 * Runs every hour to check for past-due subscriptions
 */
export function startSubscriptionCron(): void {
  console.log("Starting subscription check cron job (hourly)");

  // Run immediately on startup
  runSubscriptionCheck()
    .then((result) => {
      console.log(`Initial subscription check: ${result.processed} processed, ${result.suspended} suspended, ${result.graceStarted} entered grace`);
    })
    .catch(console.error);

  // Run every hour
  setInterval(async () => {
    try {
      const result = await runSubscriptionCheck();
      if (result.suspended > 0 || result.graceStarted > 0) {
        console.log(`Subscription check: ${result.suspended} suspended, ${result.graceStarted} entered grace`);
      }
    } catch (err) {
      console.error("Subscription cron error:", err);
    }
  }, 60 * 60 * 1000); // 1 hour
}
