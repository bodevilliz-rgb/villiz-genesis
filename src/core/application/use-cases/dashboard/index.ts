import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import { canApproveContent } from "@/core/domain/entities/identity";
import { computeCampaignTimelineProgress, type Campaign, type CampaignListItem } from "@/core/domain/entities/campaign";
import type { ContentDraft } from "@/core/domain/entities/content";
import type {
  AwoInsight,
  CampaignHealth,
  ContentPipelineStage,
  ContentPipelineStageKey,
  ContentPipelineSummary,
  DashboardActivityItem,
  DashboardHome,
  MyWork,
  ReviewMetrics,
} from "@/core/domain/entities/dashboard";
import type { CampaignReadiness, CampaignContext } from "@/core/domain/entities/generation";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { ReviewRepository } from "@/core/application/ports/review-port";
import { resolveCampaignReadiness } from "@/core/application/use-cases/generation/campaign-resolver";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";

interface DashboardDeps {
  actor: Actor;
  organisations: OrganisationRepository;
  campaigns: CampaignRepository;
  content: ContentRepository;
  membrain: MembrainRepository;
  reviews: ReviewRepository;
}

const DRAFT_FETCH_LIMIT = 300;
const CAMPAIGN_FETCH_LIMIT = 200;
const ACTIVITY_FETCH_LIMIT_PER_SOURCE = 15;
const MY_WORK_LIST_LIMIT = 5;
const TEAM_ACTIVITY_LIMIT = 20;
const AWO_INSIGHT_LIMIT = 8;

/** Below this, a MemBrain coverage insight is worth surfacing on the dashboard. */
const KNOWLEDGE_COVERAGE_ATTENTION_THRESHOLD = 100;
/** Below this, a campaign readiness insight is worth surfacing. */
const CAMPAIGN_READINESS_ATTENTION_THRESHOLD = 100;

const PIPELINE_LABELS: Record<ContentPipelineStageKey, string> = {
  draft: "Draft",
  readyForAwo: "Ready for Awo",
  needsReview: "Needs review",
  approved: "Approved",
  readyToPublish: "Ready to publish",
  published: "Published",
};

function toCampaignContext(campaign: Campaign | CampaignListItem): CampaignContext {
  return {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    targetAudience: campaign.targetAudience,
    primaryCTA: campaign.primaryCTA,
    platforms: campaign.platforms,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    status: campaign.status,
  };
}

/**
 * The five stages an operator asked to see — see the note on
 * ContentPipelineStageKey for why "readyToPublish"/"published" are always
 * static zeroes rather than derived from real drafts.
 */
export function buildContentPipeline(drafts: ContentDraft[]): ContentPipelineSummary {
  const draft = drafts.filter((d) => d.status === "draft").length;
  const needsReview = drafts.filter((d) => d.status === "needs_review").length;
  const approved = drafts.filter((d) => d.status === "approved").length;
  const readyForAwo = drafts.filter((d) => d.awoStatus === "ready_for_awo").length;

  const stages: ContentPipelineStage[] = [
    { key: "draft", label: PIPELINE_LABELS.draft, count: draft, isTracked: true },
    { key: "readyForAwo", label: PIPELINE_LABELS.readyForAwo, count: readyForAwo, isTracked: true },
    { key: "needsReview", label: PIPELINE_LABELS.needsReview, count: needsReview, isTracked: true },
    { key: "approved", label: PIPELINE_LABELS.approved, count: approved, isTracked: true },
    { key: "readyToPublish", label: PIPELINE_LABELS.readyToPublish, count: 0, isTracked: false },
    { key: "published", label: PIPELINE_LABELS.published, count: 0, isTracked: false },
  ];

  return { stages, totalDrafts: draft + needsReview + approved };
}

export function mergeActivity(sources: DashboardActivityItem[][], limit: number): DashboardActivityItem[] {
  return sources
    .flat()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit);
}

