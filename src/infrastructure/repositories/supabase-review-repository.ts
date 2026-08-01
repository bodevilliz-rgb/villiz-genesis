import "server-only";
import type { ReviewRepository } from "@/core/application/ports/review-port";
import type { CommentThread, ContentDraftStatus } from "@/core/domain/entities/content";
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

  async listComments(organisationId: string, draftId: string): Promise<CommentThread[]> {
    const result = await this.client
      .from("content_draft_comments")
      .select(`
        *,
        author_profile:profiles!content_draft_comments_author_id_fkey(id, full_name, email)
      `)
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("created_at", { ascending: true });

    if (result.error) translateError(result.error, "List comments");

    type ProfileEmbedRef = { id: string; full_name: string | null; email: string } | null;
    type CommentRowWithAuthor = {
      id: string;
      draft_id: string;
      organisation_id: string;
      parent_id: string | null;
      body: string;
      is_resolved: boolean;
      resolved_by: string | null;
      resolved_at: string | null;
      created_at: string;
      updated_at: string;
      author_profile: ProfileEmbedRef;
    };

    const mapped: CommentThread[] = (result.data || []).map((row) => {
      const r = row as unknown as CommentRowWithAuthor;
      return {
        id: r.id,
        draftId: r.draft_id,
        organisationId: r.organisation_id,
        author: r.author_profile ? { id: r.author_profile.id, fullName: r.author_profile.full_name, email: r.author_profile.email } : null,
        parentId: r.parent_id,
        body: r.body,
        isResolved: r.is_resolved,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        replies: [],
      };
    });

    const map = new Map<string, CommentThread>(mapped.map(c => [c.id, c]));
    const roots: CommentThread[] = [];

    for (const comment of mapped) {
      if (comment.parentId) {
        const parent = map.get(comment.parentId);
        if (parent) {
          parent.replies = parent.replies || [];
          parent.replies.push(comment);
        } else {
          roots.push(comment);
        }
      } else {
        roots.push(comment);
      }
    }

    return roots;
  }

  async createComment(
    organisationId: string,
    draftId: string,
    authorId: string,
    parentId: string | null,
    body: string
  ): Promise<CommentThread> {
    const result = await this.client
      .from("content_draft_comments")
      .insert({
        organisation_id: organisationId,
        draft_id: draftId,
        author_id: authorId,
        parent_id: parentId,
        body,
        is_resolved: false,
      })
      .select(`
        *,
        author_profile:profiles!content_draft_comments_author_id_fkey(id, full_name, email)
      `)
      .single();

    if (result.error) translateError(result.error, "Create comment");
    type ProfileEmbedRef = { id: string; full_name: string | null; email: string } | null;
    type CommentRowWithAuthor = {
      id: string;
      draft_id: string;
      organisation_id: string;
      parent_id: string | null;
      body: string;
      is_resolved: boolean;
      resolved_by: string | null;
      resolved_at: string | null;
      created_at: string;
      updated_at: string;
      author_profile: ProfileEmbedRef;
    };
    const row = result.data as unknown as CommentRowWithAuthor;
    return {
      id: row.id,
      draftId: row.draft_id,
      organisationId: row.organisation_id,
      author: row.author_profile ? { id: row.author_profile.id, fullName: row.author_profile.full_name, email: row.author_profile.email } : null,
      parentId: row.parent_id,
      body: row.body,
      isResolved: row.is_resolved,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      replies: [],
    };
  }

  async updateComment(
    organisationId: string,
    commentId: string,
    authorId: string,
    body: string
  ): Promise<CommentThread> {
    const result = await this.client
      .from("content_draft_comments")
      .update({ body, updated_at: new Date().toISOString() })
      .eq("id", commentId)
      .eq("organisation_id", organisationId)
      .eq("author_id", authorId)
      .select(`
        *,
        author_profile:profiles!content_draft_comments_author_id_fkey(id, full_name, email)
      `)
      .single();

    if (result.error) translateError(result.error, "Update comment");
    type ProfileEmbedRef = { id: string; full_name: string | null; email: string } | null;
    type CommentRowWithAuthor = {
      id: string;
      draft_id: string;
      organisation_id: string;
      parent_id: string | null;
      body: string;
      is_resolved: boolean;
      resolved_by: string | null;
      resolved_at: string | null;
      created_at: string;
      updated_at: string;
      author_profile: ProfileEmbedRef;
    };
    const row = result.data as unknown as CommentRowWithAuthor;
    return {
      id: row.id,
      draftId: row.draft_id,
      organisationId: row.organisation_id,
      author: row.author_profile ? { id: row.author_profile.id, fullName: row.author_profile.full_name, email: row.author_profile.email } : null,
      parentId: row.parent_id,
      body: row.body,
      isResolved: row.is_resolved,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      replies: [],
    };
  }

  async resolveComment(organisationId: string, commentId: string, resolvedBy: string): Promise<void> {
    const result = await this.client
      .from("content_draft_comments")
      .update({
        is_resolved: true,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", commentId)
      .eq("organisation_id", organisationId);

    if (result.error) translateError(result.error, "Resolve comment");
  }

  async reopenComment(organisationId: string, commentId: string): Promise<void> {
    const result = await this.client
      .from("content_draft_comments")
      .update({
        is_resolved: false,
        resolved_by: null,
        resolved_at: null,
      })
      .eq("id", commentId)
      .eq("organisation_id", organisationId);

    if (result.error) translateError(result.error, "Reopen comment");
  }
}
