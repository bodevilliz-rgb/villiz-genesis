import { describe, expect, it, vi } from "vitest";
import {
  filterAssetsForOrganisation,
  isPublishableMediaAsset,
  redactAccountId,
  redactMediaUrl,
  validateMediaUrl,
} from "@/core/domain/entities/publishing-media";
import { resolvePublishMediaUrls, BLOTATO_MEDIA_URL_EXPIRY_SECONDS } from "@/core/application/use-cases/publishing/media";
import type { MediaRepository } from "@/core/application/ports/media-port";
import type { StoragePort } from "@/core/application/ports/storage-port";
import type { MediaAsset } from "@/core/domain/entities/media";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG_ID = "00000000-0000-4000-8000-00000000ffff";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-1",
    organisationId: ORG_ID,
    storagePath: `organisations/${ORG_ID}/logo.png`,
    fileName: "logo.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 200,
    height: 200,
    uploadedBy: null,
    createdAt: "2026-08-01T00:00:00Z",
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
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function fakeMedia(assets: MediaAsset[]): MediaRepository {
  return {
    createAsset: vi.fn(),
    updateAssetMetadata: vi.fn(),
    getAsset: vi.fn(),
    listAssets: vi.fn(),
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
    deleteMediaFiles: vi.fn(),
  };
}

describe("isPublishableMediaAsset", () => {
  it("accepts image and video mime types", () => {
    expect(isPublishableMediaAsset(asset({ mimeType: "image/png" }))).toBe(true);
    expect(isPublishableMediaAsset(asset({ mimeType: "video/mp4" }))).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isPublishableMediaAsset(asset({ mimeType: "application/pdf" }))).toBe(false);
    expect(isPublishableMediaAsset(asset({ mimeType: "audio/mpeg" }))).toBe(false);
  });
});

describe("filterAssetsForOrganisation", () => {
  it("splits assets into allowed (same org) and rejected (cross-org)", () => {
    const sameOrg = asset({ id: "a", organisationId: ORG_ID });
    const crossOrg = asset({ id: "b", organisationId: OTHER_ORG_ID });
    const result = filterAssetsForOrganisation([sameOrg, crossOrg], ORG_ID);
    expect(result.allowed.map((a) => a.id)).toEqual(["a"]);
    expect(result.rejected.map((a) => a.id)).toEqual(["b"]);
  });
});

describe("validateMediaUrl", () => {
  it("accepts a real https URL", () => {
    expect(validateMediaUrl("https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/logo.png?token=abc")).toEqual({
      valid: true,
    });
  });

  it("rejects non-https URLs", () => {
    expect(validateMediaUrl("http://abcxyz.supabase.co/logo.png").valid).toBe(false);
    expect(validateMediaUrl("http://abcxyz.supabase.co/logo.png").reason).toBe("not_https");
  });

  it("rejects localhost and private-network hosts", () => {
    expect(validateMediaUrl("https://127.0.0.1:54321/storage/v1/object/sign/logo.png").reason).toBe("local_host");
    expect(validateMediaUrl("https://localhost:54321/logo.png").reason).toBe("local_host");
    expect(validateMediaUrl("https://host.docker.internal:54321/logo.png").reason).toBe("local_host");
    expect(validateMediaUrl("https://192.168.1.10/logo.png").reason).toBe("local_host");
  });

  it("rejects malformed URLs", () => {
    expect(validateMediaUrl("not-a-url").valid).toBe(false);
    expect(validateMediaUrl("not-a-url").reason).toBe("malformed");
  });
});

describe("redactMediaUrl", () => {
  it("strips the signed-token query string", () => {
    const redacted = redactMediaUrl("https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/logo.png?token=super-secret-value");
    expect(redacted).toBe("https://abcxyz.supabase.co/storage/v1/object/sign/organisation-media/logo.png?[redacted]");
    expect(redacted).not.toContain("super-secret-value");
  });
});

describe("redactAccountId", () => {
  it("masks the middle of a long id", () => {
    expect(redactAccountId("blotato-account-1234567890")).toBe("blot...7890");
  });

  it("fully masks a short id", () => {
    expect(redactAccountId("short")).toBe("*****");
  });
});

