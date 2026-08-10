import type { EngagementFeedbackEvent, EngagementMetricSnapshot, EngagementRecommendation } from "@/core/domain/entities/engagement";
import type { EngagementFeedbackEventRow, EngagementMetricSnapshotRow, EngagementRecommendationRow } from "@/infrastructure/supabase/database.types";

export function toEngagementRecommendation(row: EngagementRecommendationRow): EngagementRecommendation {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    draftId: row.draft_id,
    draftVersion: row.draft_version,
    platform: row.platform,
    objectiveType: row.objective_type,
    objective: row.objective,
    dataBasis: row.data_basis,
    recommendedCaption: row.recommended_caption,
    alternativeCaptions: row.alternative_captions,
    hook: row.hook,
    cta: row.cta,
    hashtags: row.hashtag_groups as unknown as EngagementRecommendation["hashtags"],
    rationale: row.rationale,
    predictedStrengths: row.predicted_strengths,
    limitations: row.limitations,
    creativeGuidance: row.creative_guidance as unknown as EngagementRecommendation["creativeGuidance"],
    confidence: row.confidence,
    performanceConfidence: row.performance_confidence,
    performanceSummary: row.performance_summary as unknown as EngagementRecommendation["performanceSummary"],
    evidence: row.evidence as unknown as EngagementRecommendation["evidence"],
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function toEngagementFeedbackEvent(row: EngagementFeedbackEventRow): EngagementFeedbackEvent {
  return {
    id: row.id, organisationId: row.organisation_id, draftId: row.draft_id,
    recommendationId: row.recommendation_id, action: row.action, variant: row.variant,
    captionSnapshot: row.caption_snapshot, hashtagSnapshot: row.hashtag_snapshot,
    reason: row.reason, createdBy: row.created_by, createdAt: row.created_at,
  };
}

export function toEngagementMetricSnapshot(row: EngagementMetricSnapshotRow): EngagementMetricSnapshot {
  return {
    id: row.id, organisationId: row.organisation_id, draftId: row.draft_id,
    publishingAttemptId: row.publishing_attempt_id, recommendationId: row.recommendation_id,
    feedbackEventId: row.feedback_event_id, selectedVariant: row.selected_variant,
    platform: row.platform, objectiveType: row.objective_type,
    providerAccountId: row.provider_account_id,
    externalPostId: row.external_post_id, providerSnapshotKey: row.provider_snapshot_key,
    observedAt: row.observed_at, providerCapturedAt: row.provider_captured_at,
    metrics: { views: row.views, reach: row.reach, impressions: row.impressions, likes: row.likes,
      comments: row.comments, shares: row.shares, saves: row.saves, clicks: row.clicks,
      profileVisits: row.profile_visits, enquiries: row.enquiries, bookings: row.bookings,
      watchTimeMs: row.watch_time_ms },
    rawMetrics: row.raw_metrics as Record<string, unknown>, createdAt: row.created_at,
  };
}
