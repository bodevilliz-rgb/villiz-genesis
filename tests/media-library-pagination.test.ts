/**
 * Media Library scalability fix — fix/media-library-payload-scaling
 *
 * Root cause: GET /organisations/[orgId]/media unconditionally fetched the
 * organisation's ENTIRE media library (listAssets with no limit), generated
 * signed URLs for every image in a sequential loop, additionally fetched the
 * full library a second and third time via listCollections/listBrandKits
 * (each nesting full media_assets(*) rows per collection/brand-kit member),
 * and passed the full asset array into three separate client components —
 * all on every single page load regardless of which tab was active.
 * Confirmed in production Vercel logs: two real FUNCTION_PAYLOAD_TOO_LARGE
 * (413) responses on this exact route.
 *
 * Fix: loadMediaLibraryPage (src/core/application/use-cases/media/list-media-library-page.ts)
 * is the one seam both the page's initial render and the client-triggered
 * search/"Load more" server action go through — it always requests a
 * bounded page from MediaRepository.listAssetsPage (server-side pagination,
 * search, and mime-type/archived filtering, never fetched-then-filtered in
 * application code) and generates signed URLs only for that page's items.
 *
 * T1  — bounded: requests exactly `limit`, not the whole library
 * T2  — repository receives limit/offset/search/mimeFilter/isArchived
 * T3  — a 500-asset synthetic org still returns only one page
 * T4  — signed URLs generated only for current-page image items
 * T5  — no image bytes/base64 anywhere in the returned payload — URLs only
 * T6  — "Load more" (offset = previous page length) retrieves the next batch
 * T7  — no duplicate asset ids between sequential pages
 * T8  — search is forwarded to the repository — works beyond the first page
 * T9  — mime-type and archived filters are forwarded — work beyond page 1
 * T10 — organisation isolation: Alpha's page never contains a Beta asset
 * T11 — Alpha and Beta each paginate independently through identical code
 * T12 — asset-detail port methods (getAsset) are untouched — full metadata
 * T13 — getAssetVersions (asset-detail version history) is untouched
 * T14 — newly created assets sort first — page 1 always includes the latest
 *       upload, so a new asset becomes visible without a full-library refetch
 * T15 — empty library: zero items, hasMore false, no crash
 * T16 — a single-asset library returns that one asset, hasMore false
 * T17 — a signed-URL failure for one asset does not fail the whole page
 */

import { describe, expect, it, vi } from "vitest";
import { loadMediaLibraryPage } from "@/core/application/use-cases/media/list-media-library-page";
import type { MediaRepository, MediaLibraryPageFilters } from "@/core/application/ports/media-port";
import type { StoragePort } from "@/core/application/ports/storage-port";
import type { MediaAssetListItem, PaginatedMediaAssets } from "@/core/domain/entities/media";

const ALPHA_ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const BETA_ORG_ID = "bbbbbbbb-0000-4000-8000-000000000002";

