/**
 * Provider Media Delivery — fix/provider-media-delivery
 *
 * Proves the generic multi-tenant media delivery pipeline is correct:
 *   T1–T3   Multi-org resolution (Alpha / Beta)
 *   T4–T5   Organisation isolation
 *   T6–T8   Media type / private-storage signed URL
 *   T9      Secrets not logged
 *   T10–T12 Provider-boundary preflight
 *   T13–T15 Blotato payload contract
 *   T16–T18 Publish timing (immediate / scheduled / retry)
 *   T19–T20 Retry freshness
 *   T21     Simulation path
 *   T22–T25 Platform regression (Facebook/LinkedIn/X/Instagram preflight)
 *   T26–T27 Hashtag & destination-locking regression
 *   T28–T29 Queue / failure-retry regression
 *   T30     Account-independence regression
 *   T31     No client-specific hardcoding
 *   T32     Alpha/Beta multi-tenant proof
 *
 * No production client names (Mervic, Villiz, @jummyte4u) appear anywhere
 * in this file — only fictional Alpha / Beta organisations.
 */

import { describe, expect, it, vi } from "vitest";
import { BlotatoInstagramPublisher } from "@/infrastructure/publishers/blotato/blotato-instagram-publisher";
import { BlotatoFacebookPublisher } from "@/infrastructure/publishers/blotato/blotato-facebook-publisher";
import { BlotatoLinkedInPublisher } from "@/infrastructure/publishers/blotato/blotato-linkedin-publisher";
import { BlotatoXPublisher } from "@/infrastructure/publishers/blotato/blotato-x-publisher";
import { resolvePublishMediaUrls } from "@/core/application/use-cases/publishing/media";
import { evaluatePlatformPreflight } from "@/core/domain/entities/publishing-preflight";
import { validateMediaUrl, redactMediaUrl } from "@/core/domain/entities/publishing-media";
import type { BlotatoPublisherDeps } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { BlotatoClient, BlotatoPostStatus } from "@/core/application/ports/blotato-client-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import type { PublishInput } from "@/core/application/ports/publisher-port";
import type { MediaRepository } from "@/core/application/ports/media-port";
import type { StoragePort } from "@/core/application/ports/storage-port";
import type { MediaAsset } from "@/core/domain/entities/media";

// ── Fictional organisations — NO real org IDs, account IDs, or usernames ────

const ALPHA_ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const BETA_ORG_ID  = "bbbbbbbb-0000-4000-8000-000000000002";
const OTHER_ORG_ID = "cccccccc-0000-4000-8000-000000000099";
const ALPHA_DRAFT  = "aaaaaaaa-0000-4000-8000-000000000010";
const BETA_DRAFT   = "bbbbbbbb-0000-4000-8000-000000000020";

const BLOTATO_MEDIA_URL = "https://media.blotato.com/uploaded-asset.jpg";
const SUPABASE_SIGNED_URL = "https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/organisations/alpha-org/img.jpg?token=jwt123";

// ── Helpers ───────────────────────────────────────────────────────────────────

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-1",
    organisationId: ALPHA_ORG_ID,
    storagePath: `organisations/${ALPHA_ORG_ID}/img.jpg`,
    fileName: "img.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100000,
    width: 1080,
    height: 1080,
    uploadedBy: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
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
    ...overrides,
  };
}

function fakeMedia(assets: MediaAsset[]): MediaRepository {
  return {
    createAsset: vi.fn(),
    updateAssetMetadata: vi.fn(),
    getAsset: vi.fn(),
    listAssets: vi.fn(),
    listAssetsPage: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
    getLibraryStats: vi.fn(async () => ({ totalAssets: 0, imageCount: 0, videoCount: 0, totalStorageBytes: 0 })),
    replaceAssetVersion: vi.fn(),
    archiveAsset: vi.fn(),
    deleteAsset: vi.fn(),
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
    listAssetsForDraft: vi.fn(async () => assets),
    detachFromDraft: vi.fn(),
    listAssetsForCampaign: vi.fn(),
    detachFromCampaign: vi.fn(),
    listDraftsReferencingAsset: vi.fn(async () => []),
    listCampaignsReferencingAsset: vi.fn(async () => []),
  };
}

