import "server-only";
import type { CampaignRepository, CampaignWriteModel } from "@/core/application/ports/campaign-port";
import type { CampaignListItem, CampaignPlatform, CampaignStatus } from "@/core/domain/entities/campaign";
import type { DashboardActivityItem } from "@/core/domain/entities/dashboard";
import type { GenesisClient } from "../supabase/server-client";
import { toCampaign, type CampaignRowWithRelations } from "../mappers/campaign-mapper";
import { translateError, unwrap } from "./errors";

/**
 * `content_drafts(count)` mirrors exactly how SupabaseOrganisationRepository
 * embeds `membrain_entries(count)` on the organisation list — one query, not
 * a second round trip, for the single number the list view needs. The
 * three-way (draft/needs_review/approved) breakdown the campaign *overview*
 * page needs is a different shape and is composed in the use-case layer from
 * ContentRepository directly, not duplicated here.
 */
const CAMPAIGN_SELECT = `
  *,
  created_by_profile:profiles!campaigns_created_by_fkey(id, full_name, email),
  updated_by_profile:profiles!campaigns_updated_by_fkey(id, full_name, email)
`;

const CAMPAIGN_LIST_SELECT = `${CAMPAIGN_SELECT}, content_drafts(count)`;

const CAMPAIGN_STATUSES: CampaignStatus[] = ["planning", "active", "completed", "archived"];

const ACTIVITY_SELECT = `
  id, organisation_id, name, created_at, updated_at,
  organisations(name),
  updated_by_profile:profiles!campaigns_updated_by_fkey(id, full_name, email)
`;

type ActivityCampaignRow = {
  id: string;
  organisation_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  organisations: { name: string } | null;
  updated_by_profile: { id: string; full_name: string | null; email: string } | null;
};

type CampaignListRow = CampaignRowWithRelations & { content_drafts: Array<{ count: number }> };

function toCampaignListItem(row: CampaignListRow): CampaignListItem {
  return { ...toCampaign(row), draftCount: row.content_drafts?.[0]?.count ?? 0 };
}

export class SupabaseCampaignRepository implements CampaignRepository {
  constructor(private readonly client: GenesisClient) {}

