import "server-only";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { EngagementRecommendationWriteModel } from "@/core/domain/entities/engagement";
import type { Json } from "@/infrastructure/supabase/database.types";
import type { GenesisClient } from "@/infrastructure/supabase/server-client";
import { toEngagementRecommendation } from "@/infrastructure/mappers/engagement-mapper";
import { translateError, unwrap } from "./errors";

export class SupabaseEngagementRepository implements EngagementRepository {
  constructor(private readonly client: GenesisClient) {}

  async create(input: EngagementRecommendationWriteModel) {
    const result = await this.client
      .from("engagement_recommendations")
      .insert({
        organisation_id: input.organisationId,
        draft_id: input.draftId,
        draft_version: input.draftVersion,
        platform: input.platform,
        objective: input.objective,
        data_basis: input.dataBasis,
        recommended_caption: input.recommendedCaption,
        alternative_captions: input.alternativeCaptions,
        hook: input.hook,
        cta: input.cta,
        hashtag_groups: input.hashtags as unknown as Json,
        rationale: input.rationale,
        predicted_strengths: input.predictedStrengths,
        limitations: input.limitations,
        confidence: input.confidence,
        evidence: input.evidence as unknown as Json,
        created_by: input.createdBy,
      })
      .select("*")
      .single();

    return toEngagementRecommendation(unwrap(result, "Engagement recommendation"));
  }

  async findLatest(organisationId: string, draftId: string) {
    const { data, error } = await this.client
      .from("engagement_recommendations")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) translateError(error, "Engagement recommendation");
    return data ? toEngagementRecommendation(data) : null;
  }
}