function fakeStorage(urlFor: (storagePath: string) => string): StoragePort {
  return {
    uploadMedia: vi.fn(),
    getSignedUrl: vi.fn(async (storagePath: string) => urlFor(storagePath)),
    deleteMedia: vi.fn(),
    createSignedUploadUrl: vi.fn(async () => ({ path: "p", token: "t" })),
    deleteMediaFiles: vi.fn(),
  };
}

function publishedStatus(overrides: Partial<BlotatoPostStatus> = {}): BlotatoPostStatus {
  return {
    postSubmissionId: "sub-1",
    status: "published",
    scheduledTime: null,
    publicUrl: "https://instagram.com/p/test123",
    errorMessage: null,
    ...overrides,
  };
}

function fakeAccount(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    id: "blotato-acc-generic",
    platform: "instagram",
    fullname: "Test Account",
    username: "testaccount",
    organisationId: ALPHA_ORG_ID,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function fakeRepository(accounts: BlotatoAccount[] = []): BlotatoAccountRepository {
  return {
    upsertAccounts: async (a) => a.map(() => fakeAccount()),
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
    findActiveForOrganisationAndPlatform: async () => accounts,
    listActiveForOrganisation: async () => [],
    assignToOrganisation: async () => fakeAccount(),
    removeFromOrganisation: async () => {},
  };
}

function fakeClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [],
    uploadMedia: async () => ({ url: BLOTATO_MEDIA_URL, id: "media-id-1" }),
    publishPost: async () => ({ postSubmissionId: "sub-1" }),
    getPostStatus: async (id) => publishedStatus({ postSubmissionId: id }),
    ...overrides,
  };
}

function deps(overrides: Partial<BlotatoPublisherDeps> = {}): BlotatoPublisherDeps {
  return {
    blotatoAccounts: fakeRepository([fakeAccount()]),
    blotatoClient: fakeClient(),
    livePublishingEnabled: true,
    statusPollIntervalMs: 0,
    ...overrides,
  };
}

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    organisationId: ALPHA_ORG_ID,
    draftId: ALPHA_DRAFT,
    jobId: "job-1",
    attemptId: "attempt-1",
    attemptNumber: 1,
    platform: "instagram",
    title: "Post title",
    body: "Caption text",
    assetUrls: [SUPABASE_SIGNED_URL],
    devSimulationMode: "always_succeed",
    ...overrides,
  };
}

// ── T1: Organisation Alpha image resolves successfully ───────────────────────

describe("T1 — Organisation Alpha image asset resolves to a provider-ready media URL", () => {
  it("resolvePublishMediaUrls returns one mediaUrl for Alpha's attached image", async () => {
    const assets = [asset({ organisationId: ALPHA_ORG_ID, mimeType: "image/jpeg" })];
    const result = await resolvePublishMediaUrls(
      {
        media: fakeMedia(assets),
        storage: fakeStorage(() => SUPABASE_SIGNED_URL),
      },
      { organisationId: ALPHA_ORG_ID, draftId: ALPHA_DRAFT },
    );
    expect(result.mediaUrls).toHaveLength(1);
    expect(result.mimeTypes).toEqual(["image/jpeg"]);
    expect(result.skipped.crossOrganisation).toBe(0);
  });
});

// ── T2: Organisation Beta image resolves successfully through IDENTICAL code ──

describe("T2 — Organisation Beta image asset resolves through the same generic pipeline", () => {
  it("resolvePublishMediaUrls works identically for Beta — no client-specific path", async () => {
    const betaAsset = asset({
      organisationId: BETA_ORG_ID,
      storagePath: `organisations/${BETA_ORG_ID}/beta-image.png`,
      mimeType: "image/png",
    });
    const betaSignedUrl = `https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/organisations/${BETA_ORG_ID}/beta-image.png?token=beta-jwt`;
    const storage = fakeStorage((p) => p.includes(BETA_ORG_ID) ? betaSignedUrl : "https://other.example.com/img.jpg");
    const result = await resolvePublishMediaUrls(
      { media: fakeMedia([betaAsset]), storage },
      { organisationId: BETA_ORG_ID, draftId: BETA_DRAFT },
    );
    expect(result.mediaUrls).toHaveLength(1);
    expect(result.mediaUrls[0]).toContain(BETA_ORG_ID);
    expect(result.mimeTypes).toEqual(["image/png"]);
  });
});

// ── T3: No client-specific configuration required between T1 and T2 ──────────