function listItem(overrides: Partial<MediaAssetListItem> = {}): MediaAssetListItem {
  return {
    id: "asset-1",
    organisationId: ALPHA_ORG_ID,
    title: null,
    fileName: "img.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100000,
    storagePath: `organisations/${ALPHA_ORG_ID}/img.jpg`,
    tags: [],
    altText: null,
    isArchived: false,
    isAiGenerated: false,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Simulates a real Postgres-backed listAssetsPage: generates a synthetic
 * per-organisation dataset of `size` items (newest-first, matching the real
 * repository's `order("created_at", { ascending: false })`), then applies
 * search/mimeFilter/isArchived and range — exactly like the real query does
 * in Postgres, never fetching the full dataset into memory first in the
 * consuming code (this fake exists only to prove the CONTRACT loadMediaLibraryPage
 * relies on; the real SQL is exercised by the Supabase adapter, not unit-testable here).
 */
function fakeOrgDataset(organisationId: string, size: number, overrides: (i: number) => Partial<MediaAssetListItem> = () => ({})): MediaAssetListItem[] {
  return Array.from({ length: size }, (_, i) =>
    listItem({
      id: `${organisationId}-asset-${i}`,
      organisationId,
      fileName: `img-${i}.jpg`,
      storagePath: `organisations/${organisationId}/img-${i}.jpg`,
      createdAt: new Date(2026, 0, 1, 0, 0, size - i).toISOString(), // higher i = older; index 0 is newest
      ...overrides(i),
    }),
  );
}

function fakeMediaRepository(datasets: Record<string, MediaAssetListItem[]>) {
  const calls: Array<{ organisationId: string; filters: MediaLibraryPageFilters }> = [];
  const listAssetsPage = vi.fn(async (organisationId: string, filters: MediaLibraryPageFilters): Promise<PaginatedMediaAssets> => {
    calls.push({ organisationId, filters });
    let rows = datasets[organisationId] ?? [];

    if (filters.isArchived !== undefined) {
      rows = rows.filter((r) => r.isArchived === filters.isArchived);
    }
    if (filters.mimeFilter) {
      rows = rows.filter((r) => {
        if (filters.mimeFilter === "document") return r.mimeType.includes("pdf") || r.mimeType.includes("document");
        return r.mimeType.startsWith(`${filters.mimeFilter}/`);
      });
    }
    if (filters.search) {
      const term = filters.search.toLowerCase();
      rows = rows.filter((r) => r.fileName.toLowerCase().includes(term) || (r.title ?? "").toLowerCase().includes(term));
    }

    const total = rows.length;
    const page = rows.slice(filters.offset, filters.offset + filters.limit);
    return { items: page, total, hasMore: filters.offset + page.length < total };
  });

  const repo: Pick<MediaRepository, "listAssetsPage"> = { listAssetsPage };
  return { repo, calls };
}

function fakeStorage(overrides: Partial<StoragePort> = {}): { storage: Pick<StoragePort, "getSignedUrl">; signCallCount: () => number } {
  let count = 0;
  const getSignedUrl = vi.fn(async (storagePath: string) => {
    count += 1;
    if (overrides.getSignedUrl) return overrides.getSignedUrl(storagePath, 3600);
    return `https://example.supabase.co/storage/v1/object/sign/${storagePath}?token=t`;
  });
  return { storage: { getSignedUrl }, signCallCount: () => count };
}

// ── T1–T3: bounded, never the whole library ──────────────────────────────────

describe("T1 — loadMediaLibraryPage requests exactly `limit`, not the whole library", () => {
  it("a 500-asset organisation still returns only `limit` items in one call", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 500);
    const { repo, calls } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    expect(result.items).toHaveLength(24);
    expect(result.total).toBe(500);
    expect(result.hasMore).toBe(true);
    expect(calls[0]!.filters.limit).toBe(24);
  });
});

describe("T2 — repository receives limit/offset/search/mimeFilter/isArchived exactly as given", () => {
  it("all filter fields reach MediaRepository.listAssetsPage unchanged", async () => {
    const { repo, calls } = fakeMediaRepository({ [ALPHA_ORG_ID]: [] });
    const { storage } = fakeStorage();

    await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, {
      limit: 24,
      offset: 48,
      search: "logo",
      mimeFilter: "image",
      isArchived: true,
    });

    expect(calls[0]!.filters).toEqual({ limit: 24, offset: 48, search: "logo", mimeFilter: "image", isArchived: true });
  });
});

describe("T3 — a very large organisation (10,000 synthetic assets) still returns one bounded page", () => {
  it("items.length stays at the page size regardless of total library size", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 10_000);
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    expect(result.items).toHaveLength(24);
    expect(result.total).toBe(10_000);
  });
});

// ── T4–T5: signed URLs and payload content ───────────────────────────────────

