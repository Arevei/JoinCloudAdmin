/**
 * Entitlements schema and tier defaults — single source of truth for Control Plane.
 * Desktop consumes normalized response from API; offline fallback uses same defaults.
 */

export type LicenseState = "TRIAL" | "FREE" | "ACTIVE" | "EXPIRED";
export type Tier = "FREE" | "PRO" | "TEAMS" | "CUSTOM";

export interface Entitlements {
  teamEnabled: boolean;
  maxTeams: number | null;
  maxUsers: number | null;
  maxDevicesPerUser: number | null;
  maxDevicesTotal: number | null;
  shareLimitMonthly: number | null;
  peerChatEnabled: boolean;
  canExtendTrial: boolean;
  uiTeasers: {
    showTeamsMenu: boolean;
    teamsLocked: boolean;
  };
}

export interface EntitlementsResponse {
  licenseState: LicenseState;
  tier: Tier;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  entitlements: Entitlements;
}

/** Tier defaults per plan. CUSTOM merges with overrides. */
export const TIER_DEFAULTS: Record<Tier, Entitlements> = {
  FREE: {
    teamEnabled: false,
    maxTeams: 0,
    maxUsers: 1,
    maxDevicesPerUser: 1,
    maxDevicesTotal: 1,       // 1 device only on free tier
    shareLimitMonthly: 10,    // 10 shares/month
    peerChatEnabled: true,
    canExtendTrial: true,
    uiTeasers: { showTeamsMenu: false, teamsLocked: true },
  },
  PRO: {
    teamEnabled: false,
    maxTeams: 0,
    maxUsers: 1,
    maxDevicesPerUser: 3,
    maxDevicesTotal: 3,       // 3 devices on pro
    shareLimitMonthly: 50,    // 50 shares/month
    peerChatEnabled: true,
    canExtendTrial: false,
    uiTeasers: { showTeamsMenu: false, teamsLocked: true },
  },
  TEAMS: {
    teamEnabled: true,
    maxTeams: 3,              // up to 3 team spaces
    maxUsers: 3,              // up to 3 users
    maxDevicesPerUser: 3,     // 3 devices per user
    maxDevicesTotal: 9,       // 3 users × 3 devices
    shareLimitMonthly: 100,   // 100 shares/month per user
    peerChatEnabled: true,
    canExtendTrial: false,
    uiTeasers: { showTeamsMenu: true, teamsLocked: false },
  },
  CUSTOM: {
    teamEnabled: false,
    maxTeams: 0,
    maxUsers: 1,
    maxDevicesPerUser: 5,
    maxDevicesTotal: 5,
    shareLimitMonthly: 10,
    peerChatEnabled: true,
    canExtendTrial: false,
    uiTeasers: { showTeamsMenu: false, teamsLocked: true },
  },
};

export interface CustomOverrides {
  shareLimitMonthly?: number;
  maxUsers?: number;
  maxDevicesPerUser?: number;
  maxDevicesTotal?: number;
  maxTeams?: number;
  teamEnabled?: boolean;
}

/** Resolve entitlements by license state. TRIAL = full access; ACTIVE = tier limits; EXPIRED/FREE = restricted. */
export function resolveEntitlementsByState(
  licenseState: string,
  tier: string,
  trialEndsAt: string | null,
  canExtendTrial: boolean
): Entitlements {
  const normalized = String(licenseState || "").toUpperCase().replace(/-/g, "_");
  if (normalized === "TRIAL" || normalized === "TRIAL_ACTIVE") {
    return {
      teamEnabled: true,
      maxTeams: null,
      maxUsers: null,
      // Trial uses Pro-like usage/device limits while preserving trial UX flow.
      maxDevicesPerUser: 3,
      maxDevicesTotal: 3,
      shareLimitMonthly: 50,
      peerChatEnabled: true,
      canExtendTrial,
      uiTeasers: { showTeamsMenu: true, teamsLocked: false },
    };
  }
  if (normalized === "EXPIRED" || normalized === "FREE" || normalized === "UNREGISTERED") {
    return {
      ...TIER_DEFAULTS.FREE,
      canExtendTrial,
      uiTeasers: { showTeamsMenu: false, teamsLocked: true },
    };
  }
  const tierKey = (tier || "free").toLowerCase();
  const base = TIER_DEFAULTS[tierKey as Tier] ?? TIER_DEFAULTS.FREE;
  return { ...base, canExtendTrial };
}

/** Merge tier defaults with custom overrides (for CUSTOM tier). */
export function mergeEntitlements(
  tier: Tier,
  overrides?: CustomOverrides | null
): Entitlements {
  const base = { ...TIER_DEFAULTS[tier] };
  if (tier !== "CUSTOM" || !overrides) return base;

  if (overrides.shareLimitMonthly != null) base.shareLimitMonthly = overrides.shareLimitMonthly;
  if (overrides.maxUsers != null) base.maxUsers = overrides.maxUsers;
  if (overrides.maxDevicesPerUser != null) base.maxDevicesPerUser = overrides.maxDevicesPerUser;
  if (overrides.maxDevicesTotal != null) base.maxDevicesTotal = overrides.maxDevicesTotal;
  if (overrides.maxTeams != null) base.maxTeams = overrides.maxTeams;
  if (overrides.teamEnabled != null) base.teamEnabled = overrides.teamEnabled;
  if (overrides.teamEnabled === true) base.uiTeasers = { ...base.uiTeasers, teamsLocked: false };

  return base;
}