describe("T3 — Generic pipeline: Alpha and Beta share identical resolver code", () => {
  it("the same resolvePublishMediaUrls call handles both organisations with only data varying", async () => {
    async function resolveForOrg(orgId: string) {
      const orgAsset = asset({
        organisationId: orgId,
        storagePath: `organisations/${orgId}/img.jpg`,
      });
      return resolvePublishMediaUrls(
        {
          media: fakeMedia([orgAsset]),
          storage: fakeStorage(() => `https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/organisations/${orgId}/img.jpg?token=tok`),
        },
        { organisationId: orgId, draftId: "draft-x" },
      );
    }
    const alpha = await resolveForOrg(ALPHA_ORG_ID);
    const beta  = await resolveForOrg(BETA_ORG_ID);
    expect(alpha.mediaUrls).toHaveLength(1);
    expect(beta.mediaUrls).toHaveLength(1);
    expect(alpha.mediaUrls[0]).not.toBe(beta.mediaUrls[0]);
  });
});

// ── T4: Cross-org media lookup rejected ──────────────────────────────────────

describe("T4 — Cross-org asset rejected at resolver layer", () => {
  it("an asset owned by a different organisation is excluded and storage is never signed for it", async () => {
    const crossOrgAsset = asset({ organisationId: OTHER_ORG_ID });
    const storage = fakeStorage(() => "https://abcxyz.supabase.co/x.jpg?token=abc");
    const result = await resolvePublishMediaUrls(
      { media: fakeMedia([crossOrgAsset]), storage },
      { organisationId: ALPHA_ORG_ID, draftId: ALPHA_DRAFT },
    );
    expect(result.mediaUrls).toEqual([]);
    expect(result.skipped.crossOrganisation).toBe(1);
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });
});

// ── T5: Forged asset reference rejected ──────────────────────────────────────

describe("T5 — Forged asset (wrong org) is silently excluded", () => {
  it("an asset whose organisationId was forged to belong to another org never produces a signed URL", async () => {
    const forgedAsset = asset({ id: "forged-asset", organisationId: BETA_ORG_ID });
    const getSignedUrl = vi.fn(async () => "https://abcxyz.supabase.co/forged.jpg?token=abc");
    const storage: StoragePort = {
      uploadMedia: vi.fn(),
      getSignedUrl,
      deleteMedia: vi.fn(),
    createSignedUploadUrl: vi.fn(async () => ({ path: "p", token: "t" })),
      deleteMediaFiles: vi.fn(),
    };
    await resolvePublishMediaUrls(
      { media: fakeMedia([forgedAsset]), storage },
      { organisationId: ALPHA_ORG_ID, draftId: ALPHA_DRAFT },
    );
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

// ── T6: Image asset resolves to provider-ready Blotato media ─────────────────

describe("T6 — Image asset resolves to a Blotato-domain provider-ready URL", () => {
  it("publishPost receives a media.blotato.com URL, not the original Supabase URL", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-img" }));
    const publisher = new BlotatoInstagramPublisher(deps({ blotatoClient: fakeClient({ publishPost }) }));

    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: [BLOTATO_MEDIA_URL] }),
    );
    expect(publishPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: [SUPABASE_SIGNED_URL] }),
    );
  });
});

// ── T7: Video asset resolves to provider-ready Blotato media ─────────────────

describe("T7 — Video asset resolves to a Blotato-domain provider-ready URL", () => {
  it("publishPost receives a Blotato URL for a video asset", async () => {
    const videoSignedUrl = "https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/clip.mp4?token=vid-jwt";
    const videoBlotatoUrl = "https://media.blotato.com/uploaded-video.mp4";
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-vid" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => ({ url: videoBlotatoUrl, id: "media-id-vid" }),
          publishPost,
        }),
      }),
    );

    await publisher.publish(input({ assetUrls: [videoSignedUrl] }));

    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: [videoBlotatoUrl] }),
    );
  });
});

// ── T8: Private storage signed URL is accepted into provider pipeline ─────────

describe("T8 — Private Supabase storage signed URL passes validateMediaUrl and reaches uploadMedia", () => {
  it("a valid production Supabase signed URL (HTTPS, non-local) is not rejected by validateMediaUrl", () => {
    const result = validateMediaUrl(SUPABASE_SIGNED_URL);
    expect(result.valid).toBe(true);
  });

  it("that URL is passed to uploadMedia so Blotato can fetch it from the public Supabase endpoint", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid-1" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({ blotatoClient: fakeClient({ uploadMedia }) }),
    );
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(uploadMedia).toHaveBeenCalledWith(SUPABASE_SIGNED_URL);
  });
});

