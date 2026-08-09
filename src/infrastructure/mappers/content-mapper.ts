import type {
  ContentDraft,
  ContentDraftVersion,
  ContentGenerationRequest,
} from "@/core/domain/entities/content";
import type {
  ContentDraftRow,
  ContentDraftVersionRow,
  ContentGenerationRequestRow,
  MembrainCategoryRow,
} from "../supabase/database.types";

type ProfileRef = { id: string; full_name: string | null; email: string } | null;
type CategoryRef = Pick<MembrainCategoryRow, "id" | "key" | "label"> | null;
type CampaignRef = { id: string; name: string } | null;

export type DraftRowWithRelations = ContentDraftRow & {
  membrain_categories: CategoryRef;
  campaigns: CampaignRef;
  created_by_profile: ProfileRef;
  updated_by_profile: ProfileRef;
  assigned_reviewer_profile: ProfileRef;
  scheduled_at?: string | null;
  scheduled_platform?: string | null;
  scheduled_timezone?: string | null;
};

export type GenerationRequestRowWithRelations = ContentGenerationRequestRow & {
  membrain_categories: CategoryRef;
  requested_by_profile: ProfileRef;
};

function toProfileRef(ref: ProfileRef) {
  return ref ? { id: ref.id, fullName: ref.full_name, email: ref.email } : null;
}

function toCategoryRef(ref: CategoryRef) {
  return ref ? { id: ref.id, key: ref.key, label: ref.label } : null;
}

function toCampaignRef(ref: CampaignRef) {
  return ref ? { id: ref.id, name: ref.name } : null;
}

export function toDraft(row: DraftRowWithRelations): ContentDraft {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    title: row.title,
    contentType: row.content_type,
    summary: row.summary,
    body: row.body,
    status: row.status,
    awoStatus: row.awo_status,
    version: row.version,
    category: toCategoryRef(row.membrain_categories),
    campaign: toCampaignRef(row.campaigns),
    assignedReviewer: toProfileRef(row.assigned_reviewer_profile),
    lastReviewAction: row.last_review_action,
    lastReviewAt: row.last_review_at,
    scheduledAt: row.scheduled_at ?? null,
    scheduledPlatform: row.scheduled_platform ?? null,
    scheduledTimezone: row.scheduled_timezone ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: toProfileRef(row.created_by_profile),
    updatedBy: toProfileRef(row.updated_by_profile),
    dueAt: (row as unknown as Record<string, unknown>).due_at as string | null ?? null,
    reviewerIds: (row as unknown as Record<string, unknown>).reviewer_ids as string[] ?? [],
    priority: row.priority as "low" | "medium" | "high",
    reviewDeadline: row.review_deadline,
    hashtags: (row as unknown as Record<string, unknown>).hashtags as string[] ?? [],
  };
}

export function toDraftVersion(
  row: ContentDraftVersionRow & { changed_by_profile: ProfileRef },
): ContentDraftVersion {
  return {
    id: row.id,
    draftId: row.draft_id,
    version: row.version,
    title: row.title,
    body: row.body,
    contentType: row.content_type,
    status: row.status,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
    changedBy: toProfileRef(row.changed_by_profile),
    priority: row.priority as "low" | "medium" | "high",
    reviewDeadline: row.review_deadline,
    categoryId: row.category_id,
    campaignId: row.campaign_id,
    hashtags: (row as unknown as Record<string, unknown>).hashtags as string[] ?? [],
  };
}

export function toGenerationRequest(row: GenerationRequestRowWithRelations): ContentGenerationRequest {
  return {
    id: row.id,
    draftId: row.draft_id,
    organisationId: row.organisation_id,
    brief: row.brief,
    targetAudience: row.target_audience,
    tone: row.tone,
    contentPillar: toCategoryRef(row.membrain_categories),
    memBrainContextPrompt: row.membrain_context_prompt,
    memBrainEntryCount: row.membrain_context_entry_count,
    memBrainEstimatedTokens: row.membrain_context_estimated_tokens,
    requestedAt: row.requested_at,
    requestedBy: toProfileRef(row.requested_by_profile),
  };
}
