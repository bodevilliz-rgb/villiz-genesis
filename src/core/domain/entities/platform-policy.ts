/**
 * Canonical, provider-verified per-platform publishing constraints — the
 * ONE place any layer (Pre-Publish Review, immediate/scheduled preflight,
 * worker execution, retry, Awo hashtag suggestion) consults before deciding
 * whether content may be submitted. No duplicated constants, no
 * regex-parsing the composed caption — hashtag limits are always evaluated
 * from the first-class `hashtags: string[]` field, normalized the same way
 * storage does (see normalizeHashtags), never from the final text.
 *
 * P0 root cause this exists to close: a scheduled Instagram job with 6
 * first-class hashtags passed Pre-Publish Review ("Hashtags: Optimal",
 * "Platform requirements met") and reached the worker, which submitted the
 * composed caption to Blotato and was rejected with a live 422 —
 * "Instagram allows a maximum of 5 hashtags per post." Nothing in Genesis,
 * anywhere, checked hashtag COUNT against a limit; the AI review only
 * checked presence (length > 0), and the deterministic preflight
 * (evaluatePlatformPreflight) had no hashtag awareness at all.
 *
 * Only verified, provider-proven limits are encoded here. A platform with
 * no verified limit gets `maxHashtags: undefined` — Genesis does not invent
 * unproven constraints; enforcement is simply skipped for that platform
 * until a real limit is confirmed the same way Instagram's was.
 */
import type { PublishingPlatform } from "./publishing";
import { PUBLISHING_PLATFORM_LABELS } from "./publishing";
import { normalizeHashtags } from "@/core/application/use-cases/content/hashtags";

export interface PlatformPublishingPolicy {
  platform: PublishingPlatform;
  /** Undefined = no verified upper bound for this platform yet. */
  maxHashtags?: number;
}

export const PLATFORM_PUBLISHING_POLICIES: Record<PublishingPlatform, PlatformPublishingPolicy> = {
  // Proven by a live Blotato 422 response: "Instagram allows a maximum of 5 hashtags per post."
  instagram: { platform: "instagram", maxHashtags: 5 },
  // No verified hashtag limit — Genesis has never observed a Facebook rejection for hashtag count.
  facebook: { platform: "facebook" },
  linkedin: { platform: "linkedin" },
  x: { platform: "x" },
};

export function getPlatformPublishingPolicy(platform: PublishingPlatform): PlatformPublishingPolicy {
  return PLATFORM_PUBLISHING_POLICIES[platform];
}

export interface HashtagPolicyResult {
  /** Normalized, deduplicated count — matches exactly what composePublishedText will actually send. */
  count: number;
  maxHashtags: number | undefined;
  exceeds: boolean;
  /** How many hashtags must be removed to comply. 0 when not exceeding. */
  excessCount: number;
}

/** Pure, deterministic — the one function every layer calls to know whether a hashtag list violates the platform's limit. */
export function evaluateHashtagPolicy(platform: PublishingPlatform, hashtags: string[]): HashtagPolicyResult {
  const normalized = normalizeHashtags(hashtags);
  const policy = getPlatformPublishingPolicy(platform);
  const exceeds = policy.maxHashtags !== undefined && normalized.length > policy.maxHashtags;
  const excessCount = exceeds ? normalized.length - (policy.maxHashtags as number) : 0;
  return { count: normalized.length, maxHashtags: policy.maxHashtags, exceeds, excessCount };
}

/** The exact operator-facing message for a hashtag-count violation — used by both Pre-Publish Review and the deterministic preflight blocker list, so the UI and the hard-block reason always agree word for word. */
export function hashtagPolicyViolationMessage(platform: PublishingPlatform, result: HashtagPolicyResult): string {
  const label = PUBLISHING_PLATFORM_LABELS[platform];
  const plural = result.excessCount === 1 ? "" : "s";
  return `${label} allows a maximum of ${result.maxHashtags} hashtags. Remove ${result.excessCount} hashtag${plural} before publishing.`;
}
