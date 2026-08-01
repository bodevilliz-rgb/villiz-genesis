import type { CommentThread, ContentDraft, ContentDraftStatus } from "@/core/domain/entities/content";
import type { ReviewActionType, ReviewHistoryEntry } from "@/core/domain/entities/review";

export interface ReviewRepository {
  /**
   * The single write path for every review action (submit, assign, approve,
   * request changes, reject, reopen) — calls the atomic
   * perform_content_draft_review RPC (status + assignment + audit row in one
   * transaction) then returns the refreshed draft. Carries no business rules
   * of its own; see the migration's decision note and every use-case in
   * core/application/use-cases/review for where those actually live.
   */
  recordDecision(input: {
    draftId: string;
    action: ReviewActionType;
    newStatus: ContentDraftStatus | null;
    assignedReviewerId: string | null;
    comment: string | null;
  }): Promise<ContentDraft>;

  /** The full, chronological review timeline for one draft — content_draft_reviews, newest first. */
  listHistory(organisationId: string, draftId: string): Promise<ReviewHistoryEntry[]>;

  /**
   * The most recent "submitted" event per draft id, for a bounded set of
   * drafts — one bulk query (`draft_id IN (...)`), not one per draft. Used
   * only to compute the Dashboard's average review turnaround stat, which
   * needs "time since last submission", not "time since the draft was
   * first created" (a draft can sit unsubmitted for a long time before ever
   * entering review).
   */
  listLatestSubmissions(draftIds: string[]): Promise<Map<string, string>>;

  // Threaded Comments operations
  listComments(organisationId: string, draftId: string): Promise<CommentThread[]>;
  createComment(
    organisationId: string,
    draftId: string,
    authorId: string,
    parentId: string | null,
    body: string
  ): Promise<CommentThread>;
  updateComment(
    organisationId: string,
    commentId: string,
    authorId: string,
    body: string
  ): Promise<CommentThread>;
  resolveComment(organisationId: string, commentId: string, resolvedBy: string): Promise<void>;
  reopenComment(organisationId: string, commentId: string): Promise<void>;
}
