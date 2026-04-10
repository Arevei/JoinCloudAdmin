import { storage, type License } from "./storage";
import { signLicense } from "./license-sign";
import { emitLicenseUpdated } from "./license-events";
import { TIER_DEFAULTS } from "./entitlements";

/** Free tier has no expiration; use far-future Unix timestamp (year 2038 safe). */
const FREE_TIER_NO_EXPIRY = 2147483647;

interface LicenseExpirySweepResult {
  processed: number;
  markedExpired: number;
  errors: string[];
}

function isTerminalState(state: string | null | undefined): boolean {
  const normalized = String(state || "").toLowerCase();
  return normalized === "expired" || normalized === "revoked" || normalized === "suspended";
}

export async function runLicenseExpirySweep(): Promise<LicenseExpirySweepResult> {
  const result: LicenseExpirySweepResult = {
    processed: 0,
    markedExpired: 0,
    errors: [],
  };

  try {
    const now = Math.floor(Date.now() / 1000);
    const licenses = await storage.listLicensesWithHostCounts();

    for (const license of licenses) {
      result.processed += 1;

      try {
        // Free tier has no expiry; cron does not apply
        if (String(license.tier || "").toUpperCase() === "FREE") {
          continue;
        }
        if (!license.expiresAt || license.expiresAt > now) {
          continue;
        }
        if (isTerminalState(license.state)) {
          continue;
        }

        const freeTier = "FREE";
        const freeDeviceLimit = 1;
        const signature = signLicense({
          license_id: license.id,
          account_id: license.accountId,
          tier: freeTier,
          device_limit: freeDeviceLimit,
          issued_at: license.issuedAt,
          expires_at: FREE_TIER_NO_EXPIRY,
          state: "active",
        });

        await storage.updateLicense(license.id, {
          state: "active",
          tier: freeTier,
          deviceLimit: freeDeviceLimit,
          signature,
          graceEndsAt: null,
          expiresAt: FREE_TIER_NO_EXPIRY,
          renewalAt: now,
          customQuota: null,
        });
        try { await storage.updateLicenseOverridesJson(license.id, "{}"); } catch (_) {}

        emitLicenseUpdated({
          id: license.id,
          accountId: license.accountId,
          state: "active",
          tier: freeTier,
          expiresAt: FREE_TIER_NO_EXPIRY,
          deviceLimit: freeDeviceLimit,
          shareLimitMonthly: TIER_DEFAULTS.FREE.shareLimitMonthly,
        });

        result.markedExpired += 1;
      } catch (err) {
        const msg = `license-expiry-cron: failed to process license ${license.id}: ${err}`;
        // eslint-disable-next-line no-console
        console.error(msg);
        result.errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `license-expiry-cron: sweep failed: ${err}`;
    // eslint-disable-next-line no-console
    console.error(msg);
    result.errors.push(msg);
  }

  return result;
}

/**
 * Start the nightly license-expiry sweep.
 * Runs once on startup (to catch any licenses that expired while the server was down),
 * then schedules itself to run every night at midnight.
 */
export function startLicenseExpiryCron(): void {
  console.log("[license-expiry-cron] Starting — will run at midnight daily");

  // Run once immediately on startup
  runLicenseExpirySweep()
    .then((result) => {
      if (result.markedExpired > 0) {
        console.log(
          `[license-expiry-cron] startup sweep: ${result.markedExpired} licenses downgraded to free out of ${result.processed}`,
        );
      }
    })
    .catch((err) => {
      console.error("[license-expiry-cron] startup sweep error:", err);
    });

  // Schedule daily at midnight
  function scheduleNextMidnight() {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();

    setTimeout(() => {
      runLicenseExpirySweep()
        .then((result) => {
          console.log(
            `[license-expiry-cron] midnight sweep: ${result.markedExpired} licenses downgraded to free out of ${result.processed}`,
          );
        })
        .catch((err) => {
          console.error("[license-expiry-cron] midnight sweep error:", err);
        })
        .finally(() => {
          scheduleNextMidnight(); // reschedule for next midnight
        });
    }, msUntilMidnight);

    const h = Math.floor(msUntilMidnight / 3600000);
    const m = Math.floor((msUntilMidnight % 3600000) / 60000);
    console.log(`[license-expiry-cron] next sweep in ${h}h ${m}m`);
  }

  scheduleNextMidnight();
}

