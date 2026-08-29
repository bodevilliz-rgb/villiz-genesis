import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { DraftForm } from "@/components/content/draft-form";
import { Card, CardContent } from "@/components/ui/card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { mapBlotatoPlatform } from "@/core/domain/entities/blotato";

export default async function NewDraftPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const viewerRole = await context.organisations.viewerRole(orgId);
  if (!canWriteContent(context.actor, viewerRole)) redirect(routes.organisations.content.index(orgId));

  const [categories, campaigns, membrain, accounts, allAssets] = await Promise.all([
    context.membrain.listCategories(orgId),
    context.campaigns.listCampaigns({ organisationId: orgId, limit: 100, offset: 0 }),
    getMembrainOverview({ actor: context.actor, organisations: context.organisations, membrain: context.membrain }, orgId),
    context.blotatoAccounts.listActiveForOrganisation(orgId).catch(() => []),
    context.media.listAssets(orgId, { isArchived: false }),
  ]);
  const signedUrls: Record<string, string> = {};
  for (const asset of allAssets) if (asset.mimeType.startsWith("image/")) {
    try { signedUrls[asset.storagePath] = await context.storage.getSignedUrl(asset.storagePath); } catch {}
  }
  const contentPillars = membrain.groups.find((group) => group.category.key === "content_pillars")?.entries
    .filter((entry) => entry.status === "active")
    .map((entry) => ({ id: entry.id, title: entry.title })) ?? [];
  const growthDestinations = accounts.flatMap((account) => {
    const platform = mapBlotatoPlatform(account.platform);
    return platform ? [{ id: account.id, platform, label: account.fullname || account.username || account.id }] : [];
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="Content Studio"
        title="New draft"
        description="Start with a title. You can write the body here, or open the document afterwards and send a generation request to Awo alongside it."
      />
      <Card>
        <CardContent className="py-6">
          <DraftForm organisationId={orgId} categories={categories} campaigns={campaigns} contentPillars={contentPillars} growthDestinations={growthDestinations} allAssets={allAssets} signedUrls={signedUrls} />
        </CardContent>
      </Card>
    </div>
  );
}
