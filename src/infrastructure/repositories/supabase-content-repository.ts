import "server-only";
import type { ContentDraftWriteModel, ContentRepository } from "@/core/application/ports/content-port";
import type { ContentDraftStatus, ContentDraftType } from "@/core/domain/entities/content";
import type { DashboardActivityItem } from "@/core/domain/entities/dashboard";
import type { GenesisClient } from "../supabase/server-client";
import {
  toDraft,
  toDraftVersion,
  toGenerationRequest,
  type DraftRowWithRelations,
  type GenerationRequestRowWithRelations,
} from "../mappers/content-mapper";
import { translateError, unwrap } from "./errors";

/** Exported so SupabaseReviewRepository can refetch the full joined draft after its RPC write, without a second, slightly different embed definition drifting out of sync with this one. */
export const DRAFT_SELECT = `
  *,
  membrain_categories(id, key, label),
  campaigns(id, name),
  created_by_profile:profiles!content_drafts_created_by_fkey(id, full_name, email),
  updated_by_profile:profiles!content_drafts_updated_by_fkey(id, full_name, email),
  assigned_reviewer_profile:profiles!content_drafts_assigned_reviewer_id_fkey(id, full_name, email)
`;

const VERSION_SELECT = `
  *,
  changed_by_profile:profiles!content_draft_versions_changed_by_fkey(id, full_name, email)
`;

const GENERATION_REQUEST_SELECT = `
  *,
  membrain_categories(id, key, label),
  requested_by_profile:profiles(id, full_name, email)
`;

const DRAFT_STATUSES: ContentDraftStatus[] = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "archived",
];

const ACTIVITY_VERSION_SELECT = `
  id, draft_id, organisation_id, version, title, created_at,
  organisations(name),
  changed_by_profile:profiles!content_draft_versions_changed_by_fkey(id, full_name, email)
`;

type ActivityVersionRow = {
  id: string;
  draft_id: string;
  organisation_id: string;
  version: number;
  title: string;
  created_at: string;
  organisations: { name: string } | null;
  changed_by_profile: { id: string; full_name: string | null; email: string } | null;
};

export class SupabaseContentRepository implements ContentRepository {
  constructor(private readonly client: GenesisClient) {}

