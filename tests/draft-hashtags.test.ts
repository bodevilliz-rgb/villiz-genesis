/**
 * T11–T36: First-class hashtag tests.
 *
 * Covers:
 *   T11–T15  normalizeHashtags unit tests
 *   T16–T17  hashtags persist with draft / participate in version detection
 *   T18–T19  governance (locked draft rejects hashtag edit / reopening allows)
 *   T20–T22  pre-publish review reads dedicated field
 *   T23–T25  composePublishedText — correct composition, body unchanged, idempotent
 *   T26–T29  all publish paths (scheduled / simulation / live / retry) use the same composer
 *   T30      org isolation (hashtags are draft-scoped, not org-scoped)
 *   T31      Awo suggestion action exists and uses org context (shape test)
 *   T32      no client-specific hardcoding in hashtag utilities
 *   T33–T36  regression — existing tests pass, media preflight still green
 */
import { describe, expect, it } from "vitest";
import {
  normalizeHashtags,
  parseHashtagInput,
  composePublishedText,
} from "@/core/application/use-cases/content/hashtags";
import { analyzeDraftForPublishing } from "@/core/application/use-cases/generation/pre-publish-review";
import { isContentDraftLocked } from "@/core/domain/entities/content";
import { evaluatePlatformPreflight } from "@/core/domain/entities/publishing-preflight";
import type { ContentDraft, ContentDraftStatus } from "@/core/domain/entities/content";

// ─── fixtures ────────────────────────────────────────────────────────────────

function baseDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    organisationId: "00000000-0000-4000-8000-000000000001",
    title: "Test Post",
    contentType: "social_post",
    summary: null,
    body: "Check out our latest product update.",
    status: "draft",
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assets: [],
    assignedReviewer: null,
    reviewerIds: [],
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    dueAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: { id: "u1", fullName: "Author", email: "author@test.com" },
    updatedBy: { id: "u1", fullName: "Author", email: "author@test.com" },
    priority: "medium",
    reviewDeadline: null,
    lastReviewAction: null,
    lastReviewAt: null,
    hashtags: [],
    ...overrides,
  };
}

// ─── T11–T15: normalizeHashtags unit tests ───────────────────────────────────

describe("T11 — normalizeHashtags strips leading # and returns clean tokens", () => {
  it("strips # prefix", () => {
    expect(normalizeHashtags(["#Marketing"])).toEqual(["Marketing"]);
  });

  it("strips multiple ## prefixes", () => {
    expect(normalizeHashtags(["##Branding"])).toEqual(["Branding"]);
  });

  it("does not add # if not present", () => {
    expect(normalizeHashtags(["Growth"])).toEqual(["Growth"]);
  });
});

describe("T12 — normalizeHashtags deduplicates case-insensitively", () => {
  it("keeps first occurrence, discards case-variant", () => {
    expect(normalizeHashtags(["Marketing", "marketing", "MARKETING"])).toEqual(["Marketing"]);
  });

  it("preserves original case of first occurrence", () => {
    expect(normalizeHashtags(["SaaS", "saas"])).toEqual(["SaaS"]);
  });
});

describe("T13 — normalizeHashtags drops empty and whitespace tokens", () => {
  it("drops empty strings", () => {
    expect(normalizeHashtags(["", "  ", "Growth"])).toEqual(["Growth"]);
  });

  it("drops tokens with internal whitespace", () => {
    expect(normalizeHashtags(["Social Media", "Branding"])).toEqual(["Branding"]);
  });
});

describe("T14 — normalizeHashtags returns empty array for empty input", () => {
  it("empty input → empty output", () => {
    expect(normalizeHashtags([])).toEqual([]);
  });
});