  async listCampaigns(input: {
    organisationId: string;
    query?: string;
    status?: CampaignStatus;
    platform?: CampaignPlatform;
    limit: number;
    offset: number;
  }) {
    let query = this.client
      .from("campaigns")
      .select(CAMPAIGN_LIST_SELECT)
      .eq("organisation_id", input.organisationId)
      .order("updated_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);

    if (input.status) query = query.eq("status", input.status);
    if (input.platform) query = query.contains("platforms", [input.platform]);
    if (input.query) {
      const escaped = input.query.replace(/[%,]/g, "");
      query = query.or(`name.ilike.%${escaped}%,objective.ilike.%${escaped}%`);
    }

    const { data, error } = await query;
    if (error) translateError(error, "Campaign list");
    return (data ?? []).map((row) => toCampaignListItem(row as unknown as CampaignListRow));
  }

  async countCampaignsByStatus(organisationId: string): Promise<Record<CampaignStatus, number>> {
    const counts = await Promise.all(
      CAMPAIGN_STATUSES.map(async (status) => {
        const { count, error } = await this.client
          .from("campaigns")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", organisationId)
          .eq("status", status);

        if (error) translateError(error, "Campaign count");
        return [status, count ?? 0] as const;
      }),
    );

    return Object.fromEntries(counts) as Record<CampaignStatus, number>;
  }

  async findCampaign(organisationId: string, campaignId: string) {
    const { data, error } = await this.client
      .from("campaigns")
      .select(CAMPAIGN_SELECT)
      .eq("organisation_id", organisationId)
      .eq("id", campaignId)
      .maybeSingle();

    if (error) translateError(error, "Campaign");
    return data ? toCampaign(data as unknown as CampaignRowWithRelations) : null;
  }

  async createCampaign(input: CampaignWriteModel & { createdBy: string }) {
    const result = await this.client
      .from("campaigns")
      .insert({
        organisation_id: input.organisationId,
        name: input.name,
        description: input.description,
        objective: input.objective,
        target_audience: input.targetAudience,
        primary_cta: input.primaryCTA,
        start_date: input.startDate,
        end_date: input.endDate,
        status: input.status,
        platforms: input.platforms,
        success_metric: input.successMetric,
        created_by: input.createdBy,
        updated_by: input.createdBy,

        // Sprint 2 fields
        client: input.client,
        brand: input.brand,
        campaign_type: input.campaignType,
        owner_id: input.ownerId || null,
        team_members: input.teamMembers,
        color_label: input.colorLabel,
        tags: input.tags,
        priority: input.priority,
        notes: input.notes,
        assets: input.assets,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select(CAMPAIGN_SELECT)
      .single();

    return toCampaign(unwrap(result, "Campaign") as unknown as CampaignRowWithRelations);
  }

  async updateCampaign(campaignId: string, input: CampaignWriteModel & { updatedBy: string }) {
    const result = await this.client
      .from("campaigns")
      .update({
        name: input.name,
        description: input.description,
        objective: input.objective,
        target_audience: input.targetAudience,
        primary_cta: input.primaryCTA,
        start_date: input.startDate,
        end_date: input.endDate,
        status: input.status,
        platforms: input.platforms,
        success_metric: input.successMetric,
        updated_by: input.updatedBy,

        // Sprint 2 fields
        client: input.client,
        brand: input.brand,
        campaign_type: input.campaignType,
        owner_id: input.ownerId || null,
        team_members: input.teamMembers,
        color_label: input.colorLabel,
        tags: input.tags,
        priority: input.priority,
        notes: input.notes,
        assets: input.assets,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", campaignId)
      .eq("organisation_id", input.organisationId)
      .select(CAMPAIGN_SELECT)
      .single();

    return toCampaign(unwrap(result, "Campaign") as unknown as CampaignRowWithRelations);
  }

  async archiveCampaign(campaignId: string, input: { organisationId: string; updatedBy: string }) {
    const result = await this.client
      .from("campaigns")
      .update({ status: "archived", updated_by: input.updatedBy })
      .eq("id", campaignId)
      .eq("organisation_id", input.organisationId)
      .select(CAMPAIGN_SELECT)
      .single();

    return toCampaign(unwrap(result, "Campaign") as unknown as CampaignRowWithRelations);
  }

  async listCampaignsForActor(input: { status?: CampaignStatus; limit: number }) {
    let query = this.client
      .from("campaigns")
      .select(CAMPAIGN_LIST_SELECT)
      .order("updated_at", { ascending: false })
      .limit(input.limit);

    if (input.status) query = query.eq("status", input.status);

    const { data, error } = await query;
    if (error) translateError(error, "Campaign list");
    return (data ?? []).map((row) => toCampaignListItem(row as unknown as CampaignListRow));
  }

  async listRecentActivityForActor(limit: number): Promise<DashboardActivityItem[]> {
    const { data, error } = await this.client
      .from("campaigns")
      .select(ACTIVITY_SELECT)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) translateError(error, "Team activity");

    return (data ?? []).map((row): DashboardActivityItem => {
      const campaign = row as unknown as ActivityCampaignRow;
      return {
        id: campaign.id,
        kind: "campaign",
        organisationId: campaign.organisation_id,
        organisationName: campaign.organisations?.name ?? "Unknown account",
        entityId: campaign.id,
        entityTitle: campaign.name,
        action: campaign.created_at === campaign.updated_at ? "created" : "updated",
        actor: campaign.updated_by_profile
          ? {
              id: campaign.updated_by_profile.id,
              fullName: campaign.updated_by_profile.full_name,
              email: campaign.updated_by_profile.email,
            }
          : null,
        occurredAt: campaign.updated_at,
      };
    });
  }
}
