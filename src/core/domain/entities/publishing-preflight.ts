import type { PublishingPlatform } from "./publishing";
import { evaluateHashtagPolicy, hashtagPolicyViolationMessage } from "./platform-policy";

export interface PlatformPreflightResult {
  /** All hard platform requirements met — safe to proceed with live publishing. */
  ready: boolean;
  /**
   * Simulation is always allowed (every platform that could ever appear in
   * the queue is known to the worker). When ready=false the UI must show a
   * warning that this post would be blocked in live mode.
   */
  simulationAllowed: boolean;
  /** Human-readable reasons live publishing is blocked. Empty when ready=true. */
  blockers: string[];
}

/**
 * Deterministic, pure platform preflight evaluation — no IO, no AI.
 *
 * Rules derived solely from observed Blotato behaviour documented in the
 * codebase:
 *
 *   Instagram media requirement
 *     Source: blotato-publisher-base.ts Sprint 6D comment:
 *     "Blotato accepted a post with no media, then failed it with 'requires
 *     an image or a video'" — confirmed from production observation.
 *
 *   Empty body
 *     Universal: no platform accepts a post with no content.
 *
 *   Facebook / LinkedIn / X
 *     Text-only posts accepted — no contrary evidence in the codebase.
 *     Media remains optional on these platforms.
 *
 *   Hashtag count (per-platform, see platform-policy.ts)
 *     Source: a live Blotato 422 response — "Instagram allows a maximum of
 *     5 hashtags per post" — for a scheduled job with 6 first-class
 *     hashtags. Evaluated from the normalized, deduplicated hashtags array
 *     (never regex-parsed from the composed caption), so this is exactly
 *     the count that will actually be sent.
 *
 * `hashtags` defaults to `[]` — existing callers that don't yet pass it are
 * unaffected (an empty list can never exceed any platform's limit).
 */
export function evaluatePlatformPreflight(
  platform: PublishingPlatform,
  body: string,
  publishableMediaCount: number,
  hashtags: string[] = [],
): PlatformPreflightResult {
  const blockers: string[] = [];

  if (!body || body.trim().length === 0) {
    blockers.push("Post body cannot be empty.");
  }

  if (platform === "instagram" && publishableMediaCount === 0) {
    blockers.push("Instagram requires at least one image or video.");
  }

  const hashtagPolicy = evaluateHashtagPolicy(platform, hashtags);
  if (hashtagPolicy.exceeds) {
    blockers.push(hashtagPolicyViolationMessage(platform, hashtagPolicy));
  }

  return {
    ready: blockers.length === 0,
    simulationAllowed: true,
    blockers,
  };
}
