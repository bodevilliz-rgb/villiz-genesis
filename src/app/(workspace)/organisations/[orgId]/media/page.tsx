import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { formatNumber } from "@/lib/format";
import { MediaUploadZone } from "@/components/media/media-upload-zone";
import { MediaGrid, MEDIA_LIBRARY_PAGE_SIZE } from "@/components/media/media-grid";
import { CollectionsPanel } from "@/components/media/collections-panel";
import { BrandKitsPanel } from "@/components/media/brand-kits-panel";
import { MediaCleanupStatus } from "@/components/media/media-cleanup-status";
import { loadMediaLibraryPage } from "@/core/application/use-cases/media/list-media-library-page";
import type { MediaAsset, MediaCollection } from "@/core/domain/entities/media";
import type { BrandKit } from "@/core/domain/entities/brand";

export default async function MediaDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string; cleanupRequest?: string }>;
}) {
  const { orgId } = await params;
  const filters = await searchParams;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const activeTab = filters.tab || "assets";
  const cleanupRequestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters.cleanupRequest ?? "")
    ? filters.cleanupRequest!
    : null;
  const cleanupRequest = cleanupRequestId
    ? await context.media.getDeletionRequest(orgId, cleanupRequestId).catch(() => null)
    : null;

  // The stats board always shows org-wide counts, but only as cheap
  // aggregates (COUNT/SUM) — never by fetching every asset row.
  const stats = await context.media.getLibraryStats(orgId);
  const { totalAssets, imageCount, videoCount, totalStorageBytes } = stats;

  // Only the active tab's data is fetched. The Assets tab (the default, and
  // the one that produced FUNCTION_PAYLOAD_TOO_LARGE in production) fetches
  // exactly one bounded page — never the whole library. Collections/Brand
  // Kits keep their existing full-list "pick an asset" behaviour (out of
  // scope to redesign here) but are no longer fetched on every page load
  // regardless of which tab is active, only when their own tab is open.
  let assetsPage: Awaited<ReturnType<typeof loadMediaLibraryPage>> = { items: [], signedUrls: {}, hasMore: false, total: 0 };
  let collections: MediaCollection[] = [];
  let brandKits: BrandKit[] = [];
  let pickerAssets: MediaAsset[] = [];
  let pickerSignedUrls: Record<string, string> = {};

  if (activeTab === "assets") {
    assetsPage = await loadMediaLibraryPage(context, orgId, { limit: MEDIA_LIBRARY_PAGE_SIZE, offset: 0 });
  } else if (activeTab === "collections") {
    [collections, pickerAssets] = await Promise.all([
      context.media.listCollections(orgId),
      context.media.listAssets(orgId),
    ]);
    pickerSignedUrls = await signAll(pickerAssets);
  } else if (activeTab === "brand-kits") {
    [brandKits, pickerAssets] = await Promise.all([
      context.media.listBrandKits(orgId),
      context.media.listAssets(orgId),
    ]);
    pickerSignedUrls = await signAll(pickerAssets);
  }

  async function signAll(assets: MediaAsset[]): Promise<Record<string, string>> {
    const signed: Record<string, string> = {};
    for (const asset of assets) {
      if (asset.mimeType.startsWith("image/")) {
        try {
          signed[asset.storagePath] = await context.storage.getSignedUrl(asset.storagePath);
        } catch (err) {
          console.warn(`Failed to sign URL for storagePath: ${asset.storagePath}`, err);
        }
      }
    }
    return signed;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Media Library"
        title="Asset Catalog & Brand Kits"
        description="Organise client brand assets, color guidelines, logos, and campaign copy mockups in a centralised media dashboard."
      />

      {cleanupRequest ? <MediaCleanupStatus request={cleanupRequest} /> : null}

      {/* Stats Board */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total assets" value={formatNumber(totalAssets)} />
        <Stat label="Image files" value={formatNumber(imageCount)} />
        <Stat label="Video files" value={formatNumber(videoCount)} />
        <Stat
          label="Total storage used"
          value={
            totalStorageBytes < 1024 * 1024
              ? `${(totalStorageBytes / 1024).toFixed(1)} KB`
              : `${(totalStorageBytes / 1024 / 1024).toFixed(1)} MB`
          }
        />
      </div>

      {/* Tabs list with URL state */}
      <div className="border-b border-border">
        <nav className="flex gap-4" aria-label="Tabs">
          {[
            { id: "assets", label: "All Assets" },
            { id: "collections", label: "Collections" },
            { id: "brand-kits", label: "Brand Kits" },
          ].map((tab) => (
            <a
              key={tab.id}
              href={`?tab=${tab.id}`}
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={`pb-3 text-[14px] font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </div>

      {/* Workspace Area split by Active Tab */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* Main interactive tabs content */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {activeTab === "assets" && (
            <MediaGrid
              organisationId={orgId}
              initialItems={assetsPage.items}
              initialSignedUrls={assetsPage.signedUrls}
              initialHasMore={assetsPage.hasMore}
              initialTotal={assetsPage.total}
            />
          )}
          {activeTab === "collections" && (
            <CollectionsPanel
              organisationId={orgId}
              collections={collections}
              allAssets={pickerAssets}
              signedUrls={pickerSignedUrls}
            />
          )}
          {activeTab === "brand-kits" && (
            <BrandKitsPanel
              organisationId={orgId}
              brandKits={brandKits}
              allAssets={pickerAssets}
              signedUrls={pickerSignedUrls}
            />
          )}
        </div>

        {/* Sidebar Upload panel */}
        <div className="lg:col-span-1">
          <MediaUploadZone organisationId={orgId} />
        </div>
      </div>
    </div>
  );
}
