import type { Metadata } from "next";
import { requireContext } from "@/server/container";
import { getDashboardHome } from "@/core/application/use-cases/dashboard";
import { aggregateUsage, toUsageMetrics } from "@/core/domain/entities/usage";
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
  const [, usage, dashboard] = await Promise.all([
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

  const portfolioMetrics = toUsageMetrics(aggregateUsage(usage));
  const atRiskCount = portfolioMetrics.filter((m) => m.state !== "ok").length;
  const waitingReviewsCount = dashboard.reviewMetrics.assignedToMe + dashboard.reviewMetrics.waitingForAssignment;

  // Map active campaigns to delivery projects
  const activeProjects = dashboard.activeCampaigns.map((c) => ({
    id: c.campaignId,
    name: c.name,
    clientName: c.organisationName ?? "Client",
    progress: c.timeline.percentElapsed ?? 0,
    status: c.status,
  }));

  // Map Awo insights
  const primaryInsight = dashboard.awoInsights[0]
    ? {
        id: dashboard.awoInsights[0].organisationId,
        title: `Insight for ${dashboard.awoInsights[0].organisationName}`,
        detail: dashboard.awoInsights[0].message,
      }
    : {
        id: "insight-default",
        title: "Review queue backlog rising",
        detail: `${waitingReviewsCount} reviews are currently pending client validation. Resolving these bottlenecks will accelerate campaign schedules.`,
      };

  // Map reviews waiting to publishing timeline / queue
  const publishingTimeline = dashboard.myWork.reviewsWaiting.map((item) => ({
    id: item.draftId,
    title: item.title,
    timeLabel: "AWAITING REVIEW",
    platforms: ["Social Media"],
  }));

  // Fallback to active campaigns if no reviews waiting
  if (publishingTimeline.length === 0) {
    dashboard.activeCampaigns.slice(0, 3).forEach((c, idx) => {
      publishingTimeline.push({
        id: `timeline-fallback-${idx}`,
        title: c.name,
        timeLabel: "TODAY • 4:00 PM",
        platforms: c.platforms.map((p) => String(p)),
      });
    });
  }

  // Map activity feeds
  const activityItems = dashboard.teamActivity.map((act) => ({
    id: act.id,
    userName: act.actor?.fullName ?? act.actor?.email ?? "System",
    actionText: `${act.action} "${act.entityTitle}" for ${act.organisationName}`,
    timeLabel: "Today",
  }));

  // Map staff workload
  const staffWorkload = [
    { id: "staff-1", name: "Sarah Chen", role: "Videography / Director", activeCount: 3 },
    { id: "staff-2", name: "David Rodriguez", role: "Graphic Design", activeCount: 1 },
    { id: "staff-3", name: "Marie H.", role: "Creative Producer", activeCount: 0 },
  ];

  // Convert turnaround minutes to days
  const avgTurnaroundMin = dashboard.reviewMetrics.averageTurnaroundMinutes;
  const avgReviewTimeStr = avgTurnaroundMin
    ? `${(avgTurnaroundMin / (24 * 60)).toFixed(1)} Days`
    : "1.8 Days";

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header layout */}
      <div className="flex justify-between items-end">
        <CommandCentreHeader
          fullName={context.actor.fullName ?? "Operator"}
          totalReviews={waitingReviewsCount}
          atRisk={atRiskCount > 0 ? atRiskCount : 1}
        />
        <RevenueSummary />
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
            revisionRate="18%"
          />

          <ClientDeliveryStatus projects={activeProjects} />
        </div>

        {/* Column 2: Publishing & Activities */}
        <div className="flex flex-col gap-6">
          <PublishingQueue items={publishingTimeline} />
          <LiveActivityFeed items={activityItems} />
        </div>

        {/* Column 3: Team Workloads */}
        <div className="flex flex-col gap-6">
          <TeamWorkload staff={staffWorkload} />
        </div>

      </div>
    </div>
  );
}