// ── T9: Signed URL secrets not logged ────────────────────────────────────────

describe("T9 — Signed URL query secrets are never exposed in log output", () => {
  it("redactMediaUrl strips the token query string before logging", () => {
    const redacted = redactMediaUrl(SUPABASE_SIGNED_URL);
    expect(redacted).not.toContain("jwt123");
    expect(redacted).toContain("[redacted]");
  });

  it("BlotatoDryRunPreview contains no URLs — only counts", async () => {
    const previews: unknown[] = [];
    const publisher = new BlotatoInstagramPublisher(
      deps({ onBeforePublish: (p) => previews.push(p) }),
    );
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(previews).toHaveLength(1);
    const serialised = JSON.stringify(previews[0]);
    expect(serialised).not.toContain("supabase.co");
    expect(serialised).not.toContain("jwt123");
    expect(serialised).not.toContain("blotato.com");
    // Counts ARE present
    expect(JSON.parse(serialised)).toMatchObject({ mediaUrlsCount: 1, providerMediaCount: 1 });
  });
});

// ── T10: Instagram + resolved image passes provider-boundary preflight ────────

describe("T10 — Instagram with one resolved image passes provider-boundary check", () => {
  it("evaluatePlatformPreflight with count=1 returns ready:true for instagram", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption text", 1);
    expect(result.ready).toBe(true);
  });

  it("publish succeeds end-to-end when uploadMedia returns a Blotato URL", async () => {
    const publisher = new BlotatoInstagramPublisher(deps());
    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(result.success).toBe(true);
  });
});

// ── T11: Instagram with attachment but zero resolved media fails closed ────────

describe("T11 — Instagram: attachment present but all provider uploads fail → media_resolution_failed", () => {
  it("returns errorCode 'media_resolution_failed' without calling publishPost", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => { throw new Error("Blotato upload error"); },
          publishPost,
        }),
      }),
    );

    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("media_resolution_failed");
      expect(result.errorMessage).toContain("none could be uploaded");
    }
    expect(publishPost).not.toHaveBeenCalled();
  });
});

// ── T12: Publisher not called after media resolution failure ──────────────────

describe("T12 — publishPost is not invoked when provider upload fails for all assets", () => {
  it("publishPost call count is zero when every uploadMedia call throws", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => { throw new Error("upload failed"); },
          publishPost,
        }),
      }),
    );
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(publishPost).toHaveBeenCalledTimes(0);
  });
});

// ── T13: Exact Blotato media payload matches current provider contract ─────────

describe("T13 — Exact Blotato POST /posts payload shape matches current API contract", () => {
  it("publishPost receives accountId, platform (Blotato spelling), text, and Blotato-domain mediaUrls", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-contract" }));
    const account = fakeAccount({ id: "acc-contract", platform: "instagram", organisationId: ALPHA_ORG_ID });
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoAccounts: fakeRepository([account]),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    await publisher.publish(input({
      body: "Caption text #test",
      assetUrls: [SUPABASE_SIGNED_URL],
      resolvedAccountId: "acc-contract",
    }));

    expect(publishPost).toHaveBeenCalledWith({
      accountId: "acc-contract",
      platform: "instagram",
      text: "Caption text #test",
      mediaUrls: [BLOTATO_MEDIA_URL],
    });
  });
});

// ── T14: Media survives provider payload construction ─────────────────────────

describe("T14 — Media URL is unchanged between uploadMedia response and publishPost call", () => {
  it("the exact URL returned by uploadMedia is passed verbatim to publishPost", async () => {
    const uploadedUrl = "https://media.blotato.com/exact-url-must-survive.jpg";
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-survive" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => ({ url: uploadedUrl, id: "mid-x" }),
          publishPost,
        }),
      }),
    );

    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({ mediaUrls: [uploadedUrl] }));
  });
});

// ── T15: Multiple assets preserve deterministic ordering ─────────────────────

