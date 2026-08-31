import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, BrainCircuit, Megaphone, Plus, Target, Zap } from "lucide-react";
import { requireContext } from "@/server/container";
import { countCampaignsByStatus, listCampaigns } from "@/core/application/use-cases/campaigns";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { CampaignSearchFilters } from "@/components/campaigns/campaign-search-filters";
import { CampaignCard } from "@/components/campaigns/campaign-card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { campaignPlatformSchema, campaignStatusSchema } from "@/core/application/dto/campaign-dto";
import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";

export default async function CampaignsPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ q?: string; status?: string; platform?: string }> }) {
  const { orgId } = await params;
  const filters = await searchParams;
  const context = await requireContext();
  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const deps = { actor: context.actor, campaigns: context.campaigns, content: context.content, organisations: context.organisations };
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const status = campaignStatusSchema.safeParse(filters.status).success ? filters.status : undefined;
  const platform = campaignPlatformSchema.safeParse(filters.platform).success ? filters.platform : undefined;

  // Keep the landing page fast: only request data needed to render this command centre.
  // Draft details and publishing records stay on campaign detail / queue views instead of blocking this page.
  const [byStatus, campaigns, viewerRole, membrainOverview] = await Promise.all([
    countCampaignsByStatus(deps, orgId),
    listCampaigns(deps, { organisationId: orgId, query: filters.q, status, platform, limit: 50, offset: 0 }),
    context.organisations.viewerRole(orgId),
    getMembrainOverview(membrainDeps, orgId),
  ]);

  const canWrite = canWriteContent(context.actor, viewerRole);
  const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
  const active = byStatus.active ?? 0;
  const planning = byStatus.planning ?? 0;
  const totalDrafts = campaigns.reduce((sum, campaign) => sum + campaign.draftCount, 0);
  const filtered = Boolean(filters.q || filters.status || filters.platform);

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader
        eyebrow="Campaign Command Centre"
        title="Campaigns"
        description="Plan, optimise and operate multi-platform campaigns with MemBrain, Market Intelligence, Growth and Awo working as one system."
        actions={canWrite ? <Button asChild variant="primary"><Link href={routes.organisations.campaigns.new(orgId)}><Plus aria-hidden />Create new campaign</Link></Button> : null}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Megaphone className="size-4" />} label="Total campaigns" value={formatNumber(total)} detail="All campaign workspaces" />
        <Kpi icon={<Activity className="size-4" />} label="Active campaigns" value={formatNumber(active)} detail="Currently running" />
        <Kpi icon={<Zap className="size-4" />} label="Content in motion" value={formatNumber(totalDrafts)} detail="Drafts linked to campaigns" />
        <Kpi icon={<BrainCircuit className="size-4" />} label="MemBrain readiness" value={`${membrainOverview.readiness.percentage}%`} detail={`${formatNumber(planning)} campaign${planning === 1 ? "" : "s"} still planning`} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-foreground">Campaign portfolio</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Search, filter and open any campaign command centre.</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-subtle-foreground"><Target className="size-3.5" />Market Intelligence + Growth connected at campaign level</div>
        </div>
        <CampaignSearchFilters defaults={{ q: filters.q, status: filters.status, platform: filters.platform }} />
      </section>

      {total === 0 ? (
        <EmptyState icon={<Megaphone aria-hidden />} title="No campaigns yet" description="Create the first campaign to organise assets, platforms, intelligence, scheduling and performance under one objective." action={canWrite ? <Button asChild variant="primary"><Link href={routes.organisations.campaigns.new(orgId)}>Create the first campaign</Link></Button> : null} />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={<Megaphone aria-hidden />} title="Nothing matches that" description="Try fewer filters or clear the search." action={<Button asChild variant="secondary"><Link href={routes.organisations.campaigns.index(orgId)}>Clear filters</Link></Button>} />
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">{formatNumber(campaigns.length)} {campaigns.length === 1 ? "campaign" : "campaigns"}{filtered ? " matching your filters" : ""}</p>
            <p className="text-[11px] text-muted-foreground">Open a campaign to manage assets, weekly order and schedule.</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {campaigns.map((campaign) => <CampaignCard key={campaign.id} organisationId={orgId} campaign={campaign} membrainReadinessPercent={membrainOverview.readiness.percentage} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-subtle-foreground"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>{label}</div><p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}
