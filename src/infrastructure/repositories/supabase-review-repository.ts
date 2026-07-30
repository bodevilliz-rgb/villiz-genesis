import "server-only";
import type { ReviewRepository } from "@/core/application/ports/review-port";
import type { ContentDraftStatus } from "@/core/domain/entities/content";
import type { ReviewActionType, ReviewHistoryEntry } from "@/core/domain/entities/review";
import type { GenesisClient } from "../supabase/server-client";
import { toDraft, type DraftRowWithRelations } from "../mappers/content-mapper";
import { DRAFT_SELECT } from "./supabase-content-repository";
import { translateError, unwrap } from "./errors";

const REVIEW_HISTORY_SELECT = `
  *,
  actor_profile:profiles!content_draft_reviews_actor_id_fkey(id, full_name, email),
  assigned_reviewer_profile:profiles!content_draft_reviews_assigned_reviewer_id_fkey(id, full_name, email)
`;

type ProfileRef = { id: string; full_name: string | null; email: string } | null;

type ReviewHistoryRow = {
  id: string;
  draft_id: string;
  organisation_id: string;
  action: ReviewActionType;
  previous_status: ContentDraftStatus;
  new_status: ContentDraftStatus;
  comment: string | null;
  created_at: string;
  actor_profile: ProfileRef;
  assigned_reviewer_profile: ProfileRef;
};

function toProfileRef(ref: ProfileRef) {
  return ref ? { id: ref.id, fullName: ref.full_name, email: ref.email } : null;
}

function toReviewHistoryEntry(row: ReviewHistoryRow): ReviewHistoryEntry {
  return {
    id: row.id,
    draftId: row.draft_id,
    organisationId: row.organisation_id,
    action: row.action,
    actor: toProfileRef(row.actor_profile),
    assignedReviewer: toProfileRef(row.assigned_reviewer_profile),
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export class SupabaseReviewRepository implements ReviewRepository {
  constructor(private readonly client: GenesisClient) {}

  async recordDecision(input: {
    draftId: string;
    action: ReviewActionType;
    newStatus: ContentDraftStatus | null;
    assignedReviewerId: string | null;
    comment: string | null;
  }) {
    const { error: rpcError } = await this.client.rpc("perform_content_draft_review", {
      p_draft_id: input.draftId,
      p_action: input.action,
      p_new_status: input.newStatus,
      p_assigned_reviewer_id: input.assignedReviewerId,
      p_comment: input.comment,
    });

    if (rpcError) translateError(rpcError, "Review decision");

    const result = await this.client.from("content_drafts").select(DRAFT_SELECT).eq("id", input.draftId).single();

    return toDraft(unwrap(result, "Draft") as unknown as DraftRowWithRelations);
  }

  async listHistory(organisationId: string, draftId: string): Promise<ReviewHistoryEntry[]> {
    const { data, error } = await this.client
      .from("content_draft_reviews")
      .select(REVIEW_HISTORY_SELECT)
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false });

    if (error) translateError(error, "Review history");
    return (data ?? []).map((row) => toReviewHistoryEntry(row as unknown as ReviewHistoryRow));
  }

  async listLatestSubmissions(draftIds: string[]): Promise<Map<string, string>> {
    if (draftIds.length === 0) return new Map();

    const { data, error } = await this.client
      .from("content_draft_reviews")
      .select("draft_id, created_at")
      .in("draft_id", draftIds)
      .eq("action", "submitted")
      .order("created_at", { ascending: false });

    if (error) translateError(error, "Review history");

    const latest = new Map<string, string>();
    for (const row of data ?? []) {
      // Sorted newest first, so the first row seen per draft is its most recent submission.
      if (!latest.has(row.draft_id)) latest.set(row.draft_id, row.created_at);
    }
    return latest;
  }
}
