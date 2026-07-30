import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { getCampaign } from "@/core/application/use-cases/campaigns";
import { PageHeader } from "@/components/common/page-header";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { Card, CardContent } from "@/components/ui/card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ orgId: string; campaignId: string }>;
}) {
  const { orgId, campaignId } = await params;
  const context = await requireContext();

  const deps = {
    actor: context.actor,
    campaigns: context.campaigns,
    content: context.content,
    organisations: context.organisations,
  };

  const [campaign, viewerRole] = await Promise.all([
    getCampaign(deps, orgId, campaignId).catch(() => null),
    context.organisations.viewerRole(orgId),
  ]);

  if (!campaign) notFound();
  if (!canWriteContent(context.actor, viewerRole)) {
    redirect(routes.organisations.campaigns.detail(orgId, campaignId));
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader eyebrow="Campaigns" title="Edit campaign" description={campaign.name} />
      <Card>
        <CardContent className="py-6">
          <CampaignForm organisationId={orgId} campaign={campaign} />
        </CardContent>
      </Card>
    </div>
  );
}
