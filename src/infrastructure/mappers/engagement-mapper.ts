import type { EngagementRecommendation } from "@/core/domain/entities/engagement";
import type { EngagementRecommendationRow } from "@/infrastructure/supabase/database.types";

export function toEngagementRecommendation(row: EngagementRecommendationRow): EngagementRecommendation {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    draftId: row.draft_id,
    draftVersion: row.draft_version,
    platform: row.platform,
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
    confidence: row.confidence,
    evidence: row.evidence as unknown as EngagementRecommendation["evidence"],
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
