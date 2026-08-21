import type {
  EngagementRecommendation,
  EngagementRecommendationWriteModel,
  EngagementFeedbackEvent,
  EngagementFeedbackWriteModel,
  EngagementMetricSnapshot,
  EngagementMetricSnapshotWriteModel,
  EngagementMetricSnapshotInsertResult,
  EngagementApplicationResult,
  EngagementCommercialOutcome,
  EngagementCommercialOutcomeWriteModel,
} from "@/core/domain/entities/engagement";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import type { EngagementObjectiveType } from "@/core/domain/entities/engagement";

export interface EngagementRepository {
  create(input: EngagementRecommendationWriteModel): Promise<EngagementRecommendation>;
  findLatest(organisationId: string, draftId: string): Promise<EngagementRecommendation | null>;
  findById?(organisationId: string, recommendationId: string): Promise<EngagementRecommendation | null>;
  createFeedback?(input: EngagementFeedbackWriteModel): Promise<EngagementFeedbackEvent>;
  applyRecommendation?(input: Omit<EngagementFeedbackWriteModel, "action" | "reason" | "createdBy">): Promise<EngagementApplicationResult>;
  findLatestFeedback?(organisationId: string, draftId: string, before?: string): Promise<EngagementFeedbackEvent | null>;
  listFeedbackForDraft?(organisationId: string, draftId: string, before: string, limit: number): Promise<EngagementFeedbackEvent[]>;
  listMetricSnapshots?(organisationId: string, platform: CampaignPlatform, objectiveType: EngagementObjectiveType, providerAccountId: string): Promise<EngagementMetricSnapshot[]>;
  listMetricSnapshotsForDraft?(organisationId: string, draftId: string): Promise<EngagementMetricSnapshot[]>;
  listMetricSnapshotsForOrganisation?(organisationId: string, limit?: number): Promise<EngagementMetricSnapshot[]>;
  createMetricSnapshot?(input: EngagementMetricSnapshotWriteModel): Promise<EngagementMetricSnapshotInsertResult>;
  createCommercialOutcome?(input: EngagementCommercialOutcomeWriteModel): Promise<EngagementCommercialOutcome>;
  listCommercialOutcomes?(organisationId: string, platform: CampaignPlatform, providerAccountId: string): Promise<EngagementCommercialOutcome[]>;
  findLatestCommercialOutcomeForDraft?(organisationId: string, draftId: string, platform: CampaignPlatform): Promise<EngagementCommercialOutcome | null>;
}