  async listDrafts(input: {
    organisationId: string;
    query?: string;
    status?: ContentDraftStatus;
    contentType?: ContentDraftType;
    categoryId?: string;
    campaignId?: string;
    authorId?: string;
    limit: number;
    offset: number;
  }) {
    let dbQuery = this.client
      .from("content_drafts")
      .select(DRAFT_SELECT)
      .eq("organisation_id", input.organisationId)
      .order("updated_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);

    if (input.status) dbQuery = dbQuery.eq("status", input.status);
    if (input.contentType) dbQuery = dbQuery.eq("content_type", input.contentType);
    if (input.categoryId) dbQuery = dbQuery.eq("category_id", input.categoryId);
    if (input.campaignId) dbQuery = dbQuery.eq("campaign_id", input.campaignId);
    if (input.authorId) dbQuery = dbQuery.eq("created_by", input.authorId);
    if (input.query) dbQuery = dbQuery.ilike("title", `%${input.query}%`);

    const { data, error } = await dbQuery;
    if (error) translateError(error, "Draft list");
    return (data ?? []).map((row) => toDraft(row as unknown as DraftRowWithRelations));
  }

  async countDraftsByStatus(organisationId: string, campaignId?: string): Promise<Record<ContentDraftStatus, number>> {
    const counts = await Promise.all(
      DRAFT_STATUSES.map(async (status) => {
        let query = this.client
          .from("content_drafts")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", organisationId)
          .eq("status", status);

        if (campaignId) query = query.eq("campaign_id", campaignId);

        const { count, error } = await query;
        if (error) translateError(error, "Draft count");
        return [status, count ?? 0] as const;
      }),
    );

    return Object.fromEntries(counts) as Record<ContentDraftStatus, number>;
  }

  async findDraft(organisationId: string, draftId: string) {
    const { data, error } = await this.client
      .from("content_drafts")
      .select(DRAFT_SELECT)
      .eq("organisation_id", organisationId)
      .eq("id", draftId)
      .maybeSingle();

    if (error) translateError(error, "Draft");
    return data ? toDraft(data as unknown as DraftRowWithRelations) : null;
  }

  async createDraft(input: ContentDraftWriteModel & { createdBy: string }) {
    const result = await this.client
      .from("content_drafts")
      .insert({
        organisation_id: input.organisationId,
        title: input.title,
        content_type: input.contentType,
        category_id: input.categoryId,
        campaign_id: input.campaignId,
        summary: input.summary,
        body: input.body,
        created_by: input.createdBy,
        updated_by: input.createdBy,
        due_at: input.dueAt,
        reviewer_ids: input.reviewerIds,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select(DRAFT_SELECT)
      .single();

    return toDraft(unwrap(result, "Draft") as unknown as DraftRowWithRelations);
  }

  async updateDraft(draftId: string, input: ContentDraftWriteModel & { updatedBy: string }) {
    const result = await this.client
      .from("content_drafts")
      .update({
        title: input.title,
        content_type: input.contentType,
        category_id: input.categoryId,
        campaign_id: input.campaignId,
        summary: input.summary,
        body: input.body,
        updated_by: input.updatedBy,
        due_at: input.dueAt,
        reviewer_ids: input.reviewerIds,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", draftId)
      .eq("organisation_id", input.organisationId)
      .select(DRAFT_SELECT)
      .single();

    return toDraft(unwrap(result, "Draft") as unknown as DraftRowWithRelations);
  }

  async scheduleDraft(
    organisationId: string,
    draftId: string,
    input: { scheduledAt: string; platform: string; timezone: string; updatedBy: string }
  ) {
    const result = await this.client
      .from("content_drafts")
      .update({
        status: "scheduled",
        scheduled_at: input.scheduledAt,
        scheduled_platform: input.platform,
        scheduled_timezone: input.timezone,
        updated_by: input.updatedBy,
      })
      .eq("id", draftId)
      .eq("organisation_id", organisationId)
      .select(DRAFT_SELECT)
      .single();

    return toDraft(unwrap(result, "Draft") as unknown as DraftRowWithRelations);
  }

  async updateStatus(
    organisationId: string,
    draftId: string,
    status: ContentDraftStatus,
    updatedBy: string
  ) {
    const result = await this.client
      .from("content_drafts")
      .update({
        status,
        updated_by: updatedBy,
      })
      .eq("id", draftId)
      .eq("organisation_id", organisationId)
      .select(DRAFT_SELECT)
      .single();

    return toDraft(unwrap(result, "Draft") as unknown as DraftRowWithRelations);
  }

  async annotateLatestVersion(draftId: string, changeSummary: string): Promise<void> {
    const { data, error } = await this.client
      .from("content_draft_versions")
      .select("id, version")
      .eq("draft_id", draftId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) translateError(error, "Version history");
    if (!data) return;

    const { error: updateError } = await this.client
      .from("content_draft_versions")
      .update({ change_summary: changeSummary })
      .eq("id", data.id)
      .is("change_summary", null);

    if (updateError) translateError(updateError, "Version annotation");
  }

  async listVersions(organisationId: string, draftId: string) {
    const { data, error } = await this.client
      .from("content_draft_versions")
      .select(VERSION_SELECT)
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("version", { ascending: false });

    if (error) translateError(error, "Version history");
    return (data ?? []).map((row) => toDraftVersion(row as never));
  }

  async createGenerationRequest(input: {
    organisationId: string;
    draftId: string;
    brief: string;
    targetAudience: string | null;
    tone: string | null;
    contentPillarCategoryId: string | null;
    memBrainContextPrompt: string;
    memBrainEntryCount: number;
    memBrainEstimatedTokens: number;
    requestedBy: string;
  }) {
    const result = await this.client
      .from("content_generation_requests")
      .insert({
        organisation_id: input.organisationId,
        draft_id: input.draftId,
        brief: input.brief,
        target_audience: input.targetAudience,
        tone: input.tone,
        content_pillar_category_id: input.contentPillarCategoryId,
        membrain_context_prompt: input.memBrainContextPrompt,
        membrain_context_entry_count: input.memBrainEntryCount,
        membrain_context_estimated_tokens: input.memBrainEstimatedTokens,
        requested_by: input.requestedBy,
      })
      .select(GENERATION_REQUEST_SELECT)
      .single();

    return toGenerationRequest(unwrap(result, "Generation request") as unknown as GenerationRequestRowWithRelations);
  }

  async getLatestGenerationRequest(organisationId: string, draftId: string) {
    const { data, error } = await this.client
      .from("content_generation_requests")
      .select(GENERATION_REQUEST_SELECT)
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) translateError(error, "Generation request");
    return data ? toGenerationRequest(data as unknown as GenerationRequestRowWithRelations) : null;
  }

  async listDraftsForActor(input: {
    organisationId?: string;
    campaignId?: string;
    status?: ContentDraftStatus;
    authorId?: string;
    updatedBy?: string;
    assignedReviewerId?: string;
    unassigned?: boolean;
    submittedFrom?: string;
    submittedTo?: string;
    limit: number;
  }) {
    let query = this.client
      .from("content_drafts")
      .select(DRAFT_SELECT)
      .order("updated_at", { ascending: false })
      .limit(input.limit);

    if (input.organisationId) query = query.eq("organisation_id", input.organisationId);
    if (input.campaignId) query = query.eq("campaign_id", input.campaignId);
    if (input.status) query = query.eq("status", input.status);
    if (input.authorId) query = query.eq("created_by", input.authorId);
    if (input.updatedBy) query = query.eq("updated_by", input.updatedBy);
    if (input.unassigned) query = query.is("assigned_reviewer_id", null);
    else if (input.assignedReviewerId) query = query.eq("assigned_reviewer_id", input.assignedReviewerId);
    if (input.submittedFrom) query = query.gte("updated_at", input.submittedFrom);
    if (input.submittedTo) query = query.lte("updated_at", input.submittedTo);

    const { data, error } = await query;
    if (error) translateError(error, "Draft list");
    return (data ?? []).map((row) => toDraft(row as unknown as DraftRowWithRelations));
  }

  async listRecentActivityForActor(limit: number): Promise<DashboardActivityItem[]> {
    const { data, error } = await this.client
      .from("content_draft_versions")
      .select(ACTIVITY_VERSION_SELECT)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) translateError(error, "Team activity");

    return (data ?? []).map((row): DashboardActivityItem => {
      const version = row as unknown as ActivityVersionRow;
      return {
        id: version.id,
        kind: "content",
        organisationId: version.organisation_id,
        organisationName: version.organisations?.name ?? "Unknown account",
        entityId: version.draft_id,
        entityTitle: version.title,
        action: version.version === 1 ? "created" : "updated",
        actor: version.changed_by_profile
          ? {
              id: version.changed_by_profile.id,
              fullName: version.changed_by_profile.full_name,
              email: version.changed_by_profile.email,
            }
          : null,
        occurredAt: version.created_at,
      };
    });
  }
}
