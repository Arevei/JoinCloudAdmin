import { storage, type License } from "./storage";
import { signLicense } from "./license-sign";
import { emitLicenseUpdated } from "./license-events";

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
 * Start periodic sweep that downgrades expired licenses to Free plan (state active, no expiry).
 *
 * Runs once on startup and then every 60 seconds.
 */
export function startLicenseExpiryCron(): void {
  // eslint-disable-next-line no-console
  console.log("[license-expiry-cron] Starting license expiry sweep (every 60s)");

  runLicenseExpirySweep()
    .then((result) => {
      if (result.markedExpired > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[license-expiry-cron] initial sweep: ${result.markedExpired} licenses downgraded to free out of ${result.processed}`,
        );
      }
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[license-expiry-cron] initial sweep error:", err);
    });

  setInterval(async () => {
    try {
      const result = await runLicenseExpirySweep();
      if (result.markedExpired > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[license-expiry-cron] sweep: ${result.markedExpired} licenses downgraded to free out of ${result.processed}`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[license-expiry-cron] periodic sweep error:", err);
    }
  }, 60 * 1000);
}