describe("resolvePublishMediaUrls", () => {
  it("resolves one linked image into exactly one media URL", async () => {
    const assets = [asset({ id: "a", mimeType: "image/png" })];
    const media = fakeMedia(assets);
    const storage = fakeStorage((path) => `https://abcxyz.supabase.co/storage/v1/object/sign/${path}?token=abc`);

    const result = await resolvePublishMediaUrls({ media, storage }, { organisationId: ORG_ID, draftId: DRAFT_ID });

    expect(result.mediaUrls).toHaveLength(1);
    expect(result.mediaUrls[0]).toContain("logo.png");
    expect(result.mimeTypes).toEqual(["image/png"]);
    expect(result.skipped).toEqual({ crossOrganisation: 0, unsupportedType: 0, unreachableUrl: 0 });
    expect(storage.getSignedUrl).toHaveBeenCalledWith(assets[0]!.storagePath, BLOTATO_MEDIA_URL_EXPIRY_SECONDS);
  });

  it("resolves multiple linked images into multiple media URLs, in order", async () => {
    const assets = [
      asset({ id: "a", fileName: "one.png", storagePath: `organisations/${ORG_ID}/one.png` }),
      asset({ id: "b", fileName: "two.png", storagePath: `organisations/${ORG_ID}/two.png` }),
    ];
    const media = fakeMedia(assets);
    const storage = fakeStorage((path) => `https://abcxyz.supabase.co/storage/v1/object/sign/${path}?token=abc`);

    const result = await resolvePublishMediaUrls({ media, storage }, { organisationId: ORG_ID, draftId: DRAFT_ID });

    expect(result.mediaUrls).toHaveLength(2);
    expect(result.mediaUrls[0]).toContain("one.png");
    expect(result.mediaUrls[1]).toContain("two.png");
  });

  it("returns an empty mediaUrls array when no assets are linked", async () => {
    const media = fakeMedia([]);
    const storage = fakeStorage(() => "https://abcxyz.supabase.co/x.png?token=abc");

    const result = await resolvePublishMediaUrls({ media, storage }, { organisationId: ORG_ID, draftId: DRAFT_ID });

    expect(result.mediaUrls).toEqual([]);
    expect(result.mimeTypes).toEqual([]);
  });

  it("resolves a linked video the same way as an image", async () => {
    const assets = [asset({ id: "a", mimeType: "video/mp4", fileName: "clip.mp4", storagePath: `organisations/${ORG_ID}/clip.mp4` })];
    const media = fakeMedia(assets);
    const storage = fakeStorage((path) => `https://abcxyz.supabase.co/storage/v1/object/sign/${path}?token=abc`);

    const result = await resolvePublishMediaUrls({ media, storage }, { organisationId: ORG_ID, draftId: DRAFT_ID });

    expect(result.mediaUrls).toHaveLength(1);
    expect(result.mimeTypes).toEqual(["video/mp4"]);
  });

  it("skips a signed URL that fails validation (inaccessible media) without throwing", async () => {
    const assets = [asset({ id: "a" })];
    const media = fakeMedia(assets);
    // Simulates a local dev Supabase instance producing a URL Blotato could never reach.
    const storage = fakeStorage(() => "http://127.0.0.1:54321/storage/v1/object/sign/organisation-media/logo.png?token=abc");

    const result = await resolvePublishMediaUrls({ media, storage }, { organisationId: ORG_ID, draftId: DRAFT_ID });

    expect(result.mediaUrls).toEqual([]);
    expect(result.skipped.unreachableUrl).toBe(1);
  });

  it("rejects a cross-organisation asset and never signs a URL for it", async () => {
    const assets = [asset({ id: "a", organisationId: OTHER_ORG_ID })];
    const media = fakeMedia(assets);
    const storage = fakeStorage(() => "https://abcxyz.supabase.co/x.png?token=abc");

    const result = await resolvePublishMediaUrls({ media, storage }, { organisationId: ORG_ID, draftId: DRAFT_ID });

    expect(result.mediaUrls).toEqual([]);
    expect(result.skipped.crossOrganisation).toBe(1);
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  it("excludes unsupported mime types (e.g. a linked PDF) from mediaUrls", async () => {
    const assets = [asset({ id: "a", mimeType: "application/pdf" })];
    const media = fakeMedia(assets);
    const storage = fakeStorage(() => "https://abcxyz.supabase.co/x.pdf?token=abc");

    const result = await resolvePublishMediaUrls({ media, storage }, { organisationId: ORG_ID, draftId: DRAFT_ID });

    expect(result.mediaUrls).toEqual([]);
    expect(result.skipped.unsupportedType).toBe(1);
  });
});
