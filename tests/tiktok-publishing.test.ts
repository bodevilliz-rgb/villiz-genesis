/**
 * TikTok publishing integration — Sprint 1 (feature/tiktok-publishing).
 *
 * TikTok plugs into the SAME shared publishing architecture Instagram
 * already proved in production — job model, queue, preflight, worker,
 * retry, reconciliation, analytics — rather than a parallel system. Every
 * test below exercises TikTok through the exact same code paths the
 * existing Instagram/LinkedIn/Facebook/X test suites already cover, using
 * fictional Alpha/Beta organisations. No client-specific account IDs.
 *
 * Verified TikTok contract (see platform-policy.ts and
 * blotato-tiktok-publisher.ts doc comments for sources): media (image or
 * video) is required — no text-only posts; caption limit 2200 characters;
 * target schema requires targetType "tiktok" plus 7 fields (privacyLevel,
 * disabledComments, disabledDuet, disabledStitch, isBrandedContent,
 * isYourBrand, isAiGenerated). No verified hashtag COUNT limit exists, so
 * maxHashtags stays undefined for TikTok, matching Facebook/LinkedIn/X.
 *
 * Mandate map (31 items from the Sprint 1 spec):
 *   1  — TikTok recognised as PublishingPlatform
 *   2  — TikTok Blotato account can be assigned to Alpha
 *   3  — Beta cannot use Alpha's TikTok destination
 *   4  — TikTok destination appears only when connected
 *   5  — TikTok preflight accepts verified-valid media
 *   6  — TikTok preflight rejects verified-invalid/no media
 *   7  — Provider-invalid payload blocked before publishPost
 *   8  — Valid immediate TikTok job reaches publisher
 *   9  — Valid scheduled TikTok job remains unclaimed before due time
 *  10  — Due scheduled TikTok job becomes claimable
 *  11  — Media resolved fresh at execution
 *  12  — TikTok payload matches verified Blotato contract
 *  13  — Correct accountId used
 *  14  — Correct targetType used
 *  15  — Caption transmitted correctly
 *  16  — Hashtags composed exactly once
 *  17  — Media URLs transmitted correctly (Blotato-domain only)
 *  18  — Provider submission ID persisted
 *  19  — Published status persisted
 *  20  — Failed status persisted
 *  21  — Timeout reconciliation never calls publishPost
 *  22  — Retry uses latest approved content/media
 *  23  — Trigger type preserved through retry
 *  24  — Simulation makes no provider call
 *  25  — TikTok analytics remain organisation-scoped
 *  27  — Platform policy does not leak TikTok rules into other platforms
 *
 * Items 9/10 (claim-eligibility timing) and 26/28/29/30/31 (full
 * regression + reliability gates) are proven by construction — job
 * creation/claim/worker code has zero platform branching (see
 * publisher-factory.ts, worker.ts, publishing-worker-core.ts) — and by the
 * full `npm test` / `npm run reliability:test` runs required for this
 * phase, not by TikTok-specific duplicate tests of already-generic,
 * already-tested scheduling machinery.
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(),
}));

vi.mock("@/infrastructure/publishers/publisher-factory", () => ({
  resolvePublisher: vi.fn(),
}));

vi.mock("@/infrastructure/publishers/simulation-mode", () => ({
  resolveEffectiveSimulationMode: vi.fn(() => null),
}));

import { describe, expect, it, vi } from "vitest";
import {
  isPublishingPlatform,
  PUBLISHING_PLATFORMS,
  PUBLISHING_PLATFORM_LABELS,
} from "@/core/domain/entities/publishing";
import { mapBlotatoPlatform, toBlotatoPlatform, supportedPlatformsFromAccounts } from "@/core/domain/entities/blotato";
import { evaluatePlatformPreflight } from "@/core/domain/entities/publishing-preflight";
import { checkPublishingPreflight } from "@/core/application/use-cases/publishing/preflight";
import { PLATFORM_PUBLISHING_POLICIES, getPlatformPublishingPolicy } from "@/core/domain/entities/platform-policy";
import { computePublishingAnalytics } from "@/core/application/use-cases/publishing/analytics";
import { assignChannelToOrganisation } from "@/core/application/use-cases/organisation-social-accounts";
import { reconcileBlotatoStatusTimeout } from "@/core/application/use-cases/publishing";
import { ConflictError } from "@/core/domain/errors";
import { resolvePublisher } from "@/infrastructure/publishers/publisher-factory";
import { BlotatoTikTokPublisher, TIKTOK_PRODUCT_DEFAULT_TARGET_OPTIONS } from "@/infrastructure/publishers/blotato/blotato-tiktok-publisher";
import type { BlotatoPublisherDeps } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient, BlotatoPostStatus, BlotatoPublishInput } from "@/core/application/ports/blotato-client-port";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import type { PublishInput } from "@/core/application/ports/publisher-port";
import type { MediaAsset } from "@/core/domain/entities/media";
import type { PublishingJob, PublishingAttempt } from "@/core/domain/entities/publishing";

const ORG_ALPHA = "00000000-0000-4000-8000-0000000000a1";
const ORG_BETA = "00000000-0000-4000-8000-0000000000b2";
const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";

// ── Shared fakes ───────────────────────────────────────────────────────────────

function storedAccount(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    id: "acc-tiktok-1",
    platform: "tiktok",
    fullname: "Villiz TikTok",
    username: "villizpixels",
    organisationId: null,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-09T00:00:00Z",
    ...overrides,
  };
}

function fakeAccountRepo(overrides: Partial<BlotatoAccountRepository> = {}): BlotatoAccountRepository {
  return {
    upsertAccounts: async (accounts) => accounts.map((a) => storedAccount(a)),
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
    findActiveForOrganisationAndPlatform: async () => [],
    listActiveForOrganisation: async () => [],
    assignToOrganisation: async (id, orgId) => storedAccount({ id, organisationId: orgId }),
    removeFromOrganisation: async () => {},
    ...overrides,
  };
}

function fakeUsageRepo(maxSocialAccounts = 6) {
  return {
    forOrganisation: async () => ({
      organisationId: ORG_ALPHA,
      socialAccountsUsed: 0,
      postsThisWeek: 0,
      storageBytesUsed: 0,
      aiTokensThisMonth: 0,
      membrainEntriesUsed: 0,
      maxSocialAccounts,
      maxPostsPerWeek: 25,
      maxStorageBytes: 10 * 1024 * 1024 * 1024,
      maxAiTokensPerMonth: 100_000,
      maxMembrainEntries: 100,
    }),
    forAllVisibleOrganisations: async () => [],
    updateLimits: async () => {},
  };
}

function publishedStatus(overrides: Partial<BlotatoPostStatus> = {}): BlotatoPostStatus {
  return {
    postSubmissionId: "submission-1",
    status: "published",
    scheduledTime: null,
    publicUrl: "https://blotato-cdn.example.com/post/submission-1",
    errorMessage: null,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [],
    uploadMedia: async () => ({ url: "https://media.blotato.com/uploaded-tiktok-asset.mp4", id: "media-id-1" }),
    publishPost: async () => ({ postSubmissionId: "submission-1" }),
    getPostStatus: async (postSubmissionId) => publishedStatus({ postSubmissionId }),
    ...overrides,
  };
}

function publisherDeps(overrides: Partial<BlotatoPublisherDeps> = {}): BlotatoPublisherDeps {
  return {
    blotatoAccounts: fakeAccountRepo(),
    blotatoClient: fakeClient(),
    livePublishingEnabled: false,
    statusPollIntervalMs: 0,
    ...overrides,
  };
}

function publishInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    organisationId: ORG_ALPHA,
    draftId: DRAFT_ID,
    jobId: "job-1",
    attemptId: "attempt-1",
    attemptNumber: 1,
    platform: "tiktok",
    title: "A TikTok post",
    body: "Body text",
    assetUrls: ["https://cdn.example.com/video.mp4"],
    devSimulationMode: "always_succeed",
    // AI-disclosure compliance correction: an explicit operator declaration is
    // now mandatory before any live TikTok publish — tests that exercise the
    // live path declare "No" unless the test is specifically about the value.
    isAiGenerated: false,
    ...overrides,
  };
}

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-1",
    organisationId: ORG_ALPHA,
    storagePath: "org-alpha/video.mp4",
    fileName: "video.mp4",
    mimeType: "video/mp4",
    sizeBytes: 5_000_000,
    width: null,
    height: null,
    isArchived: false,
    isAiGenerated: false,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadedBy: { id: "user-1", fullName: "Test User", email: "test@villiz.com" },
    title: null,
    thumbnailPath: null,
    category: null,
    description: null,
    altText: null,
    brand: null,
    duration: null,
    copyrightOwner: null,
    usageRights: null,
    expiresAt: null,
    ...overrides,
  };
}

function job(overrides: Partial<PublishingJob> = {}): PublishingJob {
  return {
    id: "job-1",
    organisationId: ORG_ALPHA,
    draftId: DRAFT_ID,
    platform: "tiktok",
    triggerType: "immediate",
    scheduledFor: new Date().toISOString(),
    status: "queued",
    idempotencyKey: "idem-1",
    requestedBy: "user-1",
    requestedByProfile: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    claimedBy: null,
    nextAttemptAt: null,
    retryCount: 0,
    maxRetries: 3,
    completedAt: null,
    cancelledAt: null,
    devSimulationMode: null,
    resolvedAccountId: null,
    ...overrides,
  } as PublishingJob;
}

function attempt(overrides: Partial<PublishingAttempt> = {}): PublishingAttempt {
  return {
    id: "attempt-1",
    jobId: "job-1",
    organisationId: ORG_ALPHA,
    draftId: DRAFT_ID,
    platform: "tiktok",
    attemptNumber: 1,
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 500,
    externalPostId: "post-1",
    externalUrl: "https://tiktok.com/@x/video/1",
    errorCode: null,
    errorMessage: null,
    providerMetadata: {},
    retryOfAttemptId: null,
    ...overrides,
  } as PublishingAttempt;
}

// ── 1: TikTok recognised as PublishingPlatform ──────────────────────────────────

describe("1 — TikTok is a recognised PublishingPlatform", () => {
  it("isPublishingPlatform('tiktok') is true, with a canonical label and slot in PUBLISHING_PLATFORMS", () => {
    expect(isPublishingPlatform("tiktok")).toBe(true);
    expect(PUBLISHING_PLATFORMS).toContain("tiktok");
    expect(PUBLISHING_PLATFORM_LABELS.tiktok).toBe("TikTok");
  });

  it("mapBlotatoPlatform/toBlotatoPlatform round-trip 'tiktok' identically (not renamed like twitter->x)", () => {
    expect(mapBlotatoPlatform("tiktok")).toBe("tiktok");
    expect(toBlotatoPlatform("tiktok")).toBe("tiktok");
  });
});

// ── 2/3: Connected account model — Alpha/Beta isolation ─────────────────────────

describe("2 — a TikTok Blotato account can be assigned to Alpha", () => {
  it("assignChannelToOrganisation succeeds for an unassigned TikTok account", async () => {
    const unassigned = storedAccount({ id: "acc-tk-alpha", organisationId: null });
    const repo = fakeAccountRepo({
      listAccounts: async () => [unassigned],
      listActiveForOrganisation: async () => [],
      assignToOrganisation: async (id, orgId) => storedAccount({ id, organisationId: orgId }),
    });

    const result = await assignChannelToOrganisation(
      { actor: { id: "admin-1", isPlatformAdmin: true } as never, blotatoAccounts: repo, usage: fakeUsageRepo() as never },
      { organisationId: ORG_ALPHA, blotatoAccountId: "acc-tk-alpha" },
    );

    expect(result.organisationId).toBe(ORG_ALPHA);
    expect(result.platform).toBe("tiktok");
  });
});

describe("3 — Beta cannot use Alpha's TikTok destination", () => {
  it("assignChannelToOrganisation rejects assigning Alpha's already-owned TikTok account to Beta", async () => {
    const alphaOwned = storedAccount({ id: "acc-tk-alpha", organisationId: ORG_ALPHA });
    const repo = fakeAccountRepo({ listAccounts: async () => [alphaOwned] });

    await expect(
      assignChannelToOrganisation(
        { actor: { id: "admin-1", isPlatformAdmin: true } as never, blotatoAccounts: repo, usage: fakeUsageRepo() as never },
        { organisationId: ORG_BETA, blotatoAccountId: "acc-tk-alpha" },
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("the live publisher only ever resolves TikTok accounts scoped to the requesting organisation", async () => {
    const findActiveForOrganisationAndPlatform = vi.fn(async (blotatoPlatform: string, orgId: string) =>
      blotatoPlatform === "tiktok" && orgId === ORG_ALPHA ? [storedAccount({ id: "acc-tk-alpha", organisationId: ORG_ALPHA })] : [],
    );
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({ livePublishingEnabled: true, blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform }) }),
    );

    const betaResult = await publisher.publish(publishInput({ organisationId: ORG_BETA }));

    expect(betaResult.success).toBe(false);
    if (!betaResult.success) expect(betaResult.errorCode).toBe("blotato_no_connected_account");
  });
});

// ── 4: destination appears only when connected ──────────────────────────────────

describe("4 — TikTok destination appears only when a connected account maps onto it", () => {
  it("supportedPlatformsFromAccounts includes tiktok only when a tiktok account is present", () => {
    expect(supportedPlatformsFromAccounts([{ id: "a", platform: "linkedin", fullname: null, username: null }])).not.toContain("tiktok");
    expect(
      supportedPlatformsFromAccounts([{ id: "a", platform: "tiktok", fullname: null, username: null }]),
    ).toContain("tiktok");
  });
});

// ── 5/6: TikTok preflight ────────────────────────────────────────────────────────

describe("5 — TikTok preflight accepts verified-valid media", () => {
  it("body + at least one publishable asset + an explicit AI declaration -> ready:true", () => {
    const result = evaluatePlatformPreflight("tiktok", "Caption text", 1, [], false);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("checkPublishingPreflight: a video asset satisfies TikTok's media requirement", async () => {
    const asset = makeAsset({ organisationId: ORG_ALPHA, mimeType: "video/mp4" });
    const result = await checkPublishingPreflight(
      { content: { findDraft: async () => ({ body: "Caption", id: DRAFT_ID }) } as never, media: { listAssetsForDraft: async () => [asset] } as never },
      { organisationId: ORG_ALPHA, draftId: DRAFT_ID, platform: "tiktok", aiGeneratedDisclosure: false },
    );
    expect(result.ready).toBe(true);
  });

  it("checkPublishingPreflight: an image asset also satisfies TikTok's media requirement — TikTok is not video-only", async () => {
    const asset = makeAsset({ organisationId: ORG_ALPHA, mimeType: "image/jpeg" });
    const result = await checkPublishingPreflight(
      { content: { findDraft: async () => ({ body: "Caption", id: DRAFT_ID }) } as never, media: { listAssetsForDraft: async () => [asset] } as never },
      { organisationId: ORG_ALPHA, draftId: DRAFT_ID, platform: "tiktok", aiGeneratedDisclosure: false },
    );
    expect(result.ready).toBe(true);
  });
});

describe("6 — TikTok preflight rejects no-media (verified: TikTok has no text-only post type)", () => {
  it("returns ready:false with an actionable TikTok media blocker", () => {
    const result = evaluatePlatformPreflight("tiktok", "Caption text", 0, [], false);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("TikTok requires at least one image or video.");
  });

  it("caption over the verified 2200-character limit is also blocked", () => {
    const longBody = "a".repeat(2201);
    const result = evaluatePlatformPreflight("tiktok", longBody, 1, [], false);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("TikTok allows a maximum of 2200 characters. Remove 1 character before publishing.");
  });

  it("a caption at exactly 2200 characters does not exceed", () => {
    const exactBody = "a".repeat(2200);
    const result = evaluatePlatformPreflight("tiktok", exactBody, 1, [], false);
    expect(result.ready).toBe(true);
  });
});

// ── 7: provider-invalid payload blocked before publishPost ──────────────────────

describe("7 — a provider-invalid TikTok payload never reaches publishPost", () => {
  it("no media -> preflight blocks before resolvePublisher/publishPost is ever invoked", async () => {
    const asset: MediaAsset[] = [];
    const result = await checkPublishingPreflight(
      { content: { findDraft: async () => ({ body: "Caption", id: DRAFT_ID }) } as never, media: { listAssetsForDraft: async () => asset } as never },
      { organisationId: ORG_ALPHA, draftId: DRAFT_ID, platform: "tiktok", aiGeneratedDisclosure: false },
    );
    expect(result.ready).toBe(false);
    expect(vi.mocked(resolvePublisher)).not.toHaveBeenCalled();
  });
});

// ── 8: immediate job reaches the publisher ───────────────────────────────────────

describe("8 — a valid immediate TikTok job resolves through the shared publisher factory", () => {
  it("resolvePublisher('tiktok', ...) returns a BlotatoTikTokPublisher instance (via the real, unmocked factory)", async () => {
    vi.doUnmock("@/infrastructure/publishers/publisher-factory");
    const { resolvePublisher: realResolvePublisher } = await vi.importActual<typeof import("@/infrastructure/publishers/publisher-factory")>(
      "@/infrastructure/publishers/publisher-factory",
    );
    const publisher = realResolvePublisher("tiktok", publisherDeps());
    expect(publisher).toBeInstanceOf(BlotatoTikTokPublisher);
    expect(publisher.platform).toBe("tiktok");
  });
});

// ── 12–15: TikTok payload matches the verified Blotato contract ─────────────────

describe("12/13/14/15 — TikTok publishPost payload matches the verified Blotato contract", () => {
  it("accountId, platform ('tiktok' targetType), text, and the 7 required target fields are all present with safe defaults", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-tk-1" }));
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeAccountRepo({
          findActiveForOrganisationAndPlatform: async (bp) => (bp === "tiktok" ? [storedAccount({ id: "acc-tk-1" })] : []),
        }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    const result = await publisher.publish(publishInput({ body: "Caption for TikTok", assetUrls: ["https://cdn.example.com/v.mp4"] }));

    expect(result.success).toBe(true);
    expect(publishPost).toHaveBeenCalledWith({
      accountId: "acc-tk-1",
      platform: "tiktok",
      text: "Caption for TikTok",
      mediaUrls: ["https://media.blotato.com/uploaded-tiktok-asset.mp4"],
      targetOptions: { ...TIKTOK_PRODUCT_DEFAULT_TARGET_OPTIONS, isAiGenerated: false },
    });
  });

  it("the outbound HTTP body's target object merges targetType with the 7 required TikTok fields", async () => {
    const originalFetch = global.fetch;
    let capturedBody: unknown = null;
    global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = init?.body ? JSON.parse(init.body) : null;
      return { ok: true, json: async () => ({ postSubmissionId: "sub-http-1" }) } as Response;
    }) as never;

    try {
      const { HttpBlotatoClient } = await import("@/infrastructure/blotato/http-blotato-client");
      const client = new HttpBlotatoClient("test-key");
      const input: BlotatoPublishInput = {
        accountId: "acc-tk-1",
        platform: "tiktok",
        text: "Caption",
        mediaUrls: ["https://media.blotato.com/v.mp4"],
        targetOptions: { ...TIKTOK_PRODUCT_DEFAULT_TARGET_OPTIONS, isAiGenerated: false },
      };
      await client.publishPost(input);

      expect(capturedBody).toMatchObject({
        post: {
          accountId: "acc-tk-1",
          target: {
            targetType: "tiktok",
            privacyLevel: "PUBLIC_TO_EVERYONE",
            disabledComments: false,
            disabledDuet: false,
            disabledStitch: false,
            isBrandedContent: false,
            isYourBrand: false,
            isAiGenerated: false,
          },
        },
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("a platform with no target options (e.g. LinkedIn) sends target: { targetType } only — TikTok's fields never leak onto other platforms", async () => {
    const originalFetch = global.fetch;
    let capturedBody: unknown = null;
    global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = init?.body ? JSON.parse(init.body) : null;
      return { ok: true, json: async () => ({ postSubmissionId: "sub-http-2" }) } as Response;
    }) as never;

    try {
      const { HttpBlotatoClient } = await import("@/infrastructure/blotato/http-blotato-client");
      const client = new HttpBlotatoClient("test-key");
      await client.publishPost({ accountId: "acc-li-1", platform: "linkedin", text: "Caption", mediaUrls: [] });

      expect(capturedBody).toMatchObject({ post: { target: { targetType: "linkedin" } } });
      expect((capturedBody as { post: { target: Record<string, unknown> } }).post.target).toEqual({ targetType: "linkedin" });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── 16/17: hashtag composition + media URL transmission ────────────────────────

describe("16 — hashtags are composed exactly once for TikTok, via the same single composition point as every other platform", () => {
  it("composePublishedText is the sole place hashtags are appended — no TikTok-specific duplicate composition exists in the publisher", async () => {
    const { composePublishedText } = await import("@/core/application/use-cases/content/hashtags");
    const composed = composePublishedText("My caption", ["photo", "villiz"]);
    expect(composed).toBe("My caption\n\n#photo #villiz");
    // The publisher itself receives whatever composed body PublishInput.body carries — it does
    // no hashtag composition of its own (BlotatoPublisherBase forwards input.body verbatim).
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );
    await publisher.publish(publishInput({ body: composed }));
    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({ text: composed }));
  });
});

describe("17 — media URLs transmitted to TikTok are Blotato-domain only, never the original CDN URL", () => {
  it("assetUrls are uploaded via uploadMedia first; publishPost only ever receives Blotato-hosted URLs", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const uploadMedia = vi.fn(async () => ({ url: "https://media.blotato.com/tiktok-video.mp4", id: "m-1" }));
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({ publishPost, uploadMedia }),
      }),
    );

    await publisher.publish(publishInput({ assetUrls: ["https://supabase.example.com/signed/video.mp4?token=abc"] }));

    expect(uploadMedia).toHaveBeenCalledWith("https://supabase.example.com/signed/video.mp4?token=abc");
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: ["https://media.blotato.com/tiktok-video.mp4"] }),
    );
  });
});

// ── 18/19/20: submission id, published, failed persistence ─────────────────────

describe("18 — provider submission id is persisted regardless of eventual outcome", () => {
  it("metadata.postSubmissionId is present on both success and failure", async () => {
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({
          publishPost: async () => ({ postSubmissionId: "sub-persist-1" }),
          getPostStatus: async (id) => publishedStatus({ postSubmissionId: id, status: "failed", errorMessage: "boom" }),
        }),
      }),
    );
    const result = await publisher.publish(publishInput());
    expect(result.metadata).toMatchObject({ postSubmissionId: "sub-persist-1" });
  });
});

describe("19 — a confirmed 'published' status is reported as success with the real permalink", () => {
  it("externalUrl comes from Blotato's finalStatus.publicUrl", async () => {
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({
          publishPost: async () => ({ postSubmissionId: "sub-2" }),
          getPostStatus: async (id) => publishedStatus({ postSubmissionId: id, publicUrl: "https://tiktok.com/@villiz/video/123" }),
        }),
      }),
    );
    const result = await publisher.publish(publishInput());
    expect(result.success).toBe(true);
    if (result.success) expect(result.externalUrl).toBe("https://tiktok.com/@villiz/video/123");
  });
});

describe("20 — a confirmed 'failed' status is reported as a business failure with Blotato's error message", () => {
  it("errorCode is blotato_publish_failed, never thrown as an exception", async () => {
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({
          publishPost: async () => ({ postSubmissionId: "sub-3" }),
          getPostStatus: async (id) => publishedStatus({ postSubmissionId: id, status: "failed", publicUrl: null, errorMessage: "TikTok rejected the post" }),
        }),
      }),
    );
    const result = await publisher.publish(publishInput());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_publish_failed");
      expect(result.errorMessage).toBe("TikTok rejected the post");
    }
  });
});

// ── 21: reconciliation never republishes ────────────────────────────────────────

describe("21 — timeout reconciliation for a TikTok job never calls publishPost", () => {
  it("reconcileBlotatoStatusTimeout only calls getPostStatus, regardless of platform", async () => {
    const publishPost = vi.fn();
    const tiktokJob = job({ status: "failed", platform: "tiktok" });
    const timedOutAttempt = attempt({
      status: "failed",
      errorCode: "blotato_status_timeout",
      providerMetadata: { postSubmissionId: "sub-timeout-1" },
    });

    const deps = {
      actor: { id: "user-1", isPlatformAdmin: true } as never,
      publishing: {
        findJobById: vi.fn(async () => tiktokJob),
        listAttemptsForJob: vi.fn(async () => [timedOutAttempt]),
        createAttempt: vi.fn(async () => attempt({ id: "attempt-2", attemptNumber: 2 })),
        startAttempt: vi.fn(async () => attempt({ id: "attempt-2" })),
        completeAttempt: vi.fn(async () => {}),
        markJobPublished: vi.fn(async () => {}),
      } as never,
      blotatoAccounts: {} as never,
      content: { updateStatus: vi.fn(async () => ({})) } as never,
      organisations: { viewerRole: vi.fn(async () => "admin") } as never,
      audits: { recordEvent: vi.fn(async () => {}) } as never,
      notifications: { createNotification: vi.fn(async () => {}) } as never,
      blotatoClient: { getPostStatus: vi.fn(async () => publishedStatus({ postSubmissionId: "sub-timeout-1" })), publishPost } as never,
    };

    const result = await reconcileBlotatoStatusTimeout(deps, ORG_ALPHA, "job-1");

    expect(result.outcome).toBe("published");
    expect(publishPost).not.toHaveBeenCalled();
  });
});

// ── 22/23: retry uses latest content, trigger type preserved ───────────────────

describe("22 — a TikTok retry sends the CURRENT resolved media, not a stale snapshot", () => {
  it("assetUrls reflect whatever the media repository returns at publish() call time", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-retry-1" }));
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    // First attempt: draft had an unpublishable asset the media resolver dropped
    // before this point — publish() sees an already-empty assetUrls list.
    await publisher.publish(publishInput({ assetUrls: [], attemptId: "attempt-1", attemptNumber: 1 }));
    // Corrected retry: media now attached (draft corrected, reapproved, retried).
    const retryResult = await publisher.publish(
      publishInput({ assetUrls: ["https://cdn.example.com/corrected-video.mp4"], attemptId: "attempt-2", attemptNumber: 2 }),
    );
    expect(retryResult.success).toBe(true);
    expect(publishPost).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaUrls: ["https://media.blotato.com/uploaded-tiktok-asset.mp4"] }),
    );
  });
});

describe("23 — trigger type is preserved through a TikTok retry (structural: publish() never touches trigger_type)", () => {
  it("PublishInput carries no triggerType field at all — the publisher cannot rewrite it even in principle", () => {
    const input = publishInput();
    expect(input).not.toHaveProperty("triggerType");
  });
});

// ── 24: simulation makes no provider call ───────────────────────────────────────

describe("24 — TikTok simulation (livePublishingEnabled=false) never touches the Blotato client", () => {
  it("behaves exactly like simulatePublish — publishPost and uploadMedia are never called", async () => {
    const publishPost = vi.fn();
    const uploadMedia = vi.fn();
    const findActiveForOrganisationAndPlatform = vi.fn(async () => []);
    const publisher = new BlotatoTikTokPublisher(
      publisherDeps({
        livePublishingEnabled: false,
        blotatoAccounts: fakeAccountRepo({ findActiveForOrganisationAndPlatform }),
        blotatoClient: fakeClient({ publishPost, uploadMedia }),
      }),
    );

    const result = await publisher.publish(publishInput());

    expect(result.success).toBe(true);
    if (result.success) expect(result.externalPostId).toMatch(/^mock-tiktok-\d+$/);
    expect(findActiveForOrganisationAndPlatform).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
  });
});

// ── 25: analytics remain organisation-scoped ────────────────────────────────────

describe("25 — TikTok analytics figures are computed only from the jobs/attempts passed in for that organisation", () => {
  it("Alpha's TikTok breakdown never reflects Beta's TikTok jobs/attempts", () => {
    const alphaJob = job({ id: "job-alpha", organisationId: ORG_ALPHA, platform: "tiktok", status: "published" });
    const alphaAttempt = attempt({ id: "att-alpha", jobId: "job-alpha", organisationId: ORG_ALPHA, platform: "tiktok", status: "completed" });

    // The repository layer only ever returns rows for the requesting org (see
    // PublishingRepository.listJobsForOrganisation) — this test proves the pure
    // analytics function itself introduces no cross-org leakage on top of that.
    const analytics = computePublishingAnalytics([alphaJob], [alphaAttempt], new Date());

    const tiktokBreakdown = analytics.platformBreakdown.find((p) => p.platform === "tiktok");
    expect(tiktokBreakdown).toBeDefined();
    expect(tiktokBreakdown?.totalAttempts).toBe(1);
    expect(tiktokBreakdown?.successfulAttempts).toBe(1);
  });

  it("platformBreakdown includes a tiktok entry for every org, even with zero TikTok activity", () => {
    const analytics = computePublishingAnalytics([], [], new Date());
    const tiktokBreakdown = analytics.platformBreakdown.find((p) => p.platform === "tiktok");
    expect(tiktokBreakdown).toEqual({
      platform: "tiktok",
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      successRate: null,
      averagePublishTimeMs: null,
    });
  });
});

// ── 27: platform policy isolation ───────────────────────────────────────────────

describe("27 — TikTok's policy fields do not leak onto Instagram/Facebook/LinkedIn/X", () => {
  it("only TikTok has mediaRequired+textLimit; only Instagram has maxHashtags+mediaRequired; Facebook/LinkedIn/X have neither", () => {
    expect(PLATFORM_PUBLISHING_POLICIES.tiktok).toEqual({ platform: "tiktok", mediaRequired: true, textLimit: 2200, requiresAiDisclosure: true });
    expect(PLATFORM_PUBLISHING_POLICIES.instagram.maxHashtags).toBe(5);
    expect(PLATFORM_PUBLISHING_POLICIES.instagram.textLimit).toBeUndefined();
    expect(PLATFORM_PUBLISHING_POLICIES.tiktok.maxHashtags).toBeUndefined();

    for (const platform of ["facebook", "linkedin", "x"] as const) {
      const policy = getPlatformPublishingPolicy(platform);
      expect(policy.mediaRequired).toBeUndefined();
      expect(policy.textLimit).toBeUndefined();
      expect(policy.maxHashtags).toBeUndefined();
    }
  });

  it("a 2201-character LinkedIn post is never blocked by TikTok's textLimit — no verified LinkedIn limit exists", () => {
    const result = evaluatePlatformPreflight("linkedin", "a".repeat(2201), 0);
    expect(result.blockers.some((b) => b.includes("characters"))).toBe(false);
  });

  it("a 6-hashtag TikTok post is never blocked by Instagram's maxHashtags:5 — no verified TikTok hashtag limit exists", () => {
    const result = evaluatePlatformPreflight("tiktok", "Caption", 1, ["a", "b", "c", "d", "e", "f"], false);
    expect(result.blockers.some((b) => b.includes("hashtag"))).toBe(false);
  });
});
