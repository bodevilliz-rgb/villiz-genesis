import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Brain, Building2, Plus } from "lucide-react";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Stat } from "@/components/common/stat";
import { UsageMeter } from "@/components/common/usage-meter";
import { OrganisationStatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { MyWorkPanel } from "@/components/dashboard/my-work-panel";
import { ContentPipelinePanel } from "@/components/dashboard/content-pipeline";
import { ActiveCampaignsPanel } from "@/components/dashboard/active-campaigns-panel";
import { TeamActivityFeed } from "@/components/dashboard/team-activity-feed";
import { AwoInsightsPanel } from "@/components/dashboard/awo-insights-panel";
import { ReviewMetricsPanel } from "@/components/dashboard/review-metrics-panel";
import { aggregateUsage, toUsageMetrics } from "@/core/domain/entities/usage";
import { getDashboardHome } from "@/core/application/use-cases/dashboard";
import { formatNumber, formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const context = await requireContext();
  const [organisations, usage, dashboard] = await Promise.all([
    context.organisations.listForActor(),
    context.usage.forAllVisibleOrganisations(),
    getDashboardHome({
      actor: context.actor,
      organisations: context.organisations,
      campaigns: context.campaigns,
      content: context.content,
      membrain: context.membrain,
      reviews: context.reviews,
    }),
  ]);

  const activeCount = organisations.filter((o) => o.status === "active").length;
  const knowledgeTotal = organisations.reduce((sum, o) => sum + o.membrainEntryCount, 0);
  const portfolioMetrics = toUsageMetrics(aggregateUsage(usage));
  const atRisk = usage
    .map((u) => ({ usage: u, metrics: toUsageMetrics(u) }))
    .filter((row) => row.metrics.some((m) => m.state !== "ok"));

  const recentlyUpdated = [...organisations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Project Genesis"
        title={`Good to see you${context.actor.fullName ? `, ${context.actor.fullName.split(" ")[0]}` : ""}`}
        description="Everything Villiz runs for clients, in one place. Start with the account that needs you most."
        actions={
          context.actor.isPlatformAdmin ? (
            <Button asChild variant="primary">
              <Link href={routes.organisations.new}>
                <Plus aria-hidden />
                Add a client
              </Link>
            </Button>
          ) : null
        }
      />

      {organisations.length === 0 ? (
        <EmptyState
          icon={<Building2 aria-hidden />}
          title="No client accounts yet"
          description={
            context.actor.isPlatformAdmin
              ? "Add your first client to start building their MemBrain."
              : "You have not been assigned to a client account yet. Ask an account lead to add you."
          }
          action={
            context.actor.isPlatformAdmin ? (
              <Button asChild variant="primary">
                <Link href={routes.organisations.new}>Add a client</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <QuickActions defaultOrganisationId={dashboard.defaultOrganisationId} />

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Client accounts" value={formatNumber(organisations.length)} detail={`${activeCount} active`} />
            <Stat label="MemBrain entries" value={formatNumber(knowledgeTotal)} detail="Across your accounts" />
            <Stat
              label="Accounts near a limit"
              value={formatNumber(atRisk.length)}
              detail={atRisk.length === 0 ? "All within guardrails" : "Review before publishing"}
            />
            <Stat
              label="Your access"
              value={context.actor.isPlatformAdmin ? "Platform" : "Assigned"}
              detail={context.actor.isPlatformAdmin ? "Every client account" : "Accounts you are on"}
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <MyWorkPanel myWork={dashboard.myWork} />
            <AwoInsightsPanel insights={dashboard.awoInsights} />
          </section>

          <ReviewMetricsPanel metrics={dashboard.reviewMetrics} />

          <ContentPipelinePanel pipeline={dashboard.contentPipeline} />

          <ActiveCampaignsPanel campaigns={dashboard.activeCampaigns} />

          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Accounts</CardTitle>
                  <CardDescription>Sorted by most recent activity.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href={routes.organisations.index}>
                    View all
                    <ArrowUpRight aria-hidden />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {recentlyUpdated.map((organisation) => (
                    <li key={organisation.id}>
                      <Link
                        href={routes.organisations.detail(organisation.id)}
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-card-hover"
                      >
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: organisation.brandColour ?? "var(--border-strong)" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{organisation.name}</span>
                          <span className="block truncate text-[12px] text-subtle-foreground">
                            {organisation.industry ?? "No industry set"} · updated {formatRelative(organisation.updatedAt)}
                          </span>
                        </span>
                        <span className="hidden items-center gap-1.5 font-mono text-[11px] text-subtle-foreground sm:flex">
                          <Brain className="size-3.5" aria-hidden />
                          {formatNumber(organisation.membrainEntryCount)}
                        </span>
                        <OrganisationStatusBadge status={organisation.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Portfolio guardrails</CardTitle>
                <CardDescription>Combined limits across every account you can see.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {portfolioMetrics.map((metric) => (
                  <UsageMeter key={metric.key} metric={metric} />
                ))}
              </CardContent>
            </Card>
          </section>

          <TeamActivityFeed activity={dashboard.teamActivity} />
        </>
      )}
    </div>
  );
}
