import type {
  EngagementRecommendation,
  EngagementRecommendationWriteModel,
} from "@/core/domain/entities/engagement";

export interface EngagementRepository {
  create(input: EngagementRecommendationWriteModel): Promise<EngagementRecommendation>;
  findLatest(organisationId: string, draftId: string): Promise<EngagementRecommendation | null>;
}
