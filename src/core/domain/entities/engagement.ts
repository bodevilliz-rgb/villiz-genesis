import type { CampaignPlatform } from "./campaign";
import type { CommercialIntent, CulturalVoiceLevel, MarketHashtagRole } from "./market-intelligence";

export type EngagementDataBasis = "brand_only" | "performance_informed";
export type EngagementObjectiveType = "awareness" | "engagement" | "enquiries" | "bookings";
export type EngagementFeedbackAction = "selected" | "dismissed";
export type EngagementVariant = "recommended" | "alternative_1" | "alternative_2" | "custom";
export type EngagementMeasurementWindow = "under_24h" | "24h" | "72h" | "7d";

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
  audienceCultural?: string[];
  occasionTopic?: string[];
  campaign?: string[];
}

export interface EngagementStrategyMetadata {
  commercialIntent: CommercialIntent;
  commercialIntentSource?: "operator" | "recommended";
  contentJob?: EngagementVisibilityPlan["contentJob"];
  hookFamily: string | null;
  actualHook?: string | null;
  ctaType: "conversion" | "conversation" | "trust_step" | null;
  contentPillar: string | null;
  destinationAccountId?: string | null;
  destinationPlatform?: CampaignPlatform;
  marketPatternIds: string[];
  hashtagRoleMix: MarketHashtagRole[];
  culturalVoiceLevel: CulturalVoiceLevel;
  contentFormat?: VisibilityContentFormat;
  visibilityStrategyVersion?: string;
  visibilityEvidenceLevel?: VisibilityEvidenceLevel;
  foundationVersion?: string;
  growthDecisionEvidenceSources?: string[];
  discoveryStrategy?: string;
  measurementPlan?: string;
  supportingDistributionActions?: string[];
  pillarSourceEntryId?: string | null;
  pillarSemanticLabel?: string | null;
  pillarChoiceVersion?: string | null;
}

/** Request-scoped AGIE result handed into the existing immutable engagement recommendation path once a new draft has an id. */
export interface AwoGenerationAttribution {
  caption: string;
  platform: CampaignPlatform;
  destinationAccountId: string | null;
  mediaAssetIds: string[];
  commercialIntent: CommercialIntent;
  commercialIntentSource: "operator" | "recommended";
  culturalVoiceLevel: CulturalVoiceLevel;
  visibilityPlan: EngagementVisibilityPlan;
  suggestedHashtags: string[];
  pillarSourceEntryId?: string | null;
  pillarSemanticLabel?: string | null;
  pillarChoiceVersion?: string | null;
}

export type VisibilityContentFormat = "short_form_video" | "carousel" | "single_image" | "supporting_story" | "text_led" | "other_supported";
export type VisibilityHookFamily = "outcome_led" | "transformation" | "curiosity" | "confidence" | "educational" | "social_proof" | "occasion_milestone" | "problem_solution" | "authority" | "story" | "question" | "proof_result";
export type VisibilityEvidenceLevel = "CLIENT_EVIDENCE" | "MARKET_EVIDENCE" | "FOUNDATION_HYPOTHESIS" | "FOUNDATION_AND_MARKET" | "MARKET_PATTERN" | "VERTICAL_HYPOTHESIS" | "GENERAL_PLATFORM_OPTION" | "INSUFFICIENT_EVIDENCE";

export interface EngagementVisibilityPlan {
  goal: CommercialIntent;
  goalRationale: string;
  contentJob: "DISCOVERY" | "AUTHORITY" | "PROOF" | "CONVERSION";
  targetAudience: string;
  mediaObservation: string;
  contentPillar: string;
  contentPillarRationale: string;
  contentFormat: VisibilityContentFormat;
  formatRationale: string;
  attentionMechanism: string;
  hookStrategy: VisibilityHookFamily;
  actualHook: string;
  discoveryStrategy: string;
  targetLocalities: string[];
  platformStrategy: string;
  discoveryRoles: MarketHashtagRole[];
  /** Deterministic pre-publish completeness check, not a reach prediction. */
  distributionReadinessScore: number;
  distributionGate: "pass" | "blocked";
  distributionBlockers: string[];
  searchableLanguage: string[];
  ctaStrategy: string;
  measurementPlan: string;
  supportingDistributionActions: string[];
  publishingWindow: string;
  publishingWindowEvidenceState: "INSUFFICIENT_ACCOUNT_EVIDENCE" | "ACCOUNT_EVIDENCE";
  visibilityEvidenceLevel: VisibilityEvidenceLevel;
  verticalIntelligenceAvailable: boolean;
  evidenceSources: string[];
  confidence: number;
  foundationVersion: string;
  rationale: string;
}

