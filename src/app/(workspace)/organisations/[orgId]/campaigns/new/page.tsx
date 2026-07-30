import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { Card, CardContent } from "@/components/ui/card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

export default async function NewCampaignPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const viewerRole = await context.organisations.viewerRole(orgId);
  if (!canWriteContent(context.actor, viewerRole)) redirect(routes.organisations.campaigns.index(orgId));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="Campaigns"
        title="New campaign"
        description="Set the objective, audience and timeline. Drafts can be linked to it afterwards from Content Studio."
      />
      <Card>
        <CardContent className="py-6">
          <CampaignForm organisationId={orgId} />
        </CardContent>
      </Card>
    </div>
  );
}
