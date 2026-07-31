import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { AssetDetailForm } from "./asset-detail-form";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; assetId: string }>;
}) {
  const { orgId, assetId } = await params;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  // 1. Fetch asset and versions
  const [asset, versions] = await Promise.all([
    context.media.getAsset(orgId, assetId),
    context.media.getAssetVersions(assetId),
  ]);

  if (!asset) notFound();

  // 2. Generate signed URLs for previews
  let signedUrl = "";
  if (asset.mimeType.startsWith("image/")) {
    try {
      signedUrl = await context.storage.getSignedUrl(asset.storagePath);
    } catch (err) {
      console.warn("Failed to sign url for detail asset preview", err);
    }
  }

  // 3. Generate signed URLs for historical versions
  const versionUrls: Record<string, string> = {};
  for (const v of versions) {
    if (v.mimeType.startsWith("image/")) {
      try {
        const sUrl = await context.storage.getSignedUrl(v.storagePath);
        versionUrls[v.id] = sUrl;
      } catch {}
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" className="h-auto py-1 px-2.5 text-[12px]">
          <a href={routes.organisations.media.index(orgId)}>← Back to Media Library</a>
        </Button>
      </div>

      <PageHeader
        eyebrow="Asset Details"
        title={asset.title || asset.fileName}
        description="Inspect metadata, manage asset categories, and upload new versions to update content downstream automatically."
      />

      <AssetDetailForm
        organisationId={orgId}
        asset={asset}
        versions={versions}
        signedUrl={signedUrl}
        versionUrls={versionUrls}
      />
    </div>
  );
}