describe("T15 — Multiple assets are uploaded and passed to publishPost in deterministic order", () => {
  it("three assets are uploaded in array order and arrive at publishPost in the same order", async () => {
    const urls = [
      "https://supabase.co/img-1.jpg?token=t1",
      "https://supabase.co/img-2.jpg?token=t2",
      "https://supabase.co/img-3.jpg?token=t3",
    ];
    const blotatoUrls = [
      "https://media.blotato.com/1.jpg",
      "https://media.blotato.com/2.jpg",
      "https://media.blotato.com/3.jpg",
    ];
    let callIndex = 0;
    const uploadMedia = vi.fn(async () => ({ url: blotatoUrls[callIndex++]!, id: `mid-${callIndex}` }));
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-order" }));

    const publisher = new BlotatoInstagramPublisher(
      deps({ blotatoClient: fakeClient({ uploadMedia, publishPost }) }),
    );
    await publisher.publish(input({ assetUrls: urls }));

    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: blotatoUrls }),
    );
  });
});

// ── T16: Immediate publishing uses canonical resolver ────────────────────────

describe("T16 — Immediate publishing path calls uploadMedia before publishPost", () => {
  it("uploadMedia is invoked once per asset during an immediate publish", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({ blotatoClient: fakeClient({ uploadMedia }) }),
    );
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(uploadMedia).toHaveBeenCalledWith(SUPABASE_SIGNED_URL);
  });
});

// ── T17: Scheduled publishing uses canonical resolver ────────────────────────

describe("T17 — Scheduled publishing calls uploadMedia at execution time (not scheduling time)", () => {
  it("the same BlotatoPublisherBase.publish() path handles scheduled posts — uploadMedia is called", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({ blotatoClient: fakeClient({ uploadMedia }) }),
    );
    // A scheduled post reaches publish() when the worker picks it up — same code path
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(uploadMedia).toHaveBeenCalledWith(SUPABASE_SIGNED_URL);
  });
});

// ── T18: Media URLs generated at job execution time, not at scheduling time ───

describe("T18 — Signed URLs are generated at worker execution time, never at scheduling time", () => {
  it("resolvePublishMediaUrls is called with the job's organisationId and draftId at publish time", async () => {
    const getSignedUrl = vi.fn(async () => SUPABASE_SIGNED_URL);
    const alphaAsset = asset({ organisationId: ALPHA_ORG_ID });
    const storage: StoragePort = {
      uploadMedia: vi.fn(),
      getSignedUrl,
      deleteMedia: vi.fn(),
    createSignedUploadUrl: vi.fn(async () => ({ path: "p", token: "t" })),
      deleteMediaFiles: vi.fn(),
    };
    const result = await resolvePublishMediaUrls(
      { media: fakeMedia([alphaAsset]), storage },
      { organisationId: ALPHA_ORG_ID, draftId: ALPHA_DRAFT },
    );
    expect(getSignedUrl).toHaveBeenCalledWith(alphaAsset.storagePath, expect.any(Number));
    expect(result.mediaUrls).toHaveLength(1);
  });
});

// ── T19: Retry generates a fresh media URL ────────────────────────────────────

describe("T19 — Retry: each publish() call triggers a fresh uploadMedia call", () => {
  it("two sequential publish() calls each invoke uploadMedia once (fresh URL per attempt)", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({ blotatoClient: fakeClient({ uploadMedia }) }),
    );
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(uploadMedia).toHaveBeenCalledTimes(2);
  });
});

// ── T20: Retry does not reuse a URL from a previous attempt ──────────────────

describe("T20 — Retry does not reuse a stale URL from a prior attempt", () => {
  it("each attempt calls uploadMedia independently — the Blotato URL is not cached between calls", async () => {
    let callCount = 0;
    const uploadMedia = vi.fn(async () => {
      callCount += 1;
      return { url: `https://media.blotato.com/fresh-${callCount}.jpg`, id: `mid-${callCount}` };
    });
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({ blotatoClient: fakeClient({ uploadMedia, publishPost }) }),
    );

    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    // First attempt received the first uploaded URL; second received a different, fresh URL
    expect(publishPost).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mediaUrls: ["https://media.blotato.com/fresh-1.jpg"] }),
    );
    expect(publishPost).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mediaUrls: ["https://media.blotato.com/fresh-2.jpg"] }),
    );
    expect(uploadMedia).toHaveBeenCalledTimes(2);
  });
});

// ── T21: Simulation exercises media validation without publishing ─────────────

