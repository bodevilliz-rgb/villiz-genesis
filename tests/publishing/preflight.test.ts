/**
 * Isolated unit tests for `checkPublishingPreflight`.
 *
 * These tests exercise the function in complete isolation from any database,
 * Supabase client, or network — the ContentRepository and MediaRepository
 * ports are replaced with hand-rolled mocks that simulate every branch.
 *
 * Coverage:
 *   1. Valid content for each supported platform (instagram, tiktok, facebook, linkedin, x)
 *   2. Missing required disclosure (TikTok AI + commercial declarations)
 *   3. Draft not found
 *   4. Asset outside the organisation scope (filtered out, not sendable)
 *   5. Repository failure (content or media)
 *   6. Zero publishable assets (for a media-required platform)
 *   7. Concurrent / repeated calls (idempotency of read-only invocation)
 */
import { describe, it, expect, vi } from "vitest";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { MediaRepository } from "@/core/application/ports/media-port";
import { checkPublishingPreflight } from "@/core/application/use-cases/publishing/preflight";
import type { PlatformPreflightResult } from "@/core/domain/entities/publishing-preflight";
import type { ContentDraft, ContentDraftStatus } from "@/core/domain/entities/content";
import type { MediaAsset } from "@/core/domain/entities/media";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = "org-test-123";
const DRAFT_ID = "draft-test-456";
const PLATFORM = "instagram";

/** Minimal valid ContentDraft — enough to satisfy checkPublishingPreflight. */
function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: DRAFT_ID,
    organisationId: ORG_ID,
    title: "Test draft",
    contentType: "social_post",
    summary: null,
    body: "A short, valid caption for testing.",
    status: "needs_review" as ContentDraftStatus,
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    updatedBy: null,
    dueAt: null,
    reviewerIds: [],
    priority: "medium",
    reviewDeadline: null,
    hashtags: ["#Test", "#Content"],
    ...overrides,
  };
}

/** Minimal valid MediaAsset — image mime type, owned by the org. */
function makeMediaAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "media-1",
    organisationId: ORG_ID,
    storagePath: "drafts/test-456/asset-1.png",
    fileName: "asset-1.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 1080,
    height: 1080,
    uploadedBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    title: null,
    thumbnailPath: null,
    category: null,
    description: null,
    altText: null,
    tags: [],
    brand: null,
    duration: null,
    copyrightOwner: null,
    usageRights: null,
    expiresAt: null,
    isAiGenerated: false,
    isArchived: false,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Factory that builds a pair of mock repositories with controllable behaviour. */
function makeDeps(overrides: {
  findDraftResult?: ContentDraft | null;
  findDraftError?: Error;
  listAssetsResult?: MediaAsset[];
  listAssetsError?: Error;
} = {}): { content: ContentRepository; media: MediaRepository } {
  const content: ContentRepository = {
    listDrafts: vi.fn(),
    countDraftsByStatus: vi.fn(),
    findDraft: vi.fn().mockResolvedValue(overrides.findDraftResult ?? null),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    scheduleDraft: vi.fn(),
    updateStatus: vi.fn(),
    annotateLatestVersion: vi.fn(),
    listVersions: vi.fn(),
    createGenerationRequest: vi.fn(),
    getLatestGenerationRequest: vi.fn(),
    listDraftsForActor: vi.fn(),
    listRecentActivityForActor: vi.fn(),
    deleteDraft: vi.fn(),
  };

  if (overrides.findDraftError) {
    (content.findDraft as ReturnType<typeof vi.fn>).mockRejectedValueOnce(overrides.findDraftError);
  }

  const media: MediaRepository = {
    createAsset: vi.fn(),
    updateAssetMetadata: vi.fn(),
    getAsset: vi.fn(),
    listAssets: vi.fn(),
    listAssetsPage: vi.fn(),
    getLibraryStats: vi.fn(),
    replaceAssetVersion: vi.fn(),
    archiveAsset: vi.fn(),
    getDeletionStatus: vi.fn(),
    requestSafeDeletion: vi.fn(),
    getDeletionRequest: vi.fn(),
    recordCleanupResult: vi.fn(),
    attachToCampaign: vi.fn(),
    attachToDraft: vi.fn(),
    getAssetVersions: vi.fn(),
    listCollections: vi.fn(),
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
    attachAssetToCollection: vi.fn(),
    detachAssetFromCollection: vi.fn(),
    listAssetsForCollection: vi.fn(),
    listBrandKits: vi.fn(),
    createBrandKit: vi.fn(),
    updateBrandKit: vi.fn(),
    deleteBrandKit: vi.fn(),
    attachAssetToBrandKit: vi.fn(),
    detachAssetFromBrandKit: vi.fn(),
    listAssetsForDraft: vi.fn().mockResolvedValue(overrides.listAssetsResult ?? []),
    detachFromDraft: vi.fn(),
    listAssetsForCampaign: vi.fn(),
    detachFromCampaign: vi.fn(),
    listDraftsReferencingAsset: vi.fn(),
    listCampaignsReferencingAsset: vi.fn(),
  };

  if (overrides.listAssetsError) {
    (media.listAssetsForDraft as ReturnType<typeof vi.fn>).mockRejectedValueOnce(overrides.listAssetsError);
  }

  return { content, media };
}