export function buildMyWork(input: {
  actor: Actor;
  drafts: ContentDraft[];
  campaigns: CampaignListItem[];
  organisationNames: Map<string, string>;
  viewerRoles: Map<string, OrganisationRole | null>;
  activity: DashboardActivityItem[];
}): MyWork {
  const { actor, drafts, campaigns, organisationNames, viewerRoles, activity } = input;

  const assignedCampaigns = [...campaigns]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MY_WORK_LIST_LIMIT)
    .map((campaign) => ({
      campaignId: campaign.id,
      organisationId: campaign.organisationId,
      organisationName: organisationNames.get(campaign.organisationId) ?? "Unknown account",
      name: campaign.name,
      status: campaign.status,
    }));

  const recentDrafts = drafts
    .filter((d) => d.createdBy?.id === actor.id || d.updatedBy?.id === actor.id)
    .slice(0, MY_WORK_LIST_LIMIT)
    .map((draft) => ({
      draftId: draft.id,
      organisationId: draft.organisationId,
      organisationName: organisationNames.get(draft.organisationId) ?? "Unknown account",
      title: draft.title,
      status: draft.status,
      updatedAt: draft.updatedAt,
    }));

  const reviewsWaiting = drafts
    .filter((d) => d.status === "needs_review")
    .filter((d) => {
      const role = viewerRoles.get(d.organisationId) ?? null;
      return canApproveContent(actor, role);
    })
    .slice(0, MY_WORK_LIST_LIMIT)
    .map((draft) => ({
      draftId: draft.id,
      organisationId: draft.organisationId,
      organisationName: organisationNames.get(draft.organisationId) ?? "Unknown account",
      title: draft.title,
      updatedAt: draft.updatedAt,
    }));

  const recentActivity = activity.filter((item) => item.actor?.id === actor.id).slice(0, MY_WORK_LIST_LIMIT);

  return { assignedCampaigns, recentDrafts, reviewsWaiting, recentActivity };
}

export function buildAwoInsights(input: {
  organisationNames: Map<string, string>;
  knowledgeCoverage: Map<string, number>;
  activeCampaignReadiness: Array<{ organisationId: string; name: string; readiness: CampaignReadiness | null }>;
}): AwoInsight[] {
  const insights: AwoInsight[] = [];

  for (const [organisationId, percentage] of input.knowledgeCoverage) {
    if (percentage >= KNOWLEDGE_COVERAGE_ATTENTION_THRESHOLD) continue;
    insights.push({
      severity: percentage < 50 ? "attention" : "info",
      organisationId,
      organisationName: input.organisationNames.get(organisationId) ?? "Unknown account",
      message: `MemBrain knowledge coverage is ${percentage}% — Awo generation quality will suffer until the missing fundamentals are filled in.`,
    });
  }

  for (const campaign of input.activeCampaignReadiness) {
    if (!campaign.readiness || campaign.readiness.score >= CAMPAIGN_READINESS_ATTENTION_THRESHOLD) continue;
    const topWarning = campaign.readiness.warnings[0] ?? "some campaign planning fields are incomplete";
    insights.push({
      severity: campaign.readiness.score < 50 ? "attention" : "info",
      organisationId: campaign.organisationId,
      organisationName: input.organisationNames.get(campaign.organisationId) ?? "Unknown account",
      message: `"${campaign.name}" is ${campaign.readiness.score}% ready — ${topWarning}`,
    });
  }

  return insights.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "attention" ? -1 : 1)).slice(0, AWO_INSIGHT_LIMIT);
}

interface ActiveCampaignReadinessInput {
  organisationId: string;
  name: string;
  readiness: CampaignReadiness | null;
}

export function isSameUtcDay(isoDate: string, reference: Date): boolean {
  const date = new Date(isoDate);
  return (
    date.getUTCFullYear() === reference.getUTCFullYear() &&
    date.getUTCMonth() === reference.getUTCMonth() &&
    date.getUTCDate() === reference.getUTCDate()
  );
}

/**
 * The counting half of the Dashboard's approval metrics — everything
 * derivable from the same bounded draft fetch the rest of the dashboard
 * already makes, no extra query. Average turnaround needs one more (see
 * getDashboardHome), since it depends on *when a draft was last submitted*,
 * which isn't a column on content_drafts.
 */
export function buildReviewMetricsBase(
  drafts: ContentDraft[],
  actorId: string,
  now: Date,
): {
  waitingForAssignment: number;
  assignedToMe: number;
  returnedForChanges: number;
  approvedTodayDrafts: ContentDraft[];
} {
  const waitingForAssignment = drafts.filter((d) => d.status === "needs_review" && !d.assignedReviewer).length;
  const assignedToMe = drafts.filter(
    (d) => d.status === "needs_review" && d.assignedReviewer?.id === actorId,
  ).length;
  const returnedForChanges = drafts.filter(
    (d) => d.status === "draft" && d.lastReviewAction === "changes_requested",
  ).length;
  const approvedTodayDrafts = drafts.filter(
    (d) => d.status === "approved" && d.lastReviewAction === "approved" && d.lastReviewAt && isSameUtcDay(d.lastReviewAt, now),
  );

  return { waitingForAssignment, assignedToMe, returnedForChanges, approvedTodayDrafts };
}

