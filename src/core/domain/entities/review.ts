import type { ContentDraftStatus, ContentDraftType } from "./content";

/**
 * Every kind of event the review workflow can record. Distinct from
 * ContentDraftStatus: an action is something that *happened* (an assignment
 * changes nothing about status), a status is a state a draft is *in*.
 */
export type ReviewActionType =
  | "submitted"
  | "assigned"
  | "reassigned"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "reopened";

export const REVIEW_ACTION_LABELS: Record<ReviewActionType, string> = {
  submitted: "Submitted for review",
  assigned: "Assigned a reviewer",
  reassigned: "Reassigned",
  approved: "Approved",
  changes_requested: "Requested changes",
  rejected: "Rejected",
  reopened: "Reopened",
};

/** One immutable row from content_draft_reviews — the chronological review timeline. */
export interface ReviewHistoryEntry {
  id: string;
  draftId: string;
  organisationId: string;
  action: ReviewActionType;
  actor: { id: string; fullName: string | null; email: string } | null;
  assignedReviewer: { id: string; fullName: string | null; email: string } | null;
  previousStatus: ContentDraftStatus;
  newStatus: ContentDraftStatus;
  comment: string | null;
  createdAt: string;
}

export type ReviewDecision = "approve" | "request_changes" | "reject";

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
};

/**
 * The full workflow transition matrix — the one and only place a valid move
 * is decided. Mirrors the shape of the retired
 * CONTENT_DRAFT_STATUS_TRANSITIONS (Sprint 3), now owned by the review
 * domain since every one of these transitions is now a reviewed, audited
 * decision rather than a free-form status change. `action` is what gets
 * recorded on content_draft_reviews for this move.
 */
export interface ReviewTransition {
  from: ContentDraftStatus;
  to: ContentDraftStatus;
  action: ReviewActionType;
  /** Lead only (canEditOrganisation) vs. any eligible reviewer (canApproveContent). */
  requiresLead: boolean;
  commentRequired: boolean;
}

export const REVIEW_TRANSITIONS: ReviewTransition[] = [
  { from: "draft", to: "needs_review", action: "submitted", requiresLead: false, commentRequired: false },
  { from: "needs_review", to: "approved", action: "approved", requiresLead: false, commentRequired: false },
  { from: "needs_review", to: "draft", action: "changes_requested", requiresLead: false, commentRequired: true },
  { from: "needs_review", to: "rejected", action: "rejected", requiresLead: false, commentRequired: true },
  // Reopening is deliberately Lead-only for both source states — see the
  // reopenReview use-case and its report note on tightening this beyond
  // Sprint 3's Reviewer-level "approved -> needs_review" behaviour.
  { from: "approved", to: "needs_review", action: "reopened", requiresLead: true, commentRequired: false },
  { from: "rejected", to: "draft", action: "reopened", requiresLead: true, commentRequired: false },
];

export function findReviewTransition(from: ContentDraftStatus, to: ContentDraftStatus): ReviewTransition | null {
  return REVIEW_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/**
 * Self-approval prevention — the one canonical rule, defined once and
 * enforced by every use-case that can approve a draft. Scoped narrowly to
 * approval itself: rubber-stamping your own work is the actual conflict of
 * interest; a Lead requesting changes or rejecting their own draft is not
 * (it is simply an author admitting the work is not ready) and is left
 * unrestricted. No role, including platform admin, is exempted — the
 * mission's own instruction was that an override requires an *existing*
 * explicit permission, and no such override exists anywhere in this
 * codebase's governance model.
 */
export function canApproveOwnAuthorship(actorId: string, draftAuthorId: string | null): boolean {
  return draftAuthorId !== actorId;
}

/**
 * The five Review Queue views. Each pins its own status (and, for
 * "returned_for_changes", its own extra `lastReviewAction` condition) rather
 * than being a free status filter — see listReviewQueue's own note on why a
 * separate status dropdown alongside these would just be a confusing second
 * way to ask the same question.
 */
export type ReviewQueueTab =
  | "awaiting_assignment"
  | "assigned_to_me"
  | "all_pending"
  | "returned_for_changes"
  | "recently_approved";

export const REVIEW_QUEUE_TAB_LABELS: Record<ReviewQueueTab, string> = {
  awaiting_assignment: "Awaiting assignment",
  assigned_to_me: "Assigned to me",
  all_pending: "All pending",
  returned_for_changes: "Returned for changes",
  recently_approved: "Recently approved",
};

export interface ReviewQueueFilters {
  organisationId?: string;
  campaignId?: string;
  authorId?: string;
  assignedReviewerId?: string;
  submittedFrom?: string;
  submittedTo?: string;
}

export interface ReviewQueueItem {
  draftId: string;
  organisationId: string;
  organisationName: string;
  campaignName: string | null;
  title: string;
  contentType: ContentDraftType;
  status: ContentDraftStatus;
  assignedReviewer: { id: string; fullName: string | null; email: string } | null;
  updatedAt: string;
  updatedBy: { id: string; fullName: string | null; email: string } | null;
}
