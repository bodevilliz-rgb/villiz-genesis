import type {
  Campaign,
  CampaignListItem,
  CampaignPlatform,
  CampaignStatus,
} from "@/core/domain/entities/campaign";
import type { DashboardActivityItem } from "@/core/domain/entities/dashboard";

export interface CampaignWriteModel {
  organisationId: string;
  name: string;
  description: string | null;
  objective: string | null;
  targetAudience: string | null;
  primaryCTA: string | null;
  startDate: string | null;
  endDate: string | null;
  status: CampaignStatus;
  platforms: CampaignPlatform[];
  successMetric: string | null;
}

export interface CampaignRepository {
  listCampaigns(input: {
    organisationId: string;
    query?: string;
    status?: CampaignStatus;
    platform?: CampaignPlatform;
    limit: number;
    offset: number;
  }): Promise<CampaignListItem[]>;

  /** One count per status, always all four keys present even when zero. */
  countCampaignsByStatus(organisationId: string): Promise<Record<CampaignStatus, number>>;

  findCampaign(organisationId: string, campaignId: string): Promise<Campaign | null>;

  createCampaign(input: CampaignWriteModel & { createdBy: string }): Promise<Campaign>;
  updateCampaign(campaignId: string, input: CampaignWriteModel & { updatedBy: string }): Promise<Campaign>;
  archiveCampaign(campaignId: string, input: { organisationId: string; updatedBy: string }): Promise<Campaign>;

  /**
   * Cross-organisation, relying on RLS alone rather than an explicit
   * `organisationId` filter — see the identical note on
   * ContentRepository.listDraftsForActor. Powers the Dashboard's Active
   * Campaigns and Awo Insights sections.
   */
  listCampaignsForActor(input: { status?: CampaignStatus; limit: number }): Promise<CampaignListItem[]>;

  /** Campaign updates across every visible organisation, for the Team Activity feed. */
  listRecentActivityForActor(limit: number): Promise<DashboardActivityItem[]>;
}