// ---------------------------------------------------------------------------
// 1. Valid content for each supported platform
// ---------------------------------------------------------------------------

describe("checkPublishingPreflight — valid content per platform", () => {
  it("passes for instagram with media, body, and ≤5 hashtags", async () => {
    const draft = makeDraft({
      body: "Beautiful hair day! ✨",
      hashtags: ["#MervicSignatures", "#HairsentialMonday", "#NaturalHair"],
    });
    const asset = makeMediaAsset();

    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram" },
    );

    expect(result.ready).toBe(true);
    expect(result.simulationAllowed).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("passes for facebook with no media (text-only supported)", async () => {
    const draft = makeDraft({ body: "Just a thought about hair care today." });
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "facebook" },
    );

    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("passes for linkedin with no media (text-only supported)", async () => {
    const draft = makeDraft({ body: "Professional insights on sustainable beauty." });
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin" },
    );

    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("passes for x (Twitter) with no media", async () => {
    const draft = makeDraft({ body: "Quick hair tip: sleep on a silk pillowcase." });
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "x" },
    );

    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("passes for tiktok with media, body under 2200 chars, and AI+commercial disclosures", async () => {
    const draft = makeDraft({
      body: "Protective styling tutorial in 30 seconds. #HairTips",
      hashtags: ["#ProtectiveStyling"],
    });
    const asset = makeMediaAsset({ mimeType: "video/mp4" });

    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const result = await checkPublishingPreflight(
      { content, media },
      {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "tiktok",
        aiGeneratedDisclosure: false,
        commercialDisclosure: { isYourBrand: true, isBrandedContent: false },
      },
    );

    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Missing required disclosure (TikTok AI + commercial)
// ---------------------------------------------------------------------------

describe("checkPublishingPreflight — missing required disclosures", () => {
  const draft = makeDraft({
    body: "Quick hair tip",
    hashtags: ["#Hair"],
  });
  const asset = makeMediaAsset();

  it("blocks tiktok when aiGeneratedDisclosure is null (not declared)", async () => {
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const result = await checkPublishingPreflight(
      { content, media },
      {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "tiktok",
        aiGeneratedDisclosure: null,
        commercialDisclosure: { isYourBrand: false, isBrandedContent: false },
      },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("AI-generated content declaration");
  });

  it("blocks tiktok when aiGeneratedDisclosure is undefined (omitted)", async () => {
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const result = await checkPublishingPreflight(
      { content, media },
      {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "tiktok",
        commercialDisclosure: { isYourBrand: false, isBrandedContent: false },
      },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("AI-generated content declaration");
  });

  it("blocks tiktok when commercialDisclosure is partially null", async () => {
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const result = await checkPublishingPreflight(
      { content, media },
      {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "tiktok",
        aiGeneratedDisclosure: false,
        commercialDisclosure: { isYourBrand: true, isBrandedContent: null },
      },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("commercial content declaration");
  });

  it("blocks tiktok when commercialDisclosure is omitted entirely", async () => {
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const result = await checkPublishingPreflight(
      { content, media },
      {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "tiktok",
        aiGeneratedDisclosure: false,
      },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("commercial content declaration");
  });

  it("does not require disclosures for instagram (platform policy without them)", async () => {
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const result = await checkPublishingPreflight(
      { content, media },
      {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "instagram",
      },
    );

    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Draft not found
// ---------------------------------------------------------------------------

describe("checkPublishingPreflight — draft not found", () => {
  it("returns ready=false when findDraft resolves to null", async () => {
    const { content, media } = makeDeps({ findDraftResult: null, listAssetsResult: [] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: "missing-draft", platform: PLATFORM },
    );

    expect(result.ready).toBe(false);
    expect(result.simulationAllowed).toBe(true);
    expect(result.blockers.join(" ")).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// 4. Asset outside the organisation scope
// ---------------------------------------------------------------------------

describe("checkPublishingPreflight — asset outside organisation scope", () => {
  it("does not count a foreign-org asset as publishable even if it is an image", async () => {
    const draft = makeDraft({ body: "Caption with media", hashtags: [] });

    // Asset belongs to a DIFFERENT organisation — filterAssetsForOrganisation
    // will reject it. For instagram (mediaRequired=true), zero publishable
    // assets should block the preflight.
    const foreignAsset = makeMediaAsset({
      id: "media-foreign",
      organisationId: "org-someone-else",
    });

    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [foreignAsset] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram" },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("requires at least one image or video");
  });

  it("rejects non-publishable asset types (documents, audio) even within the org", async () => {
    const draft = makeDraft({ body: "Caption", hashtags: [] });

    const docAsset = makeMediaAsset({ id: "doc-1", mimeType: "application/pdf" });
    const audioAsset = makeMediaAsset({ id: "audio-1", mimeType: "audio/mpeg" });

    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [docAsset, audioAsset] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram" },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("requires at least one image or video");
  });
});

// ---------------------------------------------------------------------------
// 5. Repository failure
// ---------------------------------------------------------------------------

describe("checkPublishingPreflight — repository failure", () => {
  it("fails closed when content repository throws on findDraft", async () => {
    const { content, media } = makeDeps({
      findDraftError: new Error("Database connection refused"),
      listAssetsResult: [],
    });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: PLATFORM },
    );

    // Must not crash — must produce a deterministic, fail-closed result
    expect(result.ready).toBe(false);
    expect(result.simulationAllowed).toBe(true);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers.join(" ")).toContain("unavailable");
  });

  it("fails closed when media repository throws on listAssetsForDraft", async () => {
    const draft = makeDraft({ body: "Valid body", hashtags: [] });

    const { content, media } = makeDeps({
      findDraftResult: draft,
      listAssetsError: new Error("Media store timeout"),
    });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: PLATFORM },
    );

    expect(result.ready).toBe(false);
    expect(result.simulationAllowed).toBe(true);
    expect(result.blockers.join(" ")).toContain("unavailable");
  });
});

// ---------------------------------------------------------------------------
// 6. Zero publishable assets for media-required platforms
// ---------------------------------------------------------------------------

describe("checkPublishingPreflight — zero publishable assets", () => {
  it("blocks instagram when draft has no media assets at all", async () => {
    const draft = makeDraft({ body: "No media here", hashtags: [] });
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram" },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("requires at least one image or video");
  });

  it("blocks tiktok when draft has no media assets", async () => {
    const draft = makeDraft({ body: "No media here", hashtags: [] });
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [] });

    const result = await checkPublishingPreflight(
      { content, media },
      {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "tiktok",
        aiGeneratedDisclosure: false,
        commercialDisclosure: { isYourBrand: false, isBrandedContent: false },
      },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("requires at least one image or video");
  });

  it("passes facebook with zero assets (media not required)", async () => {
    const draft = makeDraft({ body: "Text-only post", hashtags: [] });
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [] });

    const result = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "facebook" },
    );

    expect(result.ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Concurrent / repeated calls (idempotency)
// ---------------------------------------------------------------------------

describe("checkPublishingPreflight — repeated concurrent calls are idempotent", () => {
  it("returns identical results when called multiple times in parallel", async () => {
    const draft = makeDraft({
      body: "Consistent body",
      hashtags: ["#Tag1", "#Tag2"],
    });
    const asset = makeMediaAsset();
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    // Fire 5 concurrent invocations
    const promises = Array.from({ length: 5 }, () =>
      checkPublishingPreflight(
        { content, media },
        { organisationId: ORG_ID, draftId: DRAFT_ID, platform: PLATFORM },
      ),
    );
    const results: PlatformPreflightResult[] = await Promise.all(promises);

    // All results must be identical
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.ready).toBe(true);
      expect(r.simulationAllowed).toBe(true);
      expect(r.blockers).toHaveLength(0);
    }
  });

  it("is deterministic for the same input across sequential calls", async () => {
    const draft = makeDraft({ body: "Same body", hashtags: ["#A", "#B", "#C"] });
    const asset = makeMediaAsset();
    const { content, media } = makeDeps({ findDraftResult: draft, listAssetsResult: [asset] });

    const r1 = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: PLATFORM },
    );
    const r2 = await checkPublishingPreflight(
      { content, media },
      { organisationId: ORG_ID, draftId: DRAFT_ID, platform: PLATFORM },
    );

    expect(r1).toEqual(r2);
    expect(r1.ready).toBe(true);
  });
});
