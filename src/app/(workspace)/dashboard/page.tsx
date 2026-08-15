import type { Metadata } from "next";
import { requireContext } from "@/server/container";
import { getDashboardHome } from "@/core/application/use-cases/dashboard";
import { getPublishingAnalyticsForActor, listPublishingQueue } from "@/core/application/use-cases/publishing";
import { PUBLISHING_PLATFORM_LABELS } from "@/core/domain/entities/publishing";
import { PublishingEngineWidget } from "@/components/dashboard/publishing-engine-widget";
import { ExecutiveAttention, buildExecutiveAttention } from "@/components/dashboard/executive-attention";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";
import {
  CommandCentreHeader,
  RevenueSummary,
  AwoRecommendationCard,
  AgencyHealthIndex,
  ClientDeliveryStatus,
  PublishingQueue,
  LiveActivityFeed,
  TeamWorkload,
} from "@/components/dashboard/command-centre-components";

export const metadata: Metadata = { title: "Command Centre" };

export default async function DashboardPage() {
  const context = await requireContext();
  const publishingDeps = {
    actor: context.actor,
    publishing: context.publishing,
    blotatoAccounts: context.blotatoAccounts,
    content: context.content,
    organisations: context.organisations,
    audits: context.audits,
    notifications: context.notifications,
  };

  const [organisations, dashboard, publishingAnalytics, activePublishingJobs] = await Promise.all([
    context.organisations.listForActor(),
    getDashboardHome({
      actor: context.actor,
      organisations: context.organisations,
      campaigns: context.campaigns,
      content: context.content,
      membrain: context.membrain,
      reviews: context.reviews,
    }),
    getPublishingAnalyticsForActor(publishingDeps),
    listPublishingQueue(publishingDeps, { status: "queued", limit: 10, offset: 0 }),
  ]);

  // The Publishing Queue timeline reads real publishing_jobs rows, not
  // content_drafts.status — a "Publishing" job must never be misclassified
  // as still "Approved" here.
  const publishingJobItems = await Promise.all(
    activePublishingJobs.slice(0, 5).map(async (job) => {
      const draft = await context.content.findDraft(job.organisationId, job.draftId);
      return {
        id: job.id,
        title: draft?.title ?? "Untitled draft",
        timeLabel: new Date(job.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        platforms: [PUBLISHING_PLATFORM_LABELS[job.platform]],
      };
    }),
  );

  const waitingReviewsCount = dashboard.reviewMetrics.assignedToMe + dashboard.reviewMetrics.waitingForAssignment;

  // Map active campaigns to delivery projects
  const activeProjects = dashboard.activeCampaigns.map((c) => ({
    id: c.campaignId,
    name: c.name,
    clientName: c.organisationName ?? "Client",
    progress: c.timeline.percentElapsed,
    status: c.status,
  }));

  // Map Awo insights
  const primaryInsight = dashboard.awoInsights[0]
    ? (() => {
        const insight = dashboard.awoInsights[0];
        const campaignHref = insight.campaignId
          ? routes.organisations.campaigns.detail(insight.organisationId, insight.campaignId)
          : routes.organisations.detail(insight.organisationId);
        return {
          id: insight.organisationId,
          title: `Insight for ${insight.organisationName}`,
          detail: insight.message,
          type: insight.severity,
          href: insight.kind === "knowledge" ? routes.organisations.membrain.index(insight.organisationId) : campaignHref,
          actionLabel: insight.kind === "knowledge" ? "Open MemBrain" : "Open campaign",
        };
      })()
    : undefined;

  // Publishing timeline — sourced from real publishing_jobs rows (fetched
  // above as activePublishingJobs/publishingJobItems), not content_drafts.
  const publishingTimeline = [...publishingJobItems];

  // Map activity feeds
  const activityItems = dashboard.teamActivity.map((act) => ({
    id: act.id,
    userName: act.actor?.fullName ?? act.actor?.email ?? "System",
    actionText: `${act.action} "${act.entityTitle}" for ${act.organisationName}`,
    timeLabel: formatRelative(act.occurredAt),
  }));

  // Genesis has real member identities, but no authoritative cross-account
  // workload/assignment model. Keep the card honest until one exists.
  const staffWorkload: [] = [];

  // The Publishing Queue is inherently per-organisation, but this widget
  // rolls up analytics across every organisation the actor can see. A deep
  // link into "the relevant queue tab" is only unambiguous when there's
  // exactly one organisation to link into — otherwise it degrades to plain,
  // unlinked stats rather than guessing which account to send the actor to.
  const singleOrganisationId = organisations.length === 1 ? (organisations[0]?.id ?? null) : null;

  // Executive attention is ordered by operational consequence: failed
  // publishing first, approvals blocking workflow second, readiness third.
  // Items only exist when their persisted/derived count or insight exists.
  const attentionItems = buildExecutiveAttention({
    failedPublications: publishingAnalytics.jobsFailedRequiringAttention,
    reviewsRequiringApproval: waitingReviewsCount,
    publishingHref: singleOrganisationId
      ? `${routes.organisations.publishing.index(singleOrganisationId)}?tab=failed`
      : routes.publishing,
    reviewHref: routes.review,
    readiness: primaryInsight
      ? {
          title: primaryInsight.title,
          detail: primaryInsight.detail,
          href: primaryInsight.href,
          actionLabel: primaryInsight.actionLabel,
        }
      : undefined,
  });

  // Convert turnaround minutes to days
  const avgTurnaroundMin = dashboard.reviewMetrics.averageTurnaroundMinutes;
  const avgReviewTimeStr = avgTurnaroundMin === null
    ? "—"
    : avgTurnaroundMin < 60
      ? `${avgTurnaroundMin} min`
      : avgTurnaroundMin < 24 * 60
        ? `${(avgTurnaroundMin / 60).toFixed(1)} hr`
        : `${(avgTurnaroundMin / (24 * 60)).toFixed(1)} days`;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header layout */}
      <div className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <CommandCentreHeader
          fullName={context.actor.fullName}
          initialGreetingHour={new Date().getHours()}
          totalReviews={waitingReviewsCount}
          atRisk={null}
        />
        <RevenueSummary />
      </div>

      <ExecutiveAttention items={attentionItems} />

      <div className="flex items-center gap-3 pt-1">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle-foreground">Operational health</h2>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* 3-Column High Density Command Center Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr_1fr] items-start">
        
        {/* Column 1: Awo Warnings & Agency Health */}
        <div className="flex flex-col gap-6">
          <AwoRecommendationCard 
            insight={primaryInsight} 
          />
          
          <AgencyHealthIndex
            avgReviewTime={avgReviewTimeStr}
            pendingReviews={waitingReviewsCount}
            revisionRate="—"
          />

          <ClientDeliveryStatus projects={activeProjects} />
        </div>

        {/* Column 2: Publishing & Activities */}
        <div className="flex flex-col gap-6">
          <PublishingEngineWidget analytics={publishingAnalytics} organisationId={singleOrganisationId} />
          <PublishingQueue items={publishingTimeline} />
        </div>

        {/* Column 3: Team Workloads */}
        <div className="flex flex-col gap-6">
          <TeamWorkload staff={staffWorkload} />
        </div>

      </div>

      <div className="flex items-center gap-3 pt-1">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle-foreground">Live activity</h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      <LiveActivityFeed items={activityItems} />
    </div>
  );
}
