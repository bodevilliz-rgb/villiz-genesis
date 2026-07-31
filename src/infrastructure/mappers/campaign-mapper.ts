import type { Campaign, CampaignPlatform } from "@/core/domain/entities/campaign";
import type { CampaignRow } from "../supabase/database.types";

type ProfileRef = { id: string; full_name: string | null; email: string } | null;

export type CampaignRowWithRelations = CampaignRow & {
  created_by_profile: ProfileRef;
  updated_by_profile: ProfileRef;
};

function toProfileRef(ref: ProfileRef) {
  return ref ? { id: ref.id, fullName: ref.full_name, email: ref.email } : null;
}

export function toCampaign(row: CampaignRowWithRelations): Campaign {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    description: row.description,
    objective: row.objective,
    targetAudience: row.target_audience,
    primaryCTA: row.primary_cta,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    platforms: row.platforms as CampaignPlatform[],
    successMetric: row.success_metric,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: toProfileRef(row.created_by_profile),
    updatedBy: toProfileRef(row.updated_by_profile),

    // Sprint 2 campaign fields
    client: (row as unknown as Record<string, unknown>).client as string | null ?? null,
    brand: (row as unknown as Record<string, unknown>).brand as string | null ?? null,
    campaignType: (row as unknown as Record<string, unknown>).campaign_type as string | null ?? null,
    ownerId: (row as unknown as Record<string, unknown>).owner_id as string | null ?? null,
    teamMembers: (row as unknown as Record<string, unknown>).team_members as string[] ?? [],
    colorLabel: (row as unknown as Record<string, unknown>).color_label as string | null ?? null,
    tags: (row as unknown as Record<string, unknown>).tags as string[] ?? [],
    priority: (row as unknown as Record<string, unknown>).priority as string | null ?? null,
    notes: (row as unknown as Record<string, unknown>).notes as string | null ?? null,
    legacyAssets: (row as unknown as Record<string, unknown>).assets as { name: string; url: string; mimeType?: string; sizeBytes?: number }[] ?? [],
    assets: [],
  };
}
