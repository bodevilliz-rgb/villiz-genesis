import type { Metadata } from "next";
import { requireContext } from "@/server/container";
import { getDashboardHome } from "@/core/application/use-cases/dashboard";
import { getPublishingAnalyticsForActor } from "@/core/application/use-cases/publishing";
import { buildExecutiveAttention } from "@/components/dashboard/executive-attention";
import {
  ClientIntelligence,
  EngagementIntelligenceBoundary,
  OperationalIntelligencePanel,
  PriorityIntelligence,
  SocialPriorities,
  type AwoPriority,
} from "@/components/awo/social-intelligence-workspace";
import { PageHeader } from "@/components/common/page-header";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Awo · Social Intelligence" };

export default async function AwoSocialIntelligencePage() {
  const context = await requireContext();
  const [organisations, dashboard, publishing] = await Promise.all([
    context.organisations.listForActor(),
    getDashboardHome({
      actor: context.actor,
      organisations: context.organisations,
      campaigns: context.campaigns,
      content: context.content,
      membrain: context.membrain,
      reviews: context.reviews,
    }),
    getPublishingAnalyticsForActor({ publishing: context.publishing }),
  ]);

  const reviewsRequiringApproval = dashboard.reviewMetrics.assignedToMe + dashboard.reviewMetrics.waitingForAssignment;
  const singleOrganisationId = organisations.length === 1 ? organisations[0]?.id ?? null : null;
  const publishingHref = singleOrganisationId
    ? `${routes.organisations.publishing.index(singleOrganisationId)}?tab=failed`
    : routes.publishing;

  const readinessItems = dashboard.awoInsights.map((insight) => {
    const href = insight.kind === "knowledge"
      ? routes.organisations.membrain.index(insight.organisationId)
      : insight.campaignId
        ? routes.organisations.campaigns.detail(insight.organisationId, insight.campaignId)
        : routes.organisations.detail(insight.organisationId);
    return {
      title: `Insight for ${insight.organisationName}`,
      detail: insight.message,
      href,
      actionLabel: insight.kind === "knowledge" ? "Open MemBrain" : "Open campaign",
    };
  });

  const attention = buildExecutiveAttention({
    failedPublications: publishing.jobsFailedRequiringAttention,
    reviewsRequiringApproval,
    publishingHref,
    reviewHref: routes.review,
    readinessItems,
  });

  const priorities: AwoPriority[] = attention.map((item) => ({
    ...item,
    interpretation: item.kind === "failure"
      ? "Failed publishing jobs have not reached a successful terminal state and need operator triage."
      : item.kind === "review"
        ? "Content waiting in review cannot progress through the existing approval workflow until an authorised operator acts."
        : item.detail,
    recommendedAction: item.kind === "failure"
      ? "Inspect the failed jobs and use the existing retry or reconciliation controls only where they are available."
      : item.kind === "review"
        ? "Open Reviews and resolve the items you are authorised to action."
        : `Use ${item.actionLabel} to address the readiness issue at its source.`,
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Genesis intelligence"
        title="Awo · Social Intelligence"
        description="Awo interprets current social-operation signals, explains why they matter, and directs you to the appropriate Genesis workspace."
      />

      <SocialPriorities priorities={priorities} />
      <PriorityIntelligence priority={priorities[0] ?? null} />
      <ClientIntelligence
        clients={dashboard.clientSocialIntelligence}
        membrainHref={routes.organisations.membrain.index}
        campaignHref={routes.organisations.campaigns.detail}
      />
      <OperationalIntelligencePanel intelligence={{
        failedPublications: publishing.jobsFailedRequiringAttention,
        queuedPublications: publishing.jobsQueued,
        processingPublications: publishing.jobsProcessing,
        publishingSuccessRate: publishing.jobSuccessRate,
        reviewsRequiringApproval,
        publishingHref,
        reviewHref: routes.review,
      }} />
      <EngagementIntelligenceBoundary />
    </div>
  );
}
