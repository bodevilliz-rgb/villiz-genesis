import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireContext } from "@/server/container";
import { getCampaignOverview } from "@/core/application/use-cases/campaigns";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignTimeline } from "@/components/campaigns/campaign-timeline";
import { CampaignArchiveButton } from "@/components/campaigns/campaign-archive-button";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import {
  CAMPAIGN_PLATFORM_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONE,
} from "@/core/domain/entities/campaign";
import { formatDate, formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; campaignId: string }>;
}) {
  const { orgId, campaignId } = await params;
  const context = await requireContext();

  const campaignDeps = {
    actor: context.actor,
    campaigns: context.campaigns,
    content: context.content,
    organisations: context.organisations,
  };
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };

  const [overview, viewerRole, membrainOverview] = await Promise.all([
    getCampaignOverview(campaignDeps, orgId, campaignId).catch(() => null),
    context.organisations.viewerRole(orgId),
    getMembrainOverview(membrainDeps, orgId),
  ]);

  if (!overview) notFound();
  const { campaign, draftCounts } = overview;

  const canWrite = canWriteContent(context.actor, viewerRole);
  const canArchive = canEditOrganisation(context.actor, viewerRole);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Campaigns"
        title={campaign.name}
        description={campaign.objective ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
            {canWrite ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={routes.organisations.campaigns.edit(orgId, campaignId)}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            ) : null}
            {canArchive && campaign.status !== "archived" ? (
              <CampaignArchiveButton organisationId={orgId} campaignId={campaignId} name={campaign.name} />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignTimeline startDate={campaign.startDate} endDate={campaign.endDate} />
              {campaign.startDate || campaign.endDate ? (
                <p className="mt-2 text-[12px] text-subtle-foreground">
                  {campaign.startDate ? formatDate(campaign.startDate) : "No start date"} –{" "}
                  {campaign.endDate ? formatDate(campaign.endDate) : "No end date"}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Campaign summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Detail label="Objective" value={campaign.objective} />
              <Detail label="Target audience" value={campaign.targetAudience} />
              <Detail label="Primary call to action" value={campaign.primaryCTA} />
              <Detail label="Success metric" value={campaign.successMetric} />

              <div>
                <p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">Platforms</p>
                {campaign.platforms.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {campaign.platforms.map((platform) => (
                      <Badge key={platform} tone="muted">
                        {CAMPAIGN_PLATFORM_LABELS[platform]}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-subtle-foreground">None set</p>
                )}
              </div>

              {campaign.description ? (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wider text-subtle-foreground">Description</p>
                  <p className="knowledge-body text-[13px] text-muted-foreground">{campaign.description}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Drafts</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Stat label="Draft" value={formatNumber(draftCounts.draft)} />
              <Stat label="Needs review" value={formatNumber(draftCounts.needsReview)} />
              <Stat label="Approved" value={formatNumber(draftCounts.approved)} />
              <Stat label="Total" value={formatNumber(draftCounts.total)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MemBrain readiness</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Stat
                label="Readiness"
                value={`${membrainOverview.readiness.percentage}%`}
                detail="Applies to this whole client, not just this campaign"
              />
              <Button asChild variant="ghost" size="sm">
                <Link href={routes.organisations.membrain.index(orgId)}>Open MemBrain</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</p>
      <p className={`mt-0.5 text-[13px] ${value ? "" : "text-subtle-foreground"}`}>{value ?? "Not set"}</p>
    </div>
  );
}