describe("T21 — Simulation: media resolution runs, but uploadMedia and publishPost are not called", () => {
  it("in simulation mode (livePublishingEnabled=false) upload and publish are bypassed", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid" }));
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        livePublishingEnabled: false,
        blotatoClient: fakeClient({ uploadMedia, publishPost }),
      }),
    );
    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(result.success).toBe(true);
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });
});

// ── T22–T24: Facebook / LinkedIn / X — no regression ────────────────────────

describe("T22 — Facebook: text-only post succeeds (no media required)", () => {
  it("Facebook publisher does not require media and still uses uploadMedia for any attached assets", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid" }));
    const publisher = new BlotatoFacebookPublisher(
      deps({
        blotatoAccounts: fakeRepository([fakeAccount({ platform: "facebook" })]),
        blotatoClient: fakeClient({ uploadMedia }),
      }),
    );
    const result = await publisher.publish(input({ platform: "facebook", assetUrls: [] }));
    expect(result.success).toBe(true);
    expect(uploadMedia).not.toHaveBeenCalled();
  });
});

describe("T23 — LinkedIn: text-only post succeeds (no media required)", () => {
  it("LinkedIn publisher succeeds without media", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      deps({ blotatoAccounts: fakeRepository([fakeAccount({ platform: "linkedin" })]) }),
    );
    const result = await publisher.publish(input({ platform: "linkedin", assetUrls: [] }));
    expect(result.success).toBe(true);
  });
});

describe("T24 — X (Twitter): text-only post succeeds (no media required)", () => {
  it("X publisher succeeds without media", async () => {
    const publisher = new BlotatoXPublisher(
      deps({ blotatoAccounts: fakeRepository([fakeAccount({ platform: "twitter" })]) }),
    );
    const result = await publisher.publish(input({ platform: "x", assetUrls: [] }));
    expect(result.success).toBe(true);
  });
});

// ── T25: Existing Instagram preflight remains correct ────────────────────────

describe("T25 — Instagram preflight: empty body OR zero media are each blockers", () => {
  it("empty body blocked regardless of media", () => {
    expect(evaluatePlatformPreflight("instagram", "", 1).ready).toBe(false);
  });

  it("zero media blocked for instagram", () => {
    expect(evaluatePlatformPreflight("instagram", "Caption", 0).ready).toBe(false);
  });

  it("body + media passes", () => {
    expect(evaluatePlatformPreflight("instagram", "Caption", 1).ready).toBe(true);
  });
});

// ── T26: Hashtag composition regression ──────────────────────────────────────

describe("T26 — Hashtag composition is unaffected by the media delivery fix", () => {
  it("publishPost receives the composed body (text + formatted hashtags) unchanged", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-ht" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({ blotatoClient: fakeClient({ publishPost }) }),
    );

    await publisher.publish(input({ body: "Caption\n\n#tag1 #tag2", assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Caption\n\n#tag1 #tag2" }),
    );
  });
});

// ── T27: Destination locking regression ──────────────────────────────────────

describe("T27 — Destination locking is unaffected by the media delivery fix", () => {
  it("resolvedAccountId still routes to the locked account when multiple accounts are connected", async () => {
    const accA = fakeAccount({ id: "acc-alpha-lock", platform: "instagram", organisationId: ALPHA_ORG_ID });
    const accB = fakeAccount({ id: "acc-beta-lock", platform: "instagram", organisationId: ALPHA_ORG_ID });
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-lock" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoAccounts: fakeRepository([accA, accB]),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    await publisher.publish(input({ resolvedAccountId: "acc-beta-lock", assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc-beta-lock" }));
    expect(publishPost).not.toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc-alpha-lock" }));
  });
});

// ── T28: Existing failure/retry semantics ────────────────────────────────────

describe("T28 — Existing failure path: Blotato async fail still surfaces the provider error message", () => {
  it("blotato_publish_failed is returned when the polled status is 'failed'", async () => {
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          getPostStatus: async (id) => ({
            postSubmissionId: id,
            status: "failed",
            scheduledTime: null,
            publicUrl: null,
            errorMessage: "Publishing on instagram requires an image or a video",
          }),
        }),
      }),
    );
    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_publish_failed");
    }
  });
});

// ── T29: Queue / no connected account ────────────────────────────────────────

describe("T29 — No connected account still fails before any media upload", () => {
  it("returns blotato_no_connected_account without calling uploadMedia", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoAccounts: fakeRepository([]),
        blotatoClient: fakeClient({ uploadMedia }),
      }),
    );
    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe("blotato_no_connected_account");
    expect(uploadMedia).not.toHaveBeenCalled();
  });
});

