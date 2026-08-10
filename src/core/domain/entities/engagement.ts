import type { CampaignPlatform } from "./campaign";

export type EngagementDataBasis = "brand_only" | "performance_informed";
export type EngagementObjectiveType = "awareness" | "engagement" | "enquiries" | "bookings";
export type EngagementFeedbackAction = "selected" | "dismissed";
export type EngagementVariant = "recommended" | "alternative_1" | "alternative_2" | "custom";

export interface EngagementEvidence {
  sourceType: "membrain_entry" | "media_asset" | "performance_snapshot";
  sourceId: string;
  title: string;
  categoryKey?: string | null;
  version?: number;
}

export interface EngagementHashtagGroups {
  brand: string[];
  local: string[];
  service: string[];
  audience: string[];
}

export interface EngagementCreativeGuidance {
  mediaBasis: "metadata_only" | "none";
  visualHook: string;
  formatRecommendation: string;
  shareTrigger: string;
  saveTrigger: string;
  accessibilityNote: string;
}

export interface EngagementPerformanceSummary {
  sampleSize: number;
  minimumSampleSize: number;
  directionalScore: number | null;
  label: "insufficient_data" | "directional" | "performance_informed";
  championVariant: EngagementVariant | null;
  challengerVariant: EngagementVariant | null;
  variantScores: Partial<Record<EngagementVariant, { sampleSize: number; directionalScore: number }>>;
}

/**
 * An immutable, evidence-linked recommendation. It is advice for a human
 * operator, never an instruction to publish and never a promise of reach.
 */
export interface EngagementRecommendation {
  id: string;
  organisationId: string;
  draftId: string;
  draftVersion: number;
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
  objective: string | null;
  dataBasis: EngagementDataBasis;
  recommendedCaption: string;
  alternativeCaptions: string[];
  hook: string;
  cta: string;
  hashtags: EngagementHashtagGroups;
  rationale: string;
  predictedStrengths: string[];
  limitations: string[];
  creativeGuidance: EngagementCreativeGuidance;
  /** Brand-grounding confidence. This preserves the Sprint 10 confidence column. */
  confidence: number;
  performanceConfidence: number | null;
  performanceSummary: EngagementPerformanceSummary;
  evidence: EngagementEvidence[];
  createdBy: string | null;
  createdAt: string;
}

export interface EngagementRecommendationWriteModel {
  organisationId: string;
  draftId: string;
  draftVersion: number;
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
  objective: string | null;
  dataBasis: EngagementDataBasis;
  recommendedCaption: string;
  alternativeCaptions: string[];
  hook: string;
  cta: string;
  hashtags: EngagementHashtagGroups;
  rationale: string;
  predictedStrengths: string[];
  limitations: string[];
  creativeGuidance: EngagementCreativeGuidance;
  confidence: number;
  performanceConfidence: number | null;
  performanceSummary: EngagementPerformanceSummary;
  evidence: EngagementEvidence[];
  createdBy: string;
}

export interface EngagementFeedbackEvent {
  id: string;
  organisationId: string;
  draftId: string;
  recommendationId: string;
  action: EngagementFeedbackAction;
  variant: EngagementVariant | null;
  captionSnapshot: string | null;
  hashtagSnapshot: string[];
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface EngagementFeedbackWriteModel {
  organisationId: string;
  draftId: string;
  recommendationId: string;
  action: EngagementFeedbackAction;
  variant: EngagementVariant | null;
  captionSnapshot: string | null;
  hashtagSnapshot: string[];
  reason: string | null;
  createdBy: string;
}

export interface EngagementMetricSnapshot {
  id: string;
  organisationId: string;
  draftId: string;
  publishingAttemptId: string;
  recommendationId: string | null;
  feedbackEventId: string | null;
  selectedVariant: EngagementVariant | null;
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
  /** Exact Blotato destination used for the publish; null only for legacy attempts. */
  providerAccountId: string | null;
  externalPostId: string;
  providerSnapshotKey: string;
  observedAt: string;
  providerCapturedAt: string | null;
  metrics: Record<string, number | null>;
  rawMetrics: Record<string, unknown>;
  createdAt: string;
}

export type EngagementMetricSnapshotWriteModel = Omit<EngagementMetricSnapshot, "id" | "createdAt">;

export interface EngagementMetricSnapshotInsertResult {
  snapshot: EngagementMetricSnapshot;
  created: boolean;
}

export interface EngagementLearningOverview {
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
  accountScope: "account_scoped" | "no_account" | "multiple_accounts";
  providerAccountId: string | null;
  latestFeedback: EngagementFeedbackEvent | null;
  latestDraftMetric: EngagementMetricSnapshot | null;
  performanceSummary: EngagementPerformanceSummary & { performanceConfidence: number | null };
}