/** The averaging half — pure once `submittedAtByDraftId` is already known. */
export function computeAverageTurnaroundMinutes(
  approvedTodayDrafts: ContentDraft[],
  submittedAtByDraftId: Map<string, string>,
): number | null {
  const durationsMs = approvedTodayDrafts
    .map((draft) => {
      const submittedAt = submittedAtByDraftId.get(draft.id);
      if (!submittedAt || !draft.lastReviewAt) return null;
      const ms = new Date(draft.lastReviewAt).getTime() - new Date(submittedAt).getTime();
      return ms >= 0 ? ms : null;
    })
    .filter((ms): ms is number => ms !== null);

  if (durationsMs.length === 0) return null;
  return Math.round(durationsMs.reduce((sum, ms) => sum + ms, 0) / durationsMs.length / 60000);
}

/**
 * Assembles every section of the staff home screen in one pass. Fetches are
 * bounded (a few hundred rows, mirroring the same scale assumption
 * getMembrainOverview/getContentOverview already make) and computed from a
 * single round trip per data source rather than one query per organisation —
 * the only per-organisation fan-out is the MemBrain readiness call, capped to
 * the organisations the actor can actually see (typically a handful).
 */
export async function getDashboardHome(deps: DashboardDeps): Promise<DashboardHome> {
  const organisations = await deps.organisations.listForActor();
  const organisationNames = new Map(organisations.map((o) => [o.id, o.name]));
  const viewerRoles = new Map(organisations.map((o) => [o.id, o.viewerRole]));

  const defaultOrganisationId =
    [...organisations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null;

  const [drafts, campaigns, contentActivity, campaignActivity, membrainActivity, readinessByOrg] = await Promise.all([
    deps.content.listDraftsForActor({ limit: DRAFT_FETCH_LIMIT }),
    deps.campaigns.listCampaignsForActor({ limit: CAMPAIGN_FETCH_LIMIT }),
    deps.content.listRecentActivityForActor(ACTIVITY_FETCH_LIMIT_PER_SOURCE),
    deps.campaigns.listRecentActivityForActor(ACTIVITY_FETCH_LIMIT_PER_SOURCE),
    deps.membrain.listRecentActivityForActor(ACTIVITY_FETCH_LIMIT_PER_SOURCE),
    Promise.all(
      organisations.map(async (organisation) => {
        const overview = await getMembrainOverview(
          { actor: deps.actor, membrain: deps.membrain, organisations: deps.organisations },
          organisation.id,
        );
        return [organisation.id, overview.readiness.percentage] as const;
      }),
    ),
  ]);

  const teamActivity = mergeActivity([contentActivity, campaignActivity, membrainActivity], TEAM_ACTIVITY_LIMIT);

  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const activeCampaignReadiness: ActiveCampaignReadinessInput[] = activeCampaigns.map((campaign) => ({
    organisationId: campaign.organisationId,
    name: campaign.name,
    readiness: resolveCampaignReadiness(toCampaignContext(campaign)),
  }));

  const activeCampaignHealth: CampaignHealth[] = activeCampaigns.map((campaign, index) => ({
    campaignId: campaign.id,
    organisationId: campaign.organisationId,
    organisationName: organisationNames.get(campaign.organisationId) ?? "Unknown account",
    name: campaign.name,
    status: campaign.status,
    platforms: campaign.platforms,
    draftCount: campaign.draftCount,
    timeline: computeCampaignTimelineProgress(campaign.startDate, campaign.endDate),
    readiness: activeCampaignReadiness[index]?.readiness ?? null,
  }));

  const reviewMetricsBase = buildReviewMetricsBase(drafts, deps.actor.id, new Date());
  const submittedAtByDraftId =
    reviewMetricsBase.approvedTodayDrafts.length > 0
      ? await deps.reviews.listLatestSubmissions(reviewMetricsBase.approvedTodayDrafts.map((d) => d.id))
      : new Map<string, string>();

  const reviewMetrics: ReviewMetrics = {
    waitingForAssignment: reviewMetricsBase.waitingForAssignment,
    assignedToMe: reviewMetricsBase.assignedToMe,
    returnedForChanges: reviewMetricsBase.returnedForChanges,
    approvedToday: reviewMetricsBase.approvedTodayDrafts.length,
    averageTurnaroundMinutes: computeAverageTurnaroundMinutes(reviewMetricsBase.approvedTodayDrafts, submittedAtByDraftId),
  };

  return {
    myWork: buildMyWork({
      actor: deps.actor,
      drafts,
      campaigns,
      organisationNames,
      viewerRoles,
      activity: teamActivity,
    }),
    activeCampaigns: activeCampaignHealth,
    contentPipeline: buildContentPipeline(drafts),
    teamActivity,
    awoInsights: buildAwoInsights({
      organisationNames,
      knowledgeCoverage: new Map(readinessByOrg),
      activeCampaignReadiness,
    }),
    reviewMetrics,
    defaultOrganisationId,
  };
}
