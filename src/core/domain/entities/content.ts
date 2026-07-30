import type { ReviewActionType } from "./review";

export type ContentDraftStatus = "draft" | "needs_review" | "approved" | "rejected";

export type ContentDraftType = "social_post" | "email" | "blog_article" | "ad_copy" | "video_script" | "other";

/**
 * Whether Content Studio has handed a structured generation request to Awo
 * for this draft. Orthogonal to `status` — a draft can be "Draft" and
 * "Ready for Awo" at the same time, since preparing work and reviewing it
 * are different concerns. Awo performing the generation, and any change this
 * flag undergoes as a result, is out of scope for this sprint.
 */
export type ContentDraftAwoStatus = "not_requested" | "ready_for_awo";

export const CONTENT_DRAFT_STATUS_LABELS: Record<ContentDraftStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * Approved and rejected are both "decided" states — Content Studio blocks
 * further edits until an authorised Lead reopens the review (see
 * reopenReview in the review use-cases), so the same edit no longer
 * silently drifts a draft away from the decision that was just recorded
 * about it. Draft and Needs Review remain editable exactly as before this
 * workflow existed.
 */
export function isContentDraftLocked(status: ContentDraftStatus): boolean {
  return status === "approved" || status === "rejected";
}

export const CONTENT_DRAFT_TYPE_LABELS: Record<ContentDraftType, string> = {
  social_post: "Social post",
  email: "Email",
  blog_article: "Blog article",
  ad_copy: "Ad copy",
  video_script: "Video script",
  other: "Other",
};

export const CONTENT_DRAFT_AWO_STATUS_LABELS: Record<ContentDraftAwoStatus, string> = {
  not_requested: "Not requested",
  ready_for_awo: "Ready for Awo",
};

export interface ContentDraft {
  id: string;
  organisationId: string;
  title: string;
  contentType: ContentDraftType;
  summary: string | null;
  body: string;
  status: ContentDraftStatus;
  awoStatus: ContentDraftAwoStatus;
  version: number;
  category: { id: string; key: string; label: string } | null;
  /** Optional — a draft may exist with no campaign, exactly as before campaigns existed. */
  campaign: { id: string; name: string } | null;
  /** Who is currently responsible for reviewing this draft — orthogonal to status, exactly like awoStatus. */
  assignedReviewer: { id: string; fullName: string | null; email: string } | null;
  /** The most recent review action, if any — a read-optimisation over content_draft_reviews (see review.ts). */
  lastReviewAction: ReviewActionType | null;
  lastReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string | null; email: string } | null;
  updatedBy: { id: string; fullName: string | null; email: string } | null;
}

export interface ContentDraftVersion {
  id: string;
  draftId: string;
  version: number;
  title: string;
  body: string;
  contentType: ContentDraftType;
  status: ContentDraftStatus;
  changeSummary: string | null;
  createdAt: string;
  changedBy: { id: string; fullName: string | null; email: string } | null;
}

export interface ContentGenerationRequest {
  id: string;
  draftId: string;
  organisationId: string;
  brief: string;
  targetAudience: string | null;
  tone: string | null;
  contentPillar: { id: string; key: string; label: string } | null;
  memBrainContextPrompt: string;
  memBrainEntryCount: number;
  memBrainEstimatedTokens: number;
  requestedAt: string;
  requestedBy: { id: string; fullName: string | null; email: string } | null;
}

export interface ContentOverview {
  totalDrafts: number;
  byStatus: Record<ContentDraftStatus, number>;
  recentDrafts: ContentDraft[];
}
