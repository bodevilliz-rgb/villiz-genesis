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
  /** Which client organisation owns this account. Null means the row pre-dates org scoping or was stored via a platform-wide Test Connection without an org context — such rows are blocked from driving a real publish until backfilled. */
  organisationId: string | null;
  firstConnectedAt: string;
  lastVerifiedAt: string;
}

/**
 * Blotato's platform vocabulary is broader than this app's own
 * PublishingPlatform union (it also covers TikTok, Pinterest, Threads,
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
};

const PUBLISHING_PLATFORM_TO_BLOTATO: Record<PublishingPlatform, string> = {
  x: "twitter",
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
};

/** Null when Blotato reports a platform this app does not yet publish through (TikTok, Pinterest, ...). */
export function mapBlotatoPlatform(blotatoPlatform: string): PublishingPlatform | null {
  return BLOTATO_TO_PUBLISHING_PLATFORM[blotatoPlatform] ?? null;
}

export function toBlotatoPlatform(platform: PublishingPlatform): string {
  return PUBLISHING_PLATFORM_TO_BLOTATO[platform];
}

/** Every account whose Blotato platform maps onto one of this app's 4 supported platforms. */
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
  /** The subset of this app's own 4 platforms that have at least one connected account. */
  supportedPlatforms: PublishingPlatform[];
  /** Populated only when reachable is false. */
  error: string | null;
}