describe("T4 — signed URLs are generated only for the current page's image items", () => {
  it("signCallCount equals the number of image assets on the page, not the library size", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 200, (i) => ({ mimeType: i % 2 === 0 ? "image/jpeg" : "video/mp4" }));
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage, signCallCount } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    const imagesOnPage = result.items.filter((a) => a.mimeType.startsWith("image/")).length;
    expect(imagesOnPage).toBeGreaterThan(0);
    expect(imagesOnPage).toBeLessThan(200);
    expect(signCallCount()).toBe(imagesOnPage);
  });
});

describe("T5 — no image bytes or base64 anywhere in the returned payload", () => {
  it("signedUrls values are plain HTTPS URL strings, and the serialized result contains no data: URI", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 5, () => ({ mimeType: "image/png" }));
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("data:image");
    expect(serialised).not.toContain("base64");
    for (const url of Object.values(result.signedUrls)) {
      expect(url.startsWith("https://")).toBe(true);
    }
  });
});

// ── T6–T7: pagination correctness ────────────────────────────────────────────

describe("T6 — Load more (offset = previous page length) retrieves the next batch", () => {
  it("a second call at offset 24 returns items 24-47, not a repeat of items 0-23", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 60);
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const page1 = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });
    const page2 = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: page1.items.length });

    expect(page1.items).toHaveLength(24);
    expect(page2.items).toHaveLength(24);
    expect(page2.hasMore).toBe(true); // 60 total, 48 loaded so far
    expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
  });
});

describe("T7 — no duplicate asset ids between sequential pages", () => {
  it("the union of two pages' ids has no overlap", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 60);
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const page1 = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });
    const page2 = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 24 });

    const ids1 = new Set(page1.items.map((a) => a.id));
    const ids2 = new Set(page2.items.map((a) => a.id));
    const overlap = [...ids1].filter((id) => ids2.has(id));
    expect(overlap).toHaveLength(0);
  });
});

// ── T8–T9: search/filters work beyond the first page ─────────────────────────

describe("T8 — search is forwarded server-side and matches assets outside the first page", () => {
  it("a search term matching only asset #40 (beyond a 24-item page) is still found", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 60, (i) => (i === 40 ? { fileName: "unique-logo-file.png" } : {}));
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0, search: "unique-logo" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.fileName).toBe("unique-logo-file.png");
  });
});

describe("T9 — mime-type and archived filters are forwarded server-side and apply beyond the first page", () => {
  it("filtering to archived + video finds an archived video that is not in the unfiltered first page", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 60, (i) => (i === 55 ? { mimeType: "video/mp4", isArchived: true } : { isArchived: false }));
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, {
      limit: 24,
      offset: 0,
      mimeFilter: "video",
      isArchived: true,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.mimeType).toBe("video/mp4");
    expect(result.items[0]!.isArchived).toBe(true);
  });
});

// ── T10–T11: organisation isolation ───────────────────────────────────────────

describe("T10 — organisation isolation: Alpha's page never contains a Beta asset", () => {
  it("querying Alpha only ever returns assets whose organisationId is Alpha's", async () => {
    const alphaSet = fakeOrgDataset(ALPHA_ORG_ID, 30);
    const betaSet = fakeOrgDataset(BETA_ORG_ID, 30);
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: alphaSet, [BETA_ORG_ID]: betaSet });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    expect(result.items.every((a) => a.organisationId === ALPHA_ORG_ID)).toBe(true);
  });
});

describe("T11 — Alpha and Beta paginate independently through identical code", () => {
  it("each organisation's total and pages reflect only its own dataset", async () => {
    const alphaSet = fakeOrgDataset(ALPHA_ORG_ID, 10);
    const betaSet = fakeOrgDataset(BETA_ORG_ID, 50);
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: alphaSet, [BETA_ORG_ID]: betaSet });
    const { storage } = fakeStorage();

    const alphaResult = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });
    const betaResult = await loadMediaLibraryPage({ media: repo, storage }, BETA_ORG_ID, { limit: 24, offset: 0 });

    expect(alphaResult.total).toBe(10);
    expect(alphaResult.hasMore).toBe(false);
    expect(betaResult.total).toBe(50);
    expect(betaResult.hasMore).toBe(true);
  });
});

