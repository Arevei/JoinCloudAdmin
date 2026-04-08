/**
 * Entitlements schema and tier defaults — single source of truth for Control Plane.
 * Desktop consumes normalized response from API; offline fallback uses same defaults.
 */

export type LicenseState = "TRIAL" | "FREE" | "ACTIVE" | "EXPIRED";
export type Tier = "FREE" | "PRO" | "PRO_PLUS" | "TEAMS" | "CUSTOM";

export interface Entitlements {
  teamEnabled: boolean;
  maxTeams: number | null;
  maxUsers: number | null;
  maxDevicesPerUser: number | null;
  maxDevicesTotal: number | null;
  shareLimitMonthly: number | null;
  fileSizeLimitMb: number | null;       // null = unlimited
  linkExpiryMaxDays: number | null;     // max TTL in days a user can set; null = unlimited
  resumableDownloads: boolean;          // P4 resumable download feature
  cdnCache: boolean;                    // R2 CDN cache (P3)
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
    maxDevicesTotal: 1,
    shareLimitMonthly: 5,
    fileSizeLimitMb: 2048,             // 2 GB
    linkExpiryMaxDays: 1,              // max 24 hours
    resumableDownloads: false,
    cdnCache: false,
    peerChatEnabled: true,
    canExtendTrial: true,
    uiTeasers: { showTeamsMenu: false, teamsLocked: true },
  },
  PRO: {
    teamEnabled: false,
    maxTeams: 0,
    maxUsers: 1,
    maxDevicesPerUser: 3,
    maxDevicesTotal: 3,
    shareLimitMonthly: 50,
    fileSizeLimitMb: 20480,            // 20 GB
    linkExpiryMaxDays: 30,
    resumableDownloads: true,
    cdnCache: true,
    peerChatEnabled: true,
    canExtendTrial: false,
    uiTeasers: { showTeamsMenu: false, teamsLocked: true },
  },
  PRO_PLUS: {
    teamEnabled: true,
    maxTeams: 1,
    maxUsers: 5,
    maxDevicesPerUser: 5,
    maxDevicesTotal: 25,
    shareLimitMonthly: null,           // unlimited
    fileSizeLimitMb: null,             // unlimited
    linkExpiryMaxDays: 90,
    resumableDownloads: true,
    cdnCache: true,
    peerChatEnabled: true,
    canExtendTrial: false,
    uiTeasers: { showTeamsMenu: true, teamsLocked: false },
  },
  TEAMS: {
    teamEnabled: true,
    maxTeams: 3,
    maxUsers: 3,
    maxDevicesPerUser: 3,
    maxDevicesTotal: 9,
    shareLimitMonthly: 100,
    fileSizeLimitMb: null,
    linkExpiryMaxDays: 90,
    resumableDownloads: true,
    cdnCache: true,
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
    fileSizeLimitMb: null,
    linkExpiryMaxDays: 365,
    resumableDownloads: true,
    cdnCache: true,
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
  fileSizeLimitMb?: number | null;
  linkExpiryMaxDays?: number | null;
  resumableDownloads?: boolean;
  cdnCache?: boolean;
}

/** Resolve entitlements by license state. TRIAL = pro-like access for 14 days; ACTIVE = tier limits; EXPIRED/FREE = restricted. */
export function resolveEntitlementsByState(
  licenseState: string,
  tier: string,
  trialEndsAt: string | null,
  canExtendTrial: boolean
): Entitlements {
  const normalized = String(licenseState || "").toUpperCase().replace(/-/g, "_");
  if (normalized === "TRIAL" || normalized === "TRIAL_ACTIVE") {
    return {
      teamEnabled: false,
      maxTeams: 0,
      maxUsers: 1,
      maxDevicesPerUser: 3,
      maxDevicesTotal: 3,
      shareLimitMonthly: 20,
      fileSizeLimitMb: 20480,          // 20 GB during trial
      linkExpiryMaxDays: 7,
      resumableDownloads: true,
      cdnCache: false,
      peerChatEnabled: true,
      canExtendTrial,
      uiTeasers: { showTeamsMenu: false, teamsLocked: true },
    };
  }
  if (normalized === "EXPIRED" || normalized === "FREE" || normalized === "UNREGISTERED") {
    return {
      ...TIER_DEFAULTS.FREE,
      canExtendTrial,
      uiTeasers: { showTeamsMenu: false, teamsLocked: true },
    };
  }
  const tierKey = (tier || "free").toUpperCase() as Tier;
  const base = TIER_DEFAULTS[tierKey] ?? TIER_DEFAULTS.FREE;
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
  if ("fileSizeLimitMb" in overrides) base.fileSizeLimitMb = overrides.fileSizeLimitMb ?? null;
  if ("linkExpiryMaxDays" in overrides) base.linkExpiryMaxDays = overrides.linkExpiryMaxDays ?? null;
  if (overrides.resumableDownloads != null) base.resumableDownloads = overrides.resumableDownloads;
  if (overrides.cdnCache != null) base.cdnCache = overrides.cdnCache;

  return base;
}
