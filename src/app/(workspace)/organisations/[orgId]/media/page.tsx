import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { formatNumber } from "@/lib/format";
import { MediaUploadZone } from "@/components/media/media-upload-zone";
import { MediaGrid } from "@/components/media/media-grid";
import { CollectionsPanel } from "@/components/media/collections-panel";
import { BrandKitsPanel } from "@/components/media/brand-kits-panel";

export default async function MediaDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId } = await params;
  const filters = await searchParams;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  // 1. Fetch Assets, Collections, and Brand Kits matching filters
  const [assets, collections, brandKits] = await Promise.all([
    context.media.listAssets(orgId),
    context.media.listCollections(orgId),
    context.media.listBrandKits(orgId),
  ]);

  // 2. Generate signed URLs for all images to serve thumbnails and preview elements
  const signedUrls: Record<string, string> = {};
  for (const asset of assets) {
    if (asset.mimeType.startsWith("image/")) {
      try {
        const signedUrl = await context.storage.getSignedUrl(asset.storagePath);
        signedUrls[asset.storagePath] = signedUrl;
      } catch (err) {
        console.warn(`Failed to sign URL for storagePath: ${asset.storagePath}`, err);
      }
    }
  }

  // 3. Stats calculations
  const totalStorageBytes = assets.reduce((sum, a) => sum + a.sizeBytes, 0);
  const imageCount = assets.filter(a => a.mimeType.startsWith("image/")).length;
  const videoCount = assets.filter(a => a.mimeType.startsWith("video/")).length;
  const activeTab = filters.tab || "assets";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Media Library"
        title="Asset Catalog & Brand Kits"
        description="Organise client brand assets, color guidelines, logos, and campaign copy mockups in a centralised media dashboard."
      />

      {/* Stats Board */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total assets" value={formatNumber(assets.length)} />
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
            <MediaGrid organisationId={orgId} assets={assets} signedUrls={signedUrls} />
          )}
          {activeTab === "collections" && (
            <CollectionsPanel
              organisationId={orgId}
              collections={collections}
              allAssets={assets}
              signedUrls={signedUrls}
            />
          )}
          {activeTab === "brand-kits" && (
            <BrandKitsPanel
              organisationId={orgId}
              brandKits={brandKits}
              allAssets={assets}
              signedUrls={signedUrls}
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
