import Link from "next/link";
import { notFound } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";
import { requireContext } from "@/server/container";
import { countCampaignsByStatus, listCampaigns } from "@/core/application/use-cases/campaigns";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Stat } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { CampaignSearchFilters } from "@/components/campaigns/campaign-search-filters";
import { CampaignCard } from "@/components/campaigns/campaign-card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "@/core/domain/entities/campaign";
import { campaignPlatformSchema, campaignStatusSchema } from "@/core/application/dto/campaign-dto";
import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";
import { CampaignDashboard } from "@/components/campaigns/campaign-dashboard";

const STATUS_ORDER: CampaignStatus[] = ["planning", "active", "completed", "archived"];

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ q?: string; status?: string; platform?: string; view?: string }>;
}) {
  const { orgId } = await params;
  const filters = await searchParams;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const campaignDeps = {
    actor: context.actor,
    campaigns: context.campaigns,
    content: context.content,
    organisations: context.organisations,
  };
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };

  const status = campaignStatusSchema.safeParse(filters.status).success ? filters.status : undefined;
  const platform = campaignPlatformSchema.safeParse(filters.platform).success ? filters.platform : undefined;

  const [byStatus, campaigns, viewerRole, membrainOverview, drafts] = await Promise.all([
    countCampaignsByStatus(campaignDeps, orgId),
    listCampaigns(campaignDeps, {
      organisationId: orgId,
      query: filters.q,
      status,
      platform,
      limit: 50,
      offset: 0,
    }),
    context.organisations.viewerRole(orgId),
    getMembrainOverview(membrainDeps, orgId),
    context.content.listDrafts({ organisationId: orgId, limit: 300, offset: 0 }),
  ]);

  const canWrite = canWriteContent(context.actor, viewerRole);
  const isFiltered = Boolean(filters.q || filters.status || filters.platform);
  const totalCampaigns = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const hasAnyCampaigns = totalCampaigns > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Campaigns"
        title="Campaigns for this client"
        description="Plan and organise the work before it becomes drafts. Campaigns are planning objects only — nothing here schedules or publishes anything."
        actions={
          canWrite ? (
            <Button asChild variant="primary">
              <Link href={routes.organisations.campaigns.new(orgId)}>
                <Plus aria-hidden />
                New campaign
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Total campaigns" value={formatNumber(totalCampaigns)} />
        {STATUS_ORDER.map((s) => (
          <Stat key={s} label={CAMPAIGN_STATUS_LABELS[s]} value={formatNumber(byStatus[s])} />
        ))}
      </div>

      {/* View Tab Switcher */}
      <div className="flex gap-2 overflow-x-auto border-b border-border pb-3">
        <Button asChild variant={(!filters.view || filters.view === "list") ? "primary" : "secondary"} size="sm">
          <Link href={`/organisations/${orgId}/campaigns?view=list`}>Campaign List</Link>
        </Button>
        <Button asChild variant={filters.view === "dashboard" ? "primary" : "secondary"} size="sm">
          <Link href={`/organisations/${orgId}/campaigns?view=dashboard`}>Campaign Dashboard</Link>
        </Button>
      </div>

      {filters.view === "dashboard" ? (
        <CampaignDashboard campaigns={campaigns} drafts={drafts} _organisationId={orgId} />
      ) : !hasAnyCampaigns ? (
        <EmptyState
          icon={<Megaphone aria-hidden />}
          title="No campaigns yet"
          description="A campaign groups related drafts under one objective, audience and timeline. The fastest way to start:"
          action={
            <div className="flex flex-col items-center gap-3">
              <ol className="flex flex-col gap-1.5 text-left text-[13px] text-muted-foreground">
                <li>1. Create a campaign and set its objective and dates.</li>
                <li>2. Create drafts in Content Studio and link them to it.</li>
                <li>3. Track progress here as drafts move through review.</li>
              </ol>
              {canWrite ? (
                <Button asChild variant="primary">
                  <Link href={routes.organisations.campaigns.new(orgId)}>Create the first campaign</Link>
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <>
          <CampaignSearchFilters defaults={{ q: filters.q, status: filters.status, platform: filters.platform }} />

          {campaigns.length === 0 ? (
            <EmptyState
              icon={<Megaphone aria-hidden />}
              title="Nothing matches that"
              description="Try fewer words, or clear the filters."
              action={
                <Button asChild variant="secondary">
                  <Link href={routes.organisations.campaigns.index(orgId)}>Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
                {formatNumber(campaigns.length)} {campaigns.length === 1 ? "campaign" : "campaigns"}
                {isFiltered ? " matching your filters" : ""}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {campaigns.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    organisationId={orgId}
                    campaign={campaign}
                    membrainReadinessPercent={membrainOverview.readiness.percentage}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
