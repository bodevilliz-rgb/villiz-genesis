import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { DraftForm } from "@/components/content/draft-form";
import { Card, CardContent } from "@/components/ui/card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

export default async function NewDraftPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const viewerRole = await context.organisations.viewerRole(orgId);
  if (!canWriteContent(context.actor, viewerRole)) redirect(routes.organisations.content.index(orgId));

  const [categories, campaigns] = await Promise.all([
    context.membrain.listCategories(orgId),
    context.campaigns.listCampaigns({ organisationId: orgId, limit: 100, offset: 0 }),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="Content Studio"
        title="New draft"
        description="Start with a title. You can write the body here, or open the document afterwards and send a generation request to Awo alongside it."
      />
      <Card>
        <CardContent className="py-6">
          <DraftForm organisationId={orgId} categories={categories} campaigns={campaigns} />
        </CardContent>
      </Card>
    </div>
  );
}
