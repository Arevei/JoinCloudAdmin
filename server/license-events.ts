import { EventEmitter } from "events";
import type { License } from "./storage";
import { emitToDevice, emitToAdmins } from "./socket";
import { storage } from "./storage";

export interface LicenseUpdatedEvent {
  licenseId: string;
  accountId: string;
  state: string;
  tier: string;
  expiresAt: number | null;
}

export const licenseEvents = new EventEmitter();

export function emitLicenseUpdated(
  license: Pick<License, "id" | "accountId" | "state" | "tier" | "expiresAt"> & {
    deviceLimit?: number | null;
    shareLimitMonthly?: number | null;
  },
): void {
  const payload: LicenseUpdatedEvent = {
    licenseId: license.id,
    accountId: license.accountId,
    state: license.state,
    tier: license.tier,
    expiresAt: license.expiresAt ?? null,
  };

  // Existing event emitter (keeps any existing internal listeners working)
  licenseEvents.emit("license.updated", payload);

  // Push real-time update to all devices linked to this license via Socket.IO
  (async () => {
    try {
      const rows = await storage.getHostsForLicense(license.id);
      const hostUuids = rows.map((r) => r.host_uuid);

      for (const hostUuid of hostUuids) {
        emitToDevice(hostUuid, "license:updated", {
          tier: license.tier,
          state: license.state,
          expiresAt: license.expiresAt ?? null,
          deviceLimit: license.deviceLimit ?? null,
          shareLimitMonthly: license.shareLimitMonthly ?? null,
        });
      }

      if (hostUuids.length > 0) {
        emitToAdmins("license:updated", {
          accountId: license.accountId,
          licenseId: license.id,
          tier: license.tier,
          state: license.state,
          affectedHosts: hostUuids,
        });
      }
    } catch (err) {
      console.error("[license-events] socket push error:", err);
    }
  })();
}
