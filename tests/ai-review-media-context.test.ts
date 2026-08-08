/**
 * Regression tests for the AI pre-publish review media context fix.
 *
 * Root cause: analyzeDraftForPublishing derived missingMedia from
 * draft.assets, which is an optional partially-loaded relation absent when
 * the draft is passed from a client component. The fix routes the org-isolated
 * publishable count (same source as the deterministic preflight) through the
 * server action and into analyzeDraftForPublishing as an explicit parameter.
 *
 * T1 — attached same-org publishable image → AI review does NOT report missing media
 * T2 — no media                            → AI review reports missing media
 * T3 — cross-org asset                     → reports missing (org isolation)
 * T4 — non-publishable type (PDF)          → reports missing
 * T5 — deterministic preflight unchanged   → evaluatePlatformPreflight unaffected
 * T6 — AI score remains advisory           → missingMedia flag does not affect score path
 * T7 — simulation behaviour unchanged      → analyzeDraftForPublishing still returns PrePublishReport
 */

vi.mock("@/infrastructure/ai/provider-factory", () => ({
  getAIProvider: vi.fn(() => ({
    generateObject: vi.fn(async () => ({
      score: 85,
      brandVoiceAlignment: "high",
      readability: "easy",
      ctaQuality: "strong",
      platformOptimisation: "high",
      hashtagQuality: "optimal",
      accessibility: "good",
      compliance: "pass",
      recommendations: [],
    })),
  })),
}));

import { describe, it, expect, vi } from "vitest";
import { analyzeDraftForPublishing } from "@/core/application/use-cases/generation/pre-publish-review";
import { evaluatePlatformPreflight } from "@/core/domain/entities/publishing-preflight";
import type { ContentDraft } from "@/core/domain/entities/content";

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: "draft-1",
    organisationId: "org-1",
    title: "Test draft",
    body: "Introducing our luxury wig installation service.",
    contentType: "social_post",
    status: "approved",
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    summary: null,
    dueAt: null,
    reviewDeadline: null,
    priority: "medium",
    reviewerIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: { id: "user-1", fullName: "Test", email: "test@villiz.com" },
    updatedBy: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    ...overrides,
  };
}

// ── T1: attached same-org publishable image → missingMedia = false ─────────────

describe("T1 — same-org publishable image: AI review does not report missing media", () => {
  it("missingMedia is false when publishableMediaCount >= 1", async () => {
    const draft = makeDraft();
    // No draft.assets on the object (simulates client serialization where
    // the relation is absent).
    const report = await analyzeDraftForPublishing(draft, "", undefined, 1);
    expect(report.missingMedia).toBe(false);
  });
});

// ── T2: no media → missingMedia = true ────────────────────────────────────────

describe("T2 — no media: AI review reports missing media", () => {
  it("missingMedia is true when publishableMediaCount is 0", async () => {
    const draft = makeDraft();
    const report = await analyzeDraftForPublishing(draft, "", undefined, 0);
    expect(report.missingMedia).toBe(true);
  });
});

// ── T3: cross-org asset excluded at the action layer ─────────────────────────
// The action applies filterAssetsForOrganisation before counting; a cross-org
// asset never reaches the publishableMediaCount fed to analyzeDraftForPublishing.
// The pure function itself is tested here: count=0 → missingMedia=true.

describe("T3 — cross-org asset: AI review still reports missing media", () => {
  it("publishableMediaCount=0 (cross-org filtered out upstream) → missingMedia=true", async () => {
    const draft = makeDraft();
    const report = await analyzeDraftForPublishing(draft, "", undefined, 0);
    expect(report.missingMedia).toBe(true);
  });
});

// ── T4: non-publishable type excluded at the action layer ────────────────────
// isPublishableMediaAsset filters application/pdf before the count is computed.

describe("T4 — non-publishable asset type (PDF): AI review still reports missing", () => {
  it("publishableMediaCount=0 (PDF filtered out upstream) → missingMedia=true", async () => {
    const draft = makeDraft();
    const report = await analyzeDraftForPublishing(draft, "", undefined, 0);
    expect(report.missingMedia).toBe(true);
  });
});

// ── T5: deterministic preflight unaffected ────────────────────────────────────

describe("T5 — deterministic preflight rules are unchanged", () => {
  it("Instagram + publishableMediaCount >= 1 via evaluatePlatformPreflight → ready:true", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption text", 1);
    expect(result.ready).toBe(true);
  });

  it("Instagram + publishableMediaCount = 0 → ready:false (unchanged)", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption text", 0);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram requires at least one image or video.");
  });
});

// ── T6: AI score remains advisory ────────────────────────────────────────────
// publishableMediaCount affects only missingMedia; it does not override the
// AI-derived score, and the score does not gate publishing.

describe("T6 — AI score remains advisory: missingMedia does not alter score", () => {
  it("score is AI-derived regardless of publishableMediaCount", async () => {
    const draft = makeDraft();
    const reportNoMedia = await analyzeDraftForPublishing(draft, "", undefined, 0);
    const reportWithMedia = await analyzeDraftForPublishing(draft, "", undefined, 1);

    // Score is 85 from the mock AI in both cases — missingMedia does not affect it
    expect(reportNoMedia.score).toBe(85);
    expect(reportWithMedia.score).toBe(85);

    // Only missingMedia differs
    expect(reportNoMedia.missingMedia).toBe(true);
    expect(reportWithMedia.missingMedia).toBe(false);
  });
});

// ── T7: publishableMediaCount=undefined falls back to draft.assets ────────────
// Existing callers that do not supply publishableMediaCount are unaffected.

describe("T7 — backward compat: omitting publishableMediaCount falls back to draft.assets", () => {
  it("draft.assets absent → missingMedia=true (original behaviour preserved)", async () => {
    // draft.assets is undefined — simulates a call without the new parameter
    const draft = makeDraft({ assets: undefined });
    const report = await analyzeDraftForPublishing(draft, "");
    expect(report.missingMedia).toBe(true);
  });

  it("draft.assets present and non-empty → missingMedia=false (original behaviour preserved)", async () => {
    const draft = makeDraft({
      assets: [{ assetId: "a-1", attachedBy: "user-1", createdAt: new Date().toISOString() }],
    });
    const report = await analyzeDraftForPublishing(draft, "");
    expect(report.missingMedia).toBe(false);
  });
});
