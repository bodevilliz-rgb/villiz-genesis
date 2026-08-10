import { PUBLISHING_PLATFORMS, type PublishingPlatform } from "./publishing";

/**
 * Blotato — the real social-publishing provider behind Sprint 6B. This file
 * knows nothing about HTTP or Supabase; see
 * core/application/ports/blotato-client-port.ts (the external API) and
 * core/application/ports/blotato-account-port.ts (the storage) for those.
 */

/** One social account as Blotato itself reports it — before any mapping onto this app's own PublishingPlatform union. */
export interface BlotatoAccountSummary {
  /** Blotato's own account id — the value later passed as `accountId` in a publish request. */
  id: string;
  /** Blotato's platform string (e.g. "twitter", not "x" — see mapBlotatoPlatform). */
  platform: string;
  fullname: string | null;
  username: string | null;
}

/** A BlotatoAccountSummary persisted to `blotato_accounts`, with bookkeeping timestamps. */
export interface BlotatoAccount extends BlotatoAccountSummary {
  /** Which client organisation owns this account. Null = unassigned (available for assignment if providerActive). */
  organisationId: string | null;
  /**
   * Genesis mapping status. True when the account is assigned to an org and actively used for
   * publishing. Set false by removeFromOrganisation; reset true by assignToOrganisation.
   * Irrelevant for unassigned accounts (organisationId = null) — use providerActive instead
   * to determine whether an unassigned account is available for assignment.
   */
  active: boolean;
  /**
   * Provider availability. True when Blotato's listAccounts returned this account in the most
   * recent sync. Set true for every account returned by upsertAccounts; set false for accounts
   * NOT in the batch (sweep). A false row is excluded from assignment and publishing but kept
   * for history and automatically recovers if the provider reports the account again.
   */
  providerActive: boolean;
  firstConnectedAt: string;
  lastVerifiedAt: string;
}

/**
 * Blotato's platform vocabulary is broader than this app's own
 * PublishingPlatform union (it also covers Pinterest, Threads,
 * Bluesky, YouTube, webhook, and a catch-all "other") and it spells X
 * "twitter", not "x". Every account this app cannot yet publish through
 * still gets stored (see BlotatoAccount above) — it just can't be resolved
 * by BlotatoPublisherBase for an actual publish.
 */
const BLOTATO_TO_PUBLISHING_PLATFORM: Record<string, PublishingPlatform> = {
  twitter: "x",
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
};

const PUBLISHING_PLATFORM_TO_BLOTATO: Record<PublishingPlatform, string> = {
  x: "twitter",
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
};

/** Null when Blotato reports a platform this app does not yet publish through (Pinterest, Threads, ...). */
export function mapBlotatoPlatform(blotatoPlatform: string): PublishingPlatform | null {
  return BLOTATO_TO_PUBLISHING_PLATFORM[blotatoPlatform] ?? null;
}

export function toBlotatoPlatform(platform: PublishingPlatform): string {
  return PUBLISHING_PLATFORM_TO_BLOTATO[platform];
}

/** Every account whose Blotato platform maps onto one of this app's supported platforms. */
export function supportedBlotatoAccounts(accounts: BlotatoAccountSummary[]): BlotatoAccountSummary[] {
  return accounts.filter((account) => mapBlotatoPlatform(account.platform) !== null);
}

/** The distinct PublishingPlatforms this workspace actually has a connected Blotato account for, in this app's own canonical order. */
export function supportedPlatformsFromAccounts(accounts: BlotatoAccountSummary[]): PublishingPlatform[] {
  const mapped = new Set(
    accounts.map((account) => mapBlotatoPlatform(account.platform)).filter((p): p is PublishingPlatform => p !== null),
  );
  return PUBLISHING_PLATFORMS.filter((platform) => mapped.has(platform));
}

export interface BlotatoConnectionTestResult {
  reachable: boolean;
  /** Every account Blotato reports, including platforms this app cannot yet publish through. */
  accounts: BlotatoAccount[];
  /** The subset of this app's own supported platforms that have at least one connected account. */
  supportedPlatforms: PublishingPlatform[];
  /** Populated only when reachable is false. */
  error: string | null;
}