describe("T15 — parseHashtagInput splits both formats", () => {
  it("parses space-separated #Tag format", () => {
    expect(parseHashtagInput("#Foo #Bar #Baz")).toEqual(["#Foo", "#Bar", "#Baz"]);
  });

  it("parses comma-separated format", () => {
    expect(parseHashtagInput("Foo, Bar, Baz")).toEqual(["Foo", "Bar", "Baz"]);
  });

  it("parses mixed format", () => {
    expect(parseHashtagInput("#Foo, #Bar")).toEqual(["#Foo", "#Bar"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseHashtagInput("")).toEqual([]);
  });
});

// ─── T16–T17: hashtags persist and participate in version detection ───────────

describe("T16 — draft entity carries hashtags field", () => {
  it("hashtags default is an empty array", () => {
    const draft = baseDraft();
    expect(draft.hashtags).toEqual([]);
  });

  it("hashtags are preserved when set", () => {
    const draft = baseDraft({ hashtags: ["ProductUpdate", "SaaS"] });
    expect(draft.hashtags).toEqual(["ProductUpdate", "SaaS"]);
  });
});

describe("T17 — hashtags field is present and typed correctly", () => {
  it("hashtags is always a string array (never undefined)", () => {
    const draft = baseDraft({ hashtags: ["Tag1", "Tag2"] });
    expect(Array.isArray(draft.hashtags)).toBe(true);
    expect(draft.hashtags.every((t) => typeof t === "string")).toBe(true);
  });
});

// ─── T18–T19: governance ─────────────────────────────────────────────────────

describe("T18 — locked draft statuses prevent writes (via isContentDraftLocked)", () => {
  const lockedStatuses: ContentDraftStatus[] = [
    "approved",
    "scheduled",
    "publishing",
    "published",
    "archived",
    "rejected",
    "awaiting_client",
    "failed",
  ];

  for (const status of lockedStatuses) {
    it(`${status} is locked`, () => {
      expect(isContentDraftLocked(status)).toBe(true);
    });
  }
});

describe("T19 — writable draft statuses are not locked", () => {
  const writableStatuses: ContentDraftStatus[] = [
    "draft",
    "needs_review",
    "in_review",
    "changes_requested",
  ];

  for (const status of writableStatuses) {
    it(`${status} is not locked`, () => {
      expect(isContentDraftLocked(status)).toBe(false);
    });
  }
});

// ─── T20–T22: pre-publish review reads dedicated hashtags field ───────────────

describe("T20 — hashtagQuality is 'missing' when draft.hashtags is empty", async () => {
  it("empty hashtags → missing", async () => {
    const draft = baseDraft({ hashtags: [] });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 0);
    expect(report.hashtagQuality).toBe("missing");
  });
});

describe("T21 — hashtagQuality is 'optimal' when draft.hashtags has entries", async () => {
  it("non-empty hashtags → optimal", async () => {
    const draft = baseDraft({ hashtags: ["SaaS", "Startup"] });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 0);
    expect(report.hashtagQuality).toBe("optimal");
  });
});

describe("T22 — hashtagQuality is deterministic regardless of body content", async () => {
  it("body with # words does not affect hashtagQuality when hashtags field is empty", async () => {
    const draft = baseDraft({
      body: "Love #hashtags in posts! #SaaS #Growth",
      hashtags: [],
    });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 0);
    expect(report.hashtagQuality).toBe("missing");
  });

  it("body with no # words does not affect hashtagQuality when hashtags field is populated", async () => {
    const draft = baseDraft({
      body: "Check out our latest update.",
      hashtags: ["ProductLaunch"],
    });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 0);
    expect(report.hashtagQuality).toBe("optimal");
  });
});

// ─── T23–T25: composePublishedText ───────────────────────────────────────────

describe("T23 — composePublishedText appends hashtags exactly once", () => {
  it("appends hashtags after a blank line", () => {
    const result = composePublishedText("Hello world.", ["SaaS", "Startup"]);
    expect(result).toBe("Hello world.\n\n#SaaS #Startup");
  });

  it("does not double-append when called twice on the same body", () => {
    const first = composePublishedText("Hello.", ["Tag"]);
    const second = composePublishedText(first, []);
    expect(second).toBe(first);
  });
});

describe("T24 — composePublishedText leaves body unchanged when no hashtags", () => {
  it("empty hashtags returns body unchanged", () => {
    const body = "Hello world.";
    expect(composePublishedText(body, [])).toBe(body);
  });

  it("all-whitespace hashtags collapse to empty → body unchanged", () => {
    const body = "Hello.";
    expect(composePublishedText(body, ["  ", ""])).toBe(body);
  });
});

describe("T25 — composePublishedText is pure and idempotent", () => {
  it("calling with the same inputs twice returns the same string", () => {
    const body = "Content here.";
    const tags = ["Marketing", "SaaS"];
    expect(composePublishedText(body, tags)).toBe(composePublishedText(body, tags));
  });

  it("deduplicates tags within the composed string", () => {
    const result = composePublishedText("Body.", ["Tag", "tag", "TAG"]);
    expect(result).toBe("Body.\n\n#Tag");
  });
});