export type LinkedInPostArchetype =
  | "professional_story"
  | "lesson_learned"
  | "how_to"
  | "case_study"
  | "point_of_view"
  | "behind_the_scenes";

export interface LinkedInReadinessDimensions {
  hook: number;
  singleIdea: number;
  personalVoice: number;
  credibility: number;
  scanability: number;
  conversationCta: number;
}

/**
 * An editorial check for a LinkedIn personal-profile post. The score is a
 * deterministic normalisation of six audited rubric dimensions, structural
 * calibration and unresolved pre-publish actions; it is not a reach prediction
 * and must never be presented as one.
 */
export interface LinkedInPersonalProfileGuidance {
  accountType: "personal_profile";
  postArchetype: LinkedInPostArchetype;
  readinessScore: number;
  audiencePromise: string;
  credibilityAnchor: string;
  conversationPrompt: string;
  dimensions: LinkedInReadinessDimensions;
  improvementActions: string[];
  /** MemBrain entries explicitly accepted by the independent audit as support. */
  credibilityEvidenceIds?: string[];
  /** Present only after the separate post-generation grounding pass succeeds. */
  auditStatus?: "passed";
  /** One normal audit, or two when one bounded repair was required. */
  auditAttempts?: 1 | 2;
}

export interface EngagementCreativeGuidance {
  mediaBasis: "metadata_only" | "none";
  visualHook: string;
  formatRecommendation: string;
  shareTrigger: string;
  saveTrigger: string;
  accessibilityNote: string;
  /** Optional because recommendations created before Sprint 15 do not contain it. */
  linkedinPersonalProfile?: LinkedInPersonalProfileGuidance | null;
  visibilityPlan?: EngagementVisibilityPlan;
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
  strategyMetadata?: EngagementStrategyMetadata;
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
  strategyMetadata: EngagementStrategyMetadata;
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
  appliedDraftVersion: number | null;
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
  /** Fixed post-age checkpoint used for like-for-like comparisons. */
  measurementWindow: EngagementMeasurementWindow | null;
  metrics: Record<string, number | null>;
  rawMetrics: Record<string, unknown>;
  createdAt: string;
}

export type EngagementMetricSnapshotWriteModel = Omit<EngagementMetricSnapshot, "id" | "createdAt">;

export interface EngagementMetricSnapshotInsertResult {
  snapshot: EngagementMetricSnapshot;
  created: boolean;
}

export interface EngagementApplicationResult {
  feedback: EngagementFeedbackEvent;
  draftVersion: number;
}

export interface EngagementCommercialOutcome {
  id: string;
  organisationId: string;
  draftId: string;
  publishingAttemptId: string;
  platform: CampaignPlatform;
  providerAccountId: string;
  enquiries: number;
  bookings: number;
  revenueMinor: number;
  currency: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type EngagementCommercialOutcomeWriteModel = Omit<EngagementCommercialOutcome, "id" | "createdAt">;

export interface EngagementExclusionSummary {
  code: "missing_analytics" | "missing_attribution" | "awaiting_7d_checkpoint";
  count: number;
  label: string;
}

export interface EngagementLearningOverview {
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
  accountScope: "account_scoped" | "no_account" | "multiple_accounts";
  providerAccountId: string | null;
  latestFeedback: EngagementFeedbackEvent | null;
  latestDraftMetric: EngagementMetricSnapshot | null;
  /**
   * Immutable snapshots for the latest published post on this draft, scoped
   * to the selected platform and destination account. This deliberately
   * excludes older publishing attempts so the UI cannot blend two posts.
   */
  latestPostMetrics: EngagementMetricSnapshot[];
  latestCommercialOutcome: EngagementCommercialOutcome | null;
  lastAnalyticsSyncAt: string | null;
  nextScheduledCollectionAt: string;
  checkpoints: { hours24: boolean; hours72: boolean; days7: boolean };
  exclusions: EngagementExclusionSummary[];
  performanceSummary: EngagementPerformanceSummary & { performanceConfidence: number | null };
}
