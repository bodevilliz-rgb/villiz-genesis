import type { CampaignPlatform, CampaignStatus, CampaignTimelineProgress } from "./campaign";
import type { CampaignReadiness } from "./generation";
import type { ContentDraftStatus } from "./content";

/**
 * The five stages an operator asked to see visualised. Only the first three
 * ("draft", "needsReview", "approved") map to a real `ContentDraftStatus` —
 * "readyForAwo" is Content Studio's orthogonal `awoStatus` flag surfaced as
 * its own count rather than squeezed between Draft and Approved (a draft can
 * be Draft *and* Ready for Awo at once, so it cannot honestly be a sequential
 * stage). "readyToPublish" and "published" have no backing status anywhere
 * in this schema — Publishing/Blotato is out of scope for every sprint so
 * far — so they always render as static, zero-count, "not yet built" stages
 * rather than being fabricated from data that does not mean that.
 */
export type ContentPipelineStageKey =
  | "draft"
  | "needsReview"
  | "approved"
  | "scheduled"
  | "publishing"
  | "failed"
  | "published";

export interface ContentPipelineStage {
  key: ContentPipelineStageKey;
  label: string;
  count: number;
  /** False for the two stages that have no backing data source yet. */
  isTracked: boolean;
}

export interface ContentPipelineSummary {
  stages: ContentPipelineStage[];
  totalDrafts: number;
}

export type DashboardActivityKind = "membrain" | "content" | "campaign";

/**
 * One entry in the Team Activity feed. Built entirely from existing,
 * already-authored records (MemBrain/content-draft version history, campaign
 * `updated_by`/`updated_at`) — there is no dedicated audit-log table in this
 * schema, so nothing here is a new kind of tracked fact, only a merged view
 * of facts already recorded for other reasons.
 */
export interface DashboardActivityItem {
  id: string;
  kind: DashboardActivityKind;
  organisationId: string;
  organisationName: string;
  entityId: string;
  entityTitle: string;
  action: string;
  actor: { id: string; fullName: string | null; email: string } | null;
  occurredAt: string;
}

export interface MyWorkReview {
  draftId: string;
  organisationId: string;
  organisationName: string;
  title: string;
  updatedAt: string;
}

export interface MyWorkDraft {
  draftId: string;
  organisationId: string;
  organisationName: string;
  title: string;
  status: ContentDraftStatus;
  updatedAt: string;
}

export interface MyWorkCampaign {
  campaignId: string;
  organisationId: string;
  organisationName: string;
  name: string;
  status: CampaignStatus;
}

export interface MyWork {
  assignedCampaigns: MyWorkCampaign[];
  recentDrafts: MyWorkDraft[];
  reviewsWaiting: MyWorkReview[];
  publishingQueue: Array<{
    draftId: string;
    organisationId: string;
    organisationName: string;
    title: string;
    status: ContentDraftStatus;
    scheduledAt: string | null;
    platforms: string[];
  }>;
  recentActivity: DashboardActivityItem[];
}

/**
 * The per-campaign-card content the dashboard's "Active Campaigns" section
 * asked for — composed entirely from Sprint 3.2/3.5 engines already built
 * (computeCampaignTimelineProgress, resolveCampaignReadiness) plus the
 * existing draft-count-per-campaign, rather than a new scoring mechanism.
 */
export interface CampaignHealth {
  campaignId: string;
  organisationId: string;
  organisationName: string;
  name: string;
  status: CampaignStatus;
  platforms: CampaignPlatform[];
  draftCount: number;
  timeline: CampaignTimelineProgress;
  readiness: CampaignReadiness | null;
}

export type AwoInsightSeverity = "info" | "attention";

/**
 * A single operational observation, reusing the same deterministic
 * readiness rules the draft-level Generation Readiness panel uses
 * (resolveCampaignReadiness, computeMembrainReadiness) but applied at
 * portfolio scale — never a per-draft re-run of the full generation
 * context, which would be far more expensive than a dashboard widget needs.
 */
export interface AwoInsight {
  kind: "knowledge" | "campaign_readiness";
  severity: AwoInsightSeverity;
  organisationId: string;
  organisationName: string;
  campaignId?: string;
  message: string;
}

/**
 * Real approval data only — every count here is computed from the same
 * bounded draft fetch getDashboardHome already makes (no extra queries,
 * except one bulk lookup for averageTurnaroundMinutes). averageTurnaroundMinutes
 * is null, not zero or fabricated, whenever nothing was approved today —
 * there is nothing true to average.
 */
export interface ReviewMetrics {
  waitingForAssignment: number;
  assignedToMe: number;
  returnedForChanges: number;
  approvedToday: number;
  averageTurnaroundMinutes: number | null;
}

/**
 * Organisation-scoped readiness already fetched for the Command Centre.
 * Exposed as a shared read model so Awo Social Intelligence can explain the
 * same facts without issuing another query or reimplementing readiness rules.
 */
export interface ClientSocialIntelligence {
  organisationId: string;
  organisationName: string;
  membrainReadinessPercent: number;
  activeCampaigns: CampaignHealth[];
}

export interface DashboardHome {
  myWork: MyWork;
  activeCampaigns: CampaignHealth[];
  contentPipeline: ContentPipelineSummary;
  teamActivity: DashboardActivityItem[];
  awoInsights: AwoInsight[];
  reviewMetrics: ReviewMetrics;
  clientSocialIntelligence: ClientSocialIntelligence[];
  /** The most recently updated organisation the actor can see — used to target org-scoped Quick Actions. */
  defaultOrganisationId: string | null;
}
