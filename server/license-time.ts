export type LicenseTimeMode = "dev" | "production";

/**
 * Centralized time abstraction for all license and subscription timing.
 *
 * - production: 1 logical day = 86400 seconds
 * - dev:        1 logical day = 60 seconds
 *
 * Mode is controlled primarily via LICENSE_TIME_MODE=dev|production.
 * For backwards compatibility, DEV_MODE=true is treated as dev mode
 * when LICENSE_TIME_MODE is not explicitly set.
 */
export function getLicenseTimeMode(): LicenseTimeMode {
  const raw = (process.env.LICENSE_TIME_MODE || "").toLowerCase().trim();
  if (raw === "dev" || raw === "development") return "dev";
  if (raw === "prod" || raw === "production") return "production";

  // Backwards compatibility with existing DEV_MODE flag
  if (process.env.DEV_MODE === "true") return "dev";

  return "production";
}

/** Returns the number of seconds that correspond to a single logical \"day\" unit. */
export function getTimeUnitSeconds(): number {
  const mode = getLicenseTimeMode();
  return mode === "dev" ? 60 : 86400;
}

/** Convert a number of logical \"day\" units into seconds using the current mode. */
export function secondsFromDayUnits(dayCount: number): number {
  const safeDays = Number.isFinite(dayCount) && dayCount > 0 ? dayCount : 0;
  return safeDays * getTimeUnitSeconds();
}

/**
 * Compute remaining time until a Unix-epoch expiry timestamp (seconds) in milliseconds.
 * Returns 0 when the expiry is in the past.
 */
export function remainingMillisUntil(expiryUnixSeconds: number | null | undefined): number {
  if (!expiryUnixSeconds || !Number.isFinite(expiryUnixSeconds)) return 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const remainingSeconds = Math.max(0, expiryUnixSeconds - nowSeconds);
  return remainingSeconds * 1000;
}