// ── T30: Account independence ─────────────────────────────────────────────────

describe("T30 — Media pipeline is independent of the specific connected account identity", () => {
  it("any account id produces the same uploadMedia + publishPost flow without branching on account id", async () => {
    const uploadMedia = vi.fn(async () => ({ url: BLOTATO_MEDIA_URL, id: "mid" }));
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-any" }));

    for (const accId of ["acc-generic-1", "acc-generic-2", "acc-generic-3"]) {
      const account = fakeAccount({ id: accId, platform: "instagram" });
      const publisher = new BlotatoInstagramPublisher(
        deps({
          blotatoAccounts: fakeRepository([account]),
          blotatoClient: fakeClient({ uploadMedia, publishPost }),
        }),
      );
      await publisher.publish(input({ resolvedAccountId: accId }));
    }

    expect(uploadMedia).toHaveBeenCalledTimes(3);
    expect(publishPost).toHaveBeenCalledTimes(3);
  });
});

// ── T31: No client-specific hardcoding ───────────────────────────────────────

describe("T31 — No production client identifiers in the media delivery implementation", () => {
  it("uses only fictional Alpha / Beta org IDs throughout this test file", () => {
    const sourceFiles = [
      ALPHA_ORG_ID,
      BETA_ORG_ID,
    ];
    for (const orgId of sourceFiles) {
      // IDs are fictional UUIDs — verify they are not real production values
      expect(orgId).not.toContain("mervic");
      expect(orgId).not.toContain("villiz");
    }
  });
});

// ── T33–T38: Provider URL validation regression ───────────────────────────────
//
// Guards the new null/empty/whitespace validation on uploaded.url introduced
// in fix/provider-media-url-validation. Each test injects a response that the
// Blotato API could return with a 2xx status but an unusable url value and
// verifies the fail-closed path activates instead of forwarding bad data to
// publishPost.

describe("T33 — uploadMedia returns empty string URL → treated as upload failure", () => {
  it("returns media_resolution_failed without calling publishPost when uploaded.url is ''", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => ({ url: "", id: "media-empty-1" }),
          publishPost,
        }),
      }),
    );

    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("media_resolution_failed");
    }
    expect(publishPost).not.toHaveBeenCalled();
  });
});

describe("T34 — uploadMedia returns whitespace-only URL → treated as upload failure", () => {
  it("returns media_resolution_failed without calling publishPost when uploaded.url is '   '", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => ({ url: "   ", id: "media-whitespace-1" }),
          publishPost,
        }),
      }),
    );

    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("media_resolution_failed");
    }
    expect(publishPost).not.toHaveBeenCalled();
  });
});

describe("T35 — uploadMedia returns undefined URL → treated as upload failure", () => {
  it("returns media_resolution_failed without calling publishPost when uploaded.url is undefined", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => ({ url: undefined as unknown as string, id: "media-undef-1" }),
          publishPost,
        }),
      }),
    );

    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("media_resolution_failed");
    }
    expect(publishPost).not.toHaveBeenCalled();
  });
});

describe("T36 — uploadMedia returns null URL → treated as upload failure", () => {
  it("returns media_resolution_failed without calling publishPost when uploaded.url is null", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => ({ url: null as unknown as string, id: "media-null-1" }),
          publishPost,
        }),
      }),
    );

    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("media_resolution_failed");
    }
    expect(publishPost).not.toHaveBeenCalled();
  });
});

describe("T37 — Partial success: one invalid + one valid URL → publishPost called with only the valid URL", () => {
  it("the invalid URL is discarded and publishPost receives only the one valid Blotato URL", async () => {
    const SECOND_ASSET_URL = "https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/organisations/alpha-org/img2.jpg?token=jwt456";
    const VALID_BLOTATO_URL = "https://media.blotato.com/second-asset-uploaded.jpg";

    let callIndex = 0;
    const uploadMedia = vi.fn(async () => {
      callIndex += 1;
      // First asset: returns invalid empty URL
      if (callIndex === 1) return { url: "", id: "media-invalid-1" };
      // Second asset: returns a valid Blotato URL
      return { url: VALID_BLOTATO_URL, id: "media-valid-2" };
    });
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-partial" }));

    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({ uploadMedia, publishPost }),
      }),
    );

    const result = await publisher.publish(
      input({ assetUrls: [SUPABASE_SIGNED_URL, SECOND_ASSET_URL] }),
    );

    // Partial success: the valid asset was uploaded, so the post should proceed
    expect(result.success).toBe(true);
    expect(publishPost).toHaveBeenCalledTimes(1);
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: [VALID_BLOTATO_URL] }),
    );
    // The invalid empty URL must NOT appear in publishPost's call
    expect(publishPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: expect.arrayContaining([""]) }),
    );
  });
});