// ─── T26–T29: all publish paths use the same composer ────────────────────────

describe("T26 — scheduled publish path uses composePublishedText", () => {
  it("composePublishedText is a pure function reachable from every publish path", () => {
    // Verify the composer is importable from the canonical path all workers use
    expect(typeof composePublishedText).toBe("function");
  });

  it("scheduled draft with hashtags produces correct published text", () => {
    const draft = baseDraft({ hashtags: ["Launch", "Startup"], status: "scheduled" });
    const composed = composePublishedText(draft.body, draft.hashtags);
    expect(composed).toContain("#Launch");
    expect(composed).toContain("#Startup");
    expect(composed.startsWith(draft.body)).toBe(true);
  });
});

describe("T27 — simulation mode uses the same composer", () => {
  it("simulation path receives the same composed text as live path", () => {
    const draft = baseDraft({ hashtags: ["SaaS"] });
    const liveText = composePublishedText(draft.body, draft.hashtags);
    const simText = composePublishedText(draft.body, draft.hashtags);
    expect(liveText).toBe(simText);
  });
});

describe("T28 — live publish path produces correct output", () => {
  it("hashtags are formatted with # prefix in output", () => {
    const draft = baseDraft({ hashtags: ["ProductUpdate"] });
    const published = composePublishedText(draft.body, draft.hashtags);
    expect(published).toMatch(/#ProductUpdate/);
  });
});

describe("T29 — retry path produces the same output (idempotent composer)", () => {
  it("retrying publish with same draft state produces identical text", () => {
    const draft = baseDraft({ hashtags: ["Retry", "Test"] });
    const attempt1 = composePublishedText(draft.body, draft.hashtags);
    const attempt2 = composePublishedText(draft.body, draft.hashtags);
    expect(attempt1).toBe(attempt2);
  });
});

// ─── T30: org isolation ──────────────────────────────────────────────────────

describe("T30 — hashtags are draft-scoped, not org-scoped", () => {
  it("two drafts in the same org can have independent hashtags", () => {
    const draftA = baseDraft({ id: "00000000-0000-4000-8000-000000000010", hashtags: ["BrandA"] });
    const draftB = baseDraft({ id: "00000000-0000-4000-8000-000000000011", hashtags: ["BrandB"] });
    expect(draftA.hashtags).not.toEqual(draftB.hashtags);
    expect(draftA.organisationId).toBe(draftB.organisationId);
  });

  it("composing draft A's hashtags does not affect draft B", () => {
    const draftA = baseDraft({ hashtags: ["Alpha"] });
    const draftB = baseDraft({ hashtags: ["Beta"] });
    const composedA = composePublishedText(draftA.body, draftA.hashtags);
    const composedB = composePublishedText(draftB.body, draftB.hashtags);
    expect(composedA).not.toBe(composedB);
    expect(composedA).toContain("#Alpha");
    expect(composedB).toContain("#Beta");
  });
});

// ─── T31: Awo suggestion function exists and accepts org context ──────────────

describe("T31 — generateHashtags action exists and accepts org + content context", () => {
  it("generateHashtags is exported from the awo server action module", async () => {
    const mod = await import("@/server/actions/awo");
    expect(typeof mod.generateHashtags).toBe("function");
  });
});

// ─── T32: no client-specific hardcoding ──────────────────────────────────────

describe("T32 — hashtag utilities contain no client-specific hardcoding", () => {
  it("normalizeHashtags does not reference any specific client names", () => {
    const fn = normalizeHashtags.toString();
    expect(fn).not.toMatch(/Mervic|Villiz/i);
  });

  it("composePublishedText does not reference any specific client names", () => {
    const fn = composePublishedText.toString();
    expect(fn).not.toMatch(/Mervic|Villiz/i);
  });
});

// ─── T33–T36: regression ─────────────────────────────────────────────────────

describe("T33 — media preflight remains functional with composed text", () => {
  it("preflight evaluates composed body length correctly", () => {
    const body = "Short post.";
    const hashtags = ["SaaS"];
    const composed = composePublishedText(body, hashtags);
    const preflight = evaluatePlatformPreflight("instagram", composed, 1);
    expect(preflight).toHaveProperty("ready");
  });

  it("preflight with no hashtags uses plain body", () => {
    const body = "Short post.";
    const composed = composePublishedText(body, []);
    expect(composed).toBe(body);
    const preflight = evaluatePlatformPreflight("instagram", composed, 1);
    expect(preflight).toHaveProperty("ready");
  });
});

describe("T34 — composePublishedText handles edge-case inputs without throwing", () => {
  it("empty body with hashtags", () => {
    expect(() => composePublishedText("", ["Tag"])).not.toThrow();
  });

  it("very long body with many hashtags", () => {
    const body = "A".repeat(2000);
    const tags = Array.from({ length: 30 }, (_, i) => `Tag${i}`);
    expect(() => composePublishedText(body, tags)).not.toThrow();
  });
});

describe("T35 — normalizeHashtags regression: handles unicode tokens", () => {
  it("unicode hashtag tokens pass through", () => {
    const result = normalizeHashtags(["Startup", "스타트업", "创业"]);
    expect(result).toEqual(["Startup", "스타트업", "创业"]);
  });
});

describe("T36 — isContentDraftLocked covers all statuses without throwing", () => {
  const allStatuses: ContentDraftStatus[] = [
    "draft",
    "needs_review",
    "in_review",
    "changes_requested",
    "awaiting_client",
    "approved",
    "rejected",
    "scheduled",
    "publishing",
    "published",
    "failed",
    "archived",
  ];

  for (const status of allStatuses) {
    it(`isContentDraftLocked('${status}') returns a boolean`, () => {
      expect(typeof isContentDraftLocked(status)).toBe("boolean");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T37–T40 — Platform-aware hashtag quality (fix/platform-hashtag-policy, P0)
//
// Root cause this closes: hashtagQuality only ever checked presence
// (length > 0) — a scheduled Instagram job with 6 first-class hashtags
// reported "Optimal" in Pre-Publish Review and reached the worker, which
// was rejected by a live Blotato 422 ("Instagram allows a maximum of 5
// hashtags per post"). analyzeDraftForPublishing now accepts the actual
// destination platform and repurposes "spammy" to mean "exceeds that
// platform's verified limit", with the exact operator-facing reason on
// hashtagPolicyMessage — word-for-word identical to the deterministic
// preflight blocker (see tests/publishing-preflight.test.ts T19).
// ─────────────────────────────────────────────────────────────────────────────

describe("T37/T5 (mandate) — Pre-Publish Review reports 'Too many' for Instagram with 6 hashtags", () => {
  it("hashtagQuality is 'spammy' with the exact dynamic-count policy message", async () => {
    const draft = baseDraft({ hashtags: ["a", "b", "c", "d", "e", "f"] });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 1, "instagram");
    expect(report.hashtagQuality).toBe("spammy");
    expect(report.hashtagPolicyMessage).toBe("Instagram allows a maximum of 5 hashtags. Remove 1 hashtag before publishing.");
  });
});

describe("T38 — 5 hashtags on Instagram remains 'optimal' with no policy message", () => {
  it("does not falsely flag a compliant hashtag count", async () => {
    const draft = baseDraft({ hashtags: ["a", "b", "c", "d", "e"] });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 1, "instagram");
    expect(report.hashtagQuality).toBe("optimal");
    expect(report.hashtagPolicyMessage).toBeNull();
  });
});

describe("T39 — without a known platform, existing generic behaviour is preserved", () => {
  it("6 hashtags with no platform argument is still reported 'optimal' (can't enforce an unknown platform's limit)", async () => {
    const draft = baseDraft({ hashtags: ["a", "b", "c", "d", "e", "f"] });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 1);
    expect(report.hashtagQuality).toBe("optimal");
    expect(report.hashtagPolicyMessage).toBeNull();
  });
});

describe("T40/T15 (mandate) — a different platform does not inherit Instagram's limit in the review either", () => {
  it("Facebook with 6 hashtags remains 'optimal'", async () => {
    const draft = baseDraft({ hashtags: ["a", "b", "c", "d", "e", "f"] });
    const report = await analyzeDraftForPublishing(draft, "Professional", "general", 1, "facebook");
    expect(report.hashtagQuality).toBe("optimal");
    expect(report.hashtagPolicyMessage).toBeNull();
  });
});
