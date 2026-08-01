import type { ReviewActionType } from "./review";

export type ContentDraftStatus = "draft" | "needs_review" | "in_review" | "changes_requested" | "awaiting_client" | "approved" | "rejected" | "scheduled" | "published" | "archived";

export type ContentDraftType = "social_post" | "caption" | "campaign_copy" | "email" | "blog_article" | "image_prompt" | "ad_copy" | "video_script" | "other";

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
  needs_review: "In review",
  in_review: "In review",
  changes_requested: "Changes requested",
  awaiting_client: "Awaiting Client Sign-off",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

/**
 * Approved, scheduled, published, and archived are decided states — Content Studio blocks
 * further edits until an authorised Lead reopens the review, so the same edit no longer
 * silently drifts a draft away from the decision that was just recorded
 * about it. Draft, Needs Review, and Changes Requested remain editable.
 */
export function isContentDraftLocked(status: ContentDraftStatus): boolean {
  return status === "approved" || status === "scheduled" || status === "published" || status === "archived" || status === "rejected" || status === "awaiting_client";
}

export const CONTENT_DRAFT_TYPE_LABELS: Record<ContentDraftType, string> = {
  social_post: "Social media post",
  caption: "Caption",
  campaign_copy: "Campaign copy",
  email: "Email copy",
  blog_article: "Blog or article draft",
  image_prompt: "Image-generation prompt",
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
  scheduledAt: string | null;
  scheduledPlatform: string | null;
  scheduledTimezone: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string | null; email: string } | null;
  updatedBy: { id: string; fullName: string | null; email: string } | null;

  // Sprint 2 features
  dueAt: string | null;
  reviewerIds: string[]; // Support multiple reviewers
  comments?: CommentThread[];
  
  // Sprint 3 features
  assets?: { assetId: string; attachedBy: string | null; createdAt: string; asset?: import('./media').MediaAsset }[];

  // Sprint 4 features
  priority: "low" | "medium" | "high";
  reviewDeadline: string | null;
}

export interface CommentThread {
  id: string;
  draftId: string;
  organisationId: string;
  author: { id: string; fullName: string | null; email: string } | null;
  parentId: string | null;
  body: string;
  isResolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies?: CommentThread[];
}

export interface ContentCreatedEvent {
  eventId: string;
  occurredAt: string;
  draftId: string;
  organisationId: string;
  title: string;
  actorId: string;
}

export interface ContentScheduledEvent {
  eventId: string;
  occurredAt: string;
  draftId: string;
  organisationId: string;
  scheduledAt: string;
  platform: string;
  actorId: string;
}

export interface ContentPublishedEvent {
  eventId: string;
  occurredAt: string;
  draftId: string;
  organisationId: string;
  actorId: string;
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
  priority: "low" | "medium" | "high";
  reviewDeadline: string | null;
  categoryId: string | null;
  campaignId: string | null;
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