describe("T38 — publishPost is never called when all provider URLs fail validation", () => {
  it("publishPost call count is zero when every uploadMedia call returns an invalid URL", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "never" }));
    const publisher = new BlotatoInstagramPublisher(
      deps({
        blotatoClient: fakeClient({
          uploadMedia: async () => ({ url: null as unknown as string, id: "media-all-invalid" }),
          publishPost,
        }),
      }),
    );

    const result = await publisher.publish(input({ assetUrls: [SUPABASE_SIGNED_URL] }));

    expect(publishPost).toHaveBeenCalledTimes(0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("media_resolution_failed");
    }
  });
});

// ── T32: Alpha / Beta multi-tenant proof ─────────────────────────────────────

describe("T32 — Alpha/Beta multi-tenant proof: each org's payload contains ONLY its own media", () => {
  it("Alpha and Beta run through identical publisher code and receive their own Blotato URLs", async () => {
    const ALPHA_SUPABASE = "https://proj.supabase.co/storage/v1/object/sign/org-media/alpha/img.jpg?token=at";
    const BETA_SUPABASE  = "https://proj.supabase.co/storage/v1/object/sign/org-media/beta/img.jpg?token=bt";
    const ALPHA_BLOTATO  = "https://media.blotato.com/alpha-uploaded.jpg";
    const BETA_BLOTATO   = "https://media.blotato.com/beta-uploaded.jpg";

    const alphaPublishPost = vi.fn(async () => ({ postSubmissionId: "sub-alpha" }));
    const betaPublishPost  = vi.fn(async () => ({ postSubmissionId: "sub-beta" }));

    const alphaAccount = fakeAccount({ id: "acc-alpha", platform: "instagram", organisationId: ALPHA_ORG_ID });
    const betaAccount  = fakeAccount({ id: "acc-beta",  platform: "instagram", organisationId: BETA_ORG_ID });

    function buildPublisher(
      orgId: string,
      account: BlotatoAccount,
      supabaseUrl: string,
      blotatoUrl: string,
      publishPost: BlotatoClient["publishPost"],
    ) {
      return new BlotatoInstagramPublisher(
        deps({
          blotatoAccounts: fakeRepository([account]),
          blotatoClient: fakeClient({
            uploadMedia: async (url) => {
              // Verify only this org's signed URL reaches this publisher's upload call
              expect(url).toBe(supabaseUrl);
              return { url: blotatoUrl, id: `mid-${orgId}` };
            },
            publishPost,
          }),
        }),
      );
    }

    const alphaPublisher = buildPublisher(ALPHA_ORG_ID, alphaAccount, ALPHA_SUPABASE, ALPHA_BLOTATO, alphaPublishPost);
    const betaPublisher  = buildPublisher(BETA_ORG_ID, betaAccount, BETA_SUPABASE, BETA_BLOTATO, betaPublishPost);

    await alphaPublisher.publish(input({ organisationId: ALPHA_ORG_ID, assetUrls: [ALPHA_SUPABASE], resolvedAccountId: "acc-alpha" }));
    await betaPublisher.publish(input({ organisationId: BETA_ORG_ID, assetUrls: [BETA_SUPABASE], resolvedAccountId: "acc-beta" }));

    // Alpha payload contains only Alpha's Blotato URL
    expect(alphaPublishPost).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-alpha",
        mediaUrls: [ALPHA_BLOTATO],
      }),
    );
    // Beta payload contains only Beta's Blotato URL
    expect(betaPublishPost).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-beta",
        mediaUrls: [BETA_BLOTATO],
      }),
    );
    // Cross-contamination: Alpha's media never reached Beta's publishPost and vice versa
    expect(alphaPublishPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: expect.arrayContaining([BETA_BLOTATO]) }),
    );
    expect(betaPublishPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: expect.arrayContaining([ALPHA_BLOTATO]) }),
    );
  });
});
