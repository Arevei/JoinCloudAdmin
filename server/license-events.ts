import { EventEmitter } from "events";
import type { License } from "./storage";

export interface LicenseUpdatedEvent {
  licenseId: string;
  accountId: string;
  state: string;
  tier: string;
  expiresAt: number | null;
}

export const licenseEvents = new EventEmitter();

export function emitLicenseUpdated(license: Pick<License, "id" | "accountId" | "state" | "tier" | "expiresAt">): void {
  const payload: LicenseUpdatedEvent = {
    licenseId: license.id,
    accountId: license.accountId,
    state: license.state,
    tier: license.tier,
    expiresAt: license.expiresAt ?? null,
  };
  licenseEvents.emit("license.updated", payload);
}

