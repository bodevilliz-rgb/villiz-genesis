/**
 * Regression tests for Media Library permanent deletion.
 *
 * Root cause summary:
 *  1. No explicit reference check — FK RESTRICT on campaign_assets / content_draft_assets
 *     produced an opaque "Something went wrong" instead of a user-readable message.
 *  2. Historical version storage paths were never deleted (only the active storagePath).
 *  3. Storage failures were silently swallowed — action falsely reported full success.
 *  4. No not-found guard — a 0-row DB delete returned no error.
 *
 * T1  — unreferenced asset deleted permanently
 * T2  — deleteAsset called with correct (organisationId, assetId)
 * T3  — active storage path deleted via deleteMediaFiles
 * T4  — historical version storage paths included in deleteMediaFiles call
 * T5  — draft-referenced asset fails with descriptive message
 * T6  — campaign-referenced asset fails with descriptive message
 * T7  — cross-org asset (getAsset returns null) → not-found error
 * T8  — already-deleted asset (getAsset returns null) → safe not-found error, no side effects
 * T9  — storage failure after DB success → partial-success message, NOT "deleted permanently"
 * T10 — DB failure → error returned, storage delete NOT called
 * T11 — archive action does NOT call deleteAsset or deleteMediaFiles
 * T12 — successful deletion revalidates the media library path
 * T13 — repeated delete (second call after first succeeded) → safe, no crash
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/routes", () => ({
  routes: {
    organisations: {
      detail: (o: string) => `/organisations/${o}`,
      media: {
        index: (o: string) => `/organisations/${o}/media`,
        detail: (o: string, a: string) => `/organisations/${o}/media/${a}`,
      },
      content: { draft: (o: string, d: string) => `/organisations/${o}/content/${d}` },
      campaigns: { detail: (o: string, c: string) => `/organisations/${o}/campaigns/${c}` },
    },
    login: "/login",
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteMediaAction, archiveMediaAction } from "@/server/actions/media";
import { requireContext } from "@/server/container";
import { revalidatePath } from "next/cache";
import type { MediaAsset, MediaAssetVersion } from "@/core/domain/entities/media";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-1",
    organisationId: "org-1",
    storagePath: "organisations/org-1/1000_photo.jpg",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 204800,
    width: 1920,
    height: 1080,
    uploadedBy: { id: "user-1", fullName: "Test User", email: "test@villiz.com" },
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    title: "Test photo",
    thumbnailPath: null,
    category: "photography",
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

function makeVersion(storagePath: string): MediaAssetVersion {
  return {
    id: `ver-${storagePath.slice(-4)}`,
    assetId: "asset-1",
    storagePath,
    fileName: "old-photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 180000,
    width: 1600,
    height: 900,
    replacedBy: "user-1",
    createdAt: "2026-07-28T00:00:00Z",
  };
}

function makeContext(overrides: Partial<ReturnType<typeof baseContext>> = {}) {
  const ctx = baseContext();
  return { ...ctx, ...overrides };
}

function baseContext() {
  return {
    actor: { id: "user-1", isActive: true },
    media: {
      getAsset: vi.fn(async () => makeAsset()),
      getAssetVersions: vi.fn(async () => [] as MediaAssetVersion[]),
      listDraftsReferencingAsset: vi.fn(async () => [] as Array<{ id: string; title: string }>),
      listCampaignsReferencingAsset: vi.fn(async () => [] as Array<{ id: string; name: string }>),
      deleteAsset: vi.fn(async () => {}),
      archiveAsset: vi.fn(async () => {}),
      updateAssetMetadata: vi.fn(async () => makeAsset()),
    },
    storage: {
      deleteMediaFiles: vi.fn(async () => {}),
      deleteMedia: vi.fn(async () => {}),
    },
  };
}

const requireContextMock = vi.mocked(requireContext);
const revalidatePathMock = vi.mocked(revalidatePath);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── T1: unreferenced asset → permanent delete ────────────────────────────────

describe("T1 — unreferenced asset can be permanently deleted", () => {
  it("returns success with 'deleted permanently' message", async () => {
    const ctx = makeContext();
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction("org-1", "asset-1");

    expect(result.status).toBe("success");
    expect(result.message).toBe("Asset deleted permanently.");
  });
});

// ─── T2: deleteAsset called with correct args ─────────────────────────────────

describe("T2 — deleteAsset called with correct (organisationId, assetId)", () => {
  it("passes the organisation and asset ids to the repository", async () => {
    const ctx = makeContext();
    requireContextMock.mockResolvedValue(ctx as never);

    await deleteMediaAction("org-1", "asset-1");

    expect(ctx.media.deleteAsset).toHaveBeenCalledWith("org-1", "asset-1");
  });
});

// ─── T3: active storage path deleted ─────────────────────────────────────────

describe("T3 — active storage path deleted via deleteMediaFiles", () => {
  it("includes asset.storagePath in the deleteMediaFiles call", async () => {
    const asset = makeAsset({ storagePath: "organisations/org-1/1000_photo.jpg" });
    const ctx = makeContext({
      media: {
        ...baseContext().media,
        getAsset: vi.fn(async () => asset),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    await deleteMediaAction("org-1", "asset-1");

    expect(ctx.storage.deleteMediaFiles).toHaveBeenCalledWith(
      expect.arrayContaining(["organisations/org-1/1000_photo.jpg"]),
    );
  });
});

// ─── T4: version storage paths included ──────────────────────────────────────

describe("T4 — historical version storage paths included in deleteMediaFiles", () => {
  it("passes active path AND all version paths in a single call", async () => {
    const asset = makeAsset({ storagePath: "organisations/org-1/active.jpg" });
    const v1 = makeVersion("organisations/org-1/v1.jpg");
    const v2 = makeVersion("organisations/org-1/v2.jpg");

    const ctx = makeContext({
      media: {
        ...baseContext().media,
        getAsset: vi.fn(async () => asset),
        getAssetVersions: vi.fn(async () => [v1, v2]),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    await deleteMediaAction("org-1", "asset-1");

    expect(ctx.storage.deleteMediaFiles).toHaveBeenCalledWith([
      "organisations/org-1/active.jpg",
      "organisations/org-1/v1.jpg",
      "organisations/org-1/v2.jpg",
    ]);
  });
});

// ─── T5: draft-referenced asset fails with descriptive message ────────────────

describe("T5 — draft-referenced asset fails safely with useful message", () => {
  it("returns an error naming the number of drafts blocking deletion", async () => {
    const ctx = makeContext({
      media: {
        ...baseContext().media,
        listDraftsReferencingAsset: vi.fn(async () => [
          { id: "draft-1", title: "Spring campaign post" },
          { id: "draft-2", title: "Summer launch copy" },
        ]),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction("org-1", "asset-1");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/2 content drafts/);
    expect(result.message).toMatch(/Remove it from those first/);
    // No destructive side effects
    expect(ctx.media.deleteAsset).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});

// ─── T6: campaign-referenced asset fails with descriptive message ─────────────

describe("T6 — campaign-referenced asset fails safely with useful message", () => {
  it("returns an error naming the number of campaigns blocking deletion", async () => {
    const ctx = makeContext({
      media: {
        ...baseContext().media,
        listCampaignsReferencingAsset: vi.fn(async () => [
          { id: "camp-1", name: "Q3 Growth Campaign" },
        ]),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction("org-1", "asset-1");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/1 campaign/);
    expect(ctx.media.deleteAsset).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});

// ─── T7: cross-org asset rejected ─────────────────────────────────────────────

describe("T7 — cross-org deletion rejected", () => {
  it("returns not-found error when getAsset returns null (RLS filters out other orgs)", async () => {
    const ctx = makeContext({
      media: {
        ...baseContext().media,
        getAsset: vi.fn(async (): Promise<null> => null) as never,
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction("org-attacker", "asset-1");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/not found or does not belong/);
    expect(ctx.media.deleteAsset).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});

// ─── T8: asset already deleted → safe not-found error ────────────────────────

describe("T8 — asset not found (already deleted) → safe error, no side effects", () => {
  it("returns not-found error without crashing or touching storage", async () => {
    const ctx = makeContext({
      media: {
        ...baseContext().media,
        getAsset: vi.fn(async (): Promise<null> => null) as never,
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction("org-1", "ghost-asset");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/not found/);
    expect(ctx.media.deleteAsset).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});

// ─── T9: storage failure after DB success → partial success message ───────────

describe("T9 — storage failure does not falsely report successful deletion", () => {
  it("returns a partial-success message (not 'deleted permanently') when storage fails", async () => {
    const ctx = makeContext({
      storage: {
        ...baseContext().storage,
        deleteMediaFiles: vi.fn(async () => {
          throw new Error("Supabase Storage: bucket unreachable");
        }),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction("org-1", "asset-1");

    // DB was deleted so we report success-level (not error — asset IS gone from library)
    expect(result.status).toBe("success");
    // But NOT the clean "deleted permanently" message
    expect(result.message).not.toBe("Asset deleted permanently.");
    expect(result.message).toMatch(/storage cleanup/i);
    // DB delete still happened
    expect(ctx.media.deleteAsset).toHaveBeenCalled();
  });
});

// ─── T10: DB failure → error returned, storage NOT called ────────────────────

describe("T10 — DB failure does not leave misleading success state", () => {
  it("returns error and does not call storage when deleteAsset throws", async () => {
    const ctx = makeContext({
      media: {
        ...baseContext().media,
        deleteAsset: vi.fn(async () => {
          throw new Error("DB connection lost");
        }),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction("org-1", "asset-1");

    expect(result.status).toBe("error");
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});

// ─── T11: archive does NOT permanently delete ─────────────────────────────────

describe("T11 — archive action does not permanently delete asset or storage", () => {
  it("archiveMediaAction calls archiveAsset only, never deleteAsset or deleteMediaFiles", async () => {
    const ctx = makeContext();
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await archiveMediaAction("org-1", "asset-1");

    expect(result.status).toBe("success");
    expect(ctx.media.archiveAsset).toHaveBeenCalledWith("org-1", "asset-1");
    expect(ctx.media.deleteAsset).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMedia).not.toHaveBeenCalled();
  });
});

// ─── T12: revalidatePath called on success ────────────────────────────────────

describe("T12 — successful deletion revalidates the media library", () => {
  it("calls revalidatePath with the org media index path", async () => {
    const ctx = makeContext();
    requireContextMock.mockResolvedValue(ctx as never);

    await deleteMediaAction("org-1", "asset-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/organisations/org-1/media");
  });
});

// ─── T13: repeated delete is safe ────────────────────────────────────────────

describe("T13 — repeated delete (asset already gone) is safe", () => {
  it("second call returns not-found error without crashing", async () => {
    const ctx = makeContext();
    requireContextMock.mockResolvedValue(ctx as never);

    // First call succeeds
    const first = await deleteMediaAction("org-1", "asset-1");
    expect(first.status).toBe("success");

    // Simulate asset now gone from DB (second call)
    ctx.media.getAsset = vi.fn(async (): Promise<null> => null) as never;
    const second = await deleteMediaAction("org-1", "asset-1");

    expect(second.status).toBe("error");
    expect(second.message).toMatch(/not found/);
    // deleteAsset was called exactly once (by the first call)
    expect(ctx.media.deleteAsset).toHaveBeenCalledTimes(1);
  });
});
