/**
 * Canonical platform hashtag policy — fix/platform-hashtag-policy.
 *
 * P0 root cause: a scheduled Instagram job with 6 first-class hashtags
 * passed Pre-Publish Review ("Hashtags: Optimal", "Platform requirements
 * met") and reached the worker, which submitted the composed caption to
 * Blotato and was rejected with a live 422 — "Instagram allows a maximum
 * of 5 hashtags per post." Nothing in Genesis checked hashtag COUNT
 * against a limit anywhere: hashtagQuality only checked presence
 * (length > 0), and evaluatePlatformPreflight had no hashtag parameter at
 * all. Fixed with one canonical policy module (platform-policy.ts)
 * consulted by every layer: Pre-Publish Review, immediate/scheduled
 * preflight (job creation), worker execution (defense in depth), retry,
 * and Awo's hashtag suggester.
 *
 * 1  — Instagram 5 hashtags passes evaluateHashtagPolicy
 * 2  — Instagram 6 hashtags fails (exceeds=true, excessCount=1)
 * 3  — Instagram 8 hashtags fails with excessCount=3
 * 4  — duplicate normalized hashtags (case-insensitive) counted once — ["Photo","photo"] = 1
 * 15 — a different platform (Facebook) does not inherit Instagram's limit — no verified limit, never exceeds
 * (LinkedIn/X included for completeness — same "no verified limit" behaviour)
 */

import { describe, expect, it } from "vitest";
import {
  evaluateHashtagPolicy,
  hashtagPolicyViolationMessage,
  getPlatformPublishingPolicy,
  PLATFORM_PUBLISHING_POLICIES,
} from "@/core/domain/entities/platform-policy";

describe("1/12/13 — Instagram: 5 hashtags is within policy", () => {
  it("does not exceed the limit", () => {
    const result = evaluateHashtagPolicy("instagram", ["a", "b", "c", "d", "e"]);
    expect(result.exceeds).toBe(false);
    expect(result.count).toBe(5);
    expect(result.excessCount).toBe(0);
  });
});

describe("2 — Instagram: 6 hashtags fails deterministic policy", () => {
  it("exceeds by exactly 1", () => {
    const result = evaluateHashtagPolicy("instagram", ["a", "b", "c", "d", "e", "f"]);
    expect(result.exceeds).toBe(true);
    expect(result.count).toBe(6);
    expect(result.excessCount).toBe(1);
  });

  it("produces the exact dynamic message, with correct singular/plural", () => {
    const result = evaluateHashtagPolicy("instagram", ["a", "b", "c", "d", "e", "f"]);
    const message = hashtagPolicyViolationMessage("instagram", result);
    expect(message).toBe("Instagram allows a maximum of 5 hashtags. Remove 1 hashtag before publishing.");
  });
});

describe("3 — Instagram: more than 6 hashtags also fails, with the correct excess count", () => {
  it("8 hashtags → excessCount 3, plural message", () => {
    const result = evaluateHashtagPolicy("instagram", ["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(result.exceeds).toBe(true);
    expect(result.excessCount).toBe(3);
    expect(hashtagPolicyViolationMessage("instagram", result)).toBe(
      "Instagram allows a maximum of 5 hashtags. Remove 3 hashtags before publishing.",
    );
  });
});

describe("4 — duplicate normalized hashtags are counted once, not twice", () => {
  it("['Photo', 'photo'] normalizes to a single hashtag (case-insensitive dedup)", () => {
    const result = evaluateHashtagPolicy("instagram", ["Photo", "photo"]);
    expect(result.count).toBe(1);
    expect(result.exceeds).toBe(false);
  });

  it("6 hashtags where one is a case-variant duplicate of another normalizes to 5 — does not exceed", () => {
    const result = evaluateHashtagPolicy("instagram", ["Coventry", "coventry", "b", "c", "d", "e"]);
    expect(result.count).toBe(5);
    expect(result.exceeds).toBe(false);
  });

  it("6 genuinely distinct hashtags (leading # stripped, whitespace trimmed) still exceeds", () => {
    const result = evaluateHashtagPolicy("instagram", ["#a", " b ", "#c", "d", "e", "#f"]);
    expect(result.count).toBe(6);
    expect(result.exceeds).toBe(true);
  });
});

describe("15 — other platforms do not inherit Instagram's limit", () => {
  it("Facebook has no verified hashtag limit — 6 hashtags never exceeds", () => {
    const result = evaluateHashtagPolicy("facebook", ["a", "b", "c", "d", "e", "f"]);
    expect(result.exceeds).toBe(false);
    expect(result.maxHashtags).toBeUndefined();
  });

  it("LinkedIn has no verified hashtag limit — 20 hashtags never exceeds", () => {
    const result = evaluateHashtagPolicy("linkedin", Array.from({ length: 20 }, (_, i) => `tag${i}`));
    expect(result.exceeds).toBe(false);
  });

  it("X has no verified hashtag limit — 10 hashtags never exceeds", () => {
    const result = evaluateHashtagPolicy("x", Array.from({ length: 10 }, (_, i) => `tag${i}`));
    expect(result.exceeds).toBe(false);
  });

  it("only Instagram has a verified maxHashtags value in the canonical policy table", () => {
    expect(PLATFORM_PUBLISHING_POLICIES.instagram.maxHashtags).toBe(5);
    expect(PLATFORM_PUBLISHING_POLICIES.facebook.maxHashtags).toBeUndefined();
    expect(PLATFORM_PUBLISHING_POLICIES.linkedin.maxHashtags).toBeUndefined();
    expect(PLATFORM_PUBLISHING_POLICIES.x.maxHashtags).toBeUndefined();
  });

  it("getPlatformPublishingPolicy returns the exact same table entry", () => {
    expect(getPlatformPublishingPolicy("instagram")).toEqual(PLATFORM_PUBLISHING_POLICIES.instagram);
  });
});