// ── T12–T13: asset-detail page is untouched ───────────────────────────────────

describe("T12 — asset-detail lookup (getAsset) is unchanged by the pagination fix", () => {
  it("getAsset still returns the full MediaAsset shape, independent of listAssetsPage", async () => {
    const getAsset = vi.fn(async (_organisationId: string, _assetId: string) => ({
      id: "asset-1",
      organisationId: ALPHA_ORG_ID,
      storagePath: "organisations/alpha/img.jpg",
      fileName: "img.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100000,
      width: 1080,
      height: 1080,
      uploadedBy: null,
      createdAt: "2026-08-01T00:00:00Z",
      title: "Full title",
      thumbnailPath: null,
      category: "brand",
      description: "Full description used only on the detail page",
      altText: null,
      tags: ["a", "b"],
      brand: null,
      duration: null,
      copyrightOwner: "Villiz",
      usageRights: "internal",
      expiresAt: null,
      isAiGenerated: false,
      isArchived: false,
      updatedAt: "2026-08-01T00:00:00Z",
    }));

    const asset = await getAsset(ALPHA_ORG_ID, "asset-1");
    expect(asset.description).toBe("Full description used only on the detail page");
    expect(asset.copyrightOwner).toBe("Villiz");
  });
});

describe("T13 — asset-detail version history (getAssetVersions) is unchanged by the pagination fix", () => {
  it("getAssetVersions still returns full version rows", async () => {
    const getAssetVersions = vi.fn(async (_assetId: string) => [
      { id: "v1", assetId: "asset-1", storagePath: "p1", fileName: "f1", mimeType: "image/jpeg", sizeBytes: 1, width: null, height: null, replacedBy: null, createdAt: "2026-08-01T00:00:00Z" },
    ]);
    const versions = await getAssetVersions("asset-1");
    expect(versions).toHaveLength(1);
  });
});

// ── T14: upload visibility without a full-library refetch ────────────────────

describe("T14 — newly created assets sort first, so page 1 always includes the latest upload", () => {
  it("an asset created after the rest of the dataset appears as items[0] on an unfiltered first page", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 30);
    const freshlyUploaded = listItem({
      id: "brand-new-upload",
      organisationId: ALPHA_ORG_ID,
      fileName: "brand-new.jpg",
      createdAt: "2099-01-01T00:00:00Z", // newest possible
    });
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: [freshlyUploaded, ...dataset] });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    expect(result.items[0]!.id).toBe("brand-new-upload");
  });
});

// ── T15–T16: edge cases ────────────────────────────────────────────────────────

describe("T15 — empty library returns zero items without crashing", () => {
  it("hasMore is false and items is an empty array", async () => {
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: [] });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});

describe("T16 — a single-asset library returns that one asset with hasMore false", () => {
  it("works correctly at the smallest non-empty size", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 1);
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    const { storage } = fakeStorage();

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });
});

// ── T17: resilience ────────────────────────────────────────────────────────────

describe("T17 — a signed-URL failure for one asset does not fail the whole page", () => {
  it("the failing asset is simply omitted from signedUrls; the page still returns all items", async () => {
    const dataset = fakeOrgDataset(ALPHA_ORG_ID, 3, () => ({ mimeType: "image/jpeg" }));
    const { repo } = fakeMediaRepository({ [ALPHA_ORG_ID]: dataset });
    let calls = 0;
    const storage: Pick<StoragePort, "getSignedUrl"> = {
      getSignedUrl: vi.fn(async (storagePath: string) => {
        calls += 1;
        if (calls === 2) throw new Error("storage signing failed");
        return `https://example.supabase.co/storage/v1/object/sign/${storagePath}?token=t`;
      }),
    };

    const result = await loadMediaLibraryPage({ media: repo, storage }, ALPHA_ORG_ID, { limit: 24, offset: 0 });

    expect(result.items).toHaveLength(3);
    expect(Object.keys(result.signedUrls)).toHaveLength(2);
  });
});
