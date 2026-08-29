import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import { canApproveContent, canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import { CONTENT_DRAFT_STATUS_LABELS, type ContentDraft, type ContentDraftStatus } from "@/core/domain/entities/content";
import {
  canApproveOwnAuthorship,
  eligibleActiveApprovers,
  findReviewTransition,
  SOLO_OPERATOR_APPROVAL_MARKER,
  type ReviewActionType,
  type ReviewHistoryEntry,
  type ReviewQueueFilters,
  type ReviewQueueItem,
  type ReviewQueueTab,
} from "@/core/domain/entities/review";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { ReviewRepository } from "@/core/application/ports/review-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import {
  approveDraftSchema,
  assignReviewerSchema,
  rejectDraftSchema,
  reopenReviewSchema,
  requestDraftChangesSchema,
  submitForReviewSchema,
} from "@/core/application/dto/review-dto";

interface ReviewDeps {
  actor: Actor;
  content: ContentRepository;
  reviews: ReviewRepository;
  organisations: OrganisationRepository;
}

export interface EligibleReviewer {
  id: string;
  fullName: string | null;
  email: string;
  role: OrganisationRole;
}

const blank = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Organisation-scoped Solo Operator Approval policy. The authenticated actor
 * must be this account's Lead and its only active Lead/Reviewer. Re-evaluating
 * membership for every approval makes the exception disappear automatically
 * when a second eligible operator becomes active.
 */
export async function canUseSoloOperatorApproval(
  deps: { actor: Actor; organisations: OrganisationRepository },
  organisationId: string,
): Promise<boolean> {
  const role = await deps.organisations.viewerRole(organisationId);
  if (role !== "lead") return false;
  const eligible = eligibleActiveApprovers(await deps.organisations.listMembers(organisationId));
  return eligible.length === 1 && eligible[0]?.profileId === deps.actor.id && eligible[0].role === "lead";
}

async function requireRole(
  deps: ReviewDeps,
  organisationId: string,
  check: (actor: Actor, role: OrganisationRole | null) => boolean,
): Promise<void> {
  if (deps.actor.isPlatformAdmin) return;
  const role = await deps.organisations.viewerRole(organisationId);
  if (!check(deps.actor, role)) {
    throw new ForbiddenError("You do not have permission to do that in the review workflow.");
  }
}

/**
 * The one engine every review action runs through. `resolveTarget` decides
 * the destination status from the draft's current one (a fixed target for
 * five of the six actions, a two-way branch for reopenReview); everything
 * else — which permission level applies, whether a comment is mandatory,
 * self-approval prevention — is read straight off REVIEW_TRANSITIONS and
 * this function's own opts, so the matrix in review.ts is the only place a
 * valid move is decided, never duplicated per action.
 */
async function applyTransition(
  deps: ReviewDeps,
  input: { organisationId: string; draftId: string; comment?: string },
  resolveTarget: (status: ContentDraftStatus) => ContentDraftStatus | null,
  opts: { checkSelfApproval?: boolean } = {},
): Promise<ContentDraft> {
  const draft = await deps.content.findDraft(input.organisationId, input.draftId);
  if (!draft) throw new NotFoundError("Draft");

  const to = resolveTarget(draft.status);
  if (!to) {
    throw new ValidationError(`A draft in "${CONTENT_DRAFT_STATUS_LABELS[draft.status]}" cannot be moved this way.`);
  }

  const transition = findReviewTransition(draft.status, to);
  if (!transition) {
    throw new ValidationError(
      `A draft cannot move from "${CONTENT_DRAFT_STATUS_LABELS[draft.status]}" to "${CONTENT_DRAFT_STATUS_LABELS[to]}" this way.`,
    );
  }

  const check = transition.requiresLead
    ? canEditOrganisation
    : transition.action === "submitted"
      ? canWriteContent
      : canApproveContent;
  await requireRole(deps, input.organisationId, check);

  let soloOperatorApproval = false;
  if (opts.checkSelfApproval && !canApproveOwnAuthorship(deps.actor.id, draft.createdBy?.id ?? null)) {
    soloOperatorApproval = await canUseSoloOperatorApproval(deps, input.organisationId);
    if (!soloOperatorApproval) {
      throw new ForbiddenError("You cannot approve your own draft. Ask another Lead or Reviewer to make this decision.");
    }
  }

  if (transition.commentRequired && !blank(input.comment)) {
    throw new ValidationError("A comment is required for this decision.", { comment: ["Explain your decision."] });
  }

  return deps.reviews.recordDecision({
    draftId: draft.id,
    action: transition.action,
    newStatus: to,
    assignedReviewerId: soloOperatorApproval ? deps.actor.id : draft.assignedReviewer?.id ?? null,
    comment: soloOperatorApproval
      ? [SOLO_OPERATOR_APPROVAL_MARKER, blank(input.comment)].filter(Boolean).join("\n\n")
      : blank(input.comment),
  });
}

export async function submitForReview(deps: ReviewDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = submitForReviewSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That request could not be understood.");
  return applyTransition(deps, parsed.data, (status) =>
    status === "changes_requested" ? "in_review" : "needs_review",
  );
}

export async function approveDraft(deps: ReviewDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = approveDraftSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the decision below.", parsed.error.flatten().fieldErrors);
  return applyTransition(deps, parsed.data, () => "approved", { checkSelfApproval: true });
}

export async function requestDraftChanges(deps: ReviewDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = requestDraftChangesSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the decision below.", parsed.error.flatten().fieldErrors);
  return applyTransition(deps, parsed.data, (status) =>
    status === "in_review" ? "changes_requested" : "draft",
  );
}

export async function rejectDraft(deps: ReviewDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = rejectDraftSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the decision below.", parsed.error.flatten().fieldErrors);
  return applyTransition(deps, parsed.data, (status) =>
    status === "in_review" ? "archived" : "rejected",
  );
}

/**
 * Lead-only for both source states, a deliberate tightening beyond Sprint
 * 3's Reviewer-level "approved -> needs_review" — see review.ts's own note
 * on REVIEW_TRANSITIONS for why.
 */
export async function reopenReview(deps: ReviewDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = reopenReviewSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That request could not be understood.");
  return applyTransition(deps, parsed.data, (status) =>
    status === "approved" || status === "failed"
      ? "needs_review"
      : (status === "archived" || status === "rejected") ? "draft" : null,
  );
}

/**
 * Lead-only, matching every other governance-shaping action in this
 * codebase (campaign archive, MemBrain entry archive). Reassignment is
 * recorded distinctly from a first assignment (`reassigned` vs `assigned`)
 * so the review timeline reads honestly.
 */
export async function assignReviewer(deps: ReviewDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = assignReviewerSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That assignment could not be understood.");

  const { organisationId, draftId, reviewerId } = parsed.data;
  await requireRole(deps, organisationId, canEditOrganisation);

  const draft = await deps.content.findDraft(organisationId, draftId);
  if (!draft) throw new NotFoundError("Draft");

  const members = await deps.organisations.listMembers(organisationId);
  const candidate = members.find((member) => member.profileId === reviewerId);
  if (!candidate || (candidate.role !== "lead" && candidate.role !== "reviewer")) {
    throw new ValidationError("Only a Lead or Reviewer on this account can be assigned to review a draft.", {
      reviewerId: ["Not eligible to review"],
    });
  }

  const action: ReviewActionType = draft.assignedReviewer ? "reassigned" : "assigned";

  return deps.reviews.recordDecision({
    draftId,
    action,
    newStatus: null,
    assignedReviewerId: reviewerId,
    comment: null,
  });
}

export async function getReviewHistory(
  deps: ReviewDeps,
  organisationId: string,
  draftId: string,
): Promise<ReviewHistoryEntry[]> {
  return deps.reviews.listHistory(organisationId, draftId);
}

/** Every Lead or Reviewer on the account — who assignReviewer will accept as a target. */
export async function listEligibleReviewers(deps: ReviewDeps, organisationId: string): Promise<EligibleReviewer[]> {
  const members = await deps.organisations.listMembers(organisationId);
  return members
    .filter((member) => member.role === "lead" || member.role === "reviewer")
    .map((member) => ({
      id: member.profileId,
      fullName: member.profile.fullName,
      email: member.profile.email,
      role: member.role,
    }));
}

const REVIEW_QUEUE_FETCH_LIMIT = 300;

/** "All pending" is a portfolio-wide governance view — only offered to Leads and platform admins. */
export function isReviewQueueTabAvailable(
  tab: ReviewQueueTab,
  actor: Actor,
  viewerRoles: Map<string, OrganisationRole | null>,
): boolean {
  if (tab !== "all_pending") return true;
  if (actor.isPlatformAdmin) return true;
  return [...viewerRoles.values()].some((role) => role === "lead");
}

/**
 * Backs every /review tab. Each tab pins its own status (and, for
 * "returned_for_changes", its `lastReviewAction` condition) — see
 * ReviewQueueTab's own note in review.ts. The three assignment-oriented tabs
 * (awaiting assignment / assigned to me / all pending) are further narrowed
 * to organisations where the actor can actually approve content — "unassigned
 * queue items must remain visible to eligible reviewers" is a visibility
 * rule for reviewers, not a general broadcast to every org member.
 * "Returned for changes" and "recently approved" stay open to any org
 * member, matching "Contributor: view review feedback".
 */
export async function listReviewQueue(
  deps: ReviewDeps,
  tab: ReviewQueueTab,
  filters: ReviewQueueFilters,
): Promise<ReviewQueueItem[]> {
  const organisations = await deps.organisations.listForActor();
  const organisationNames = new Map(organisations.map((o) => [o.id, o.name]));
  const viewerRoles = new Map(organisations.map((o) => [o.id, o.viewerRole]));

  const baseFilters = {
    organisationId: filters.organisationId,
    campaignId: filters.campaignId,
    authorId: filters.authorId,
    submittedFrom: filters.submittedFrom,
    submittedTo: filters.submittedTo,
    limit: REVIEW_QUEUE_FETCH_LIMIT,
  };

  let drafts: ContentDraft[];
  switch (tab) {
    case "awaiting_assignment":
      drafts = await deps.content.listDraftsForActor({ ...baseFilters, status: "in_review", unassigned: true });
      break;
    case "assigned_to_me":
      drafts = await deps.content.listDraftsForActor({
        ...baseFilters,
        status: "in_review",
        assignedReviewerId: deps.actor.id,
      });
      break;
    case "all_pending":
      drafts = await deps.content.listDraftsForActor({
        ...baseFilters,
        status: "in_review",
        assignedReviewerId: filters.assignedReviewerId,
      });
      break;
    case "returned_for_changes":
      drafts = await deps.content.listDraftsForActor({ ...baseFilters, status: "changes_requested" });
      break;
    case "recently_approved":
      drafts = await deps.content.listDraftsForActor({ ...baseFilters, status: "approved" });
      break;
  }

  const restrictToApprovers = tab === "awaiting_assignment" || tab === "assigned_to_me" || tab === "all_pending";
  const visible = restrictToApprovers
    ? drafts.filter((draft) => canApproveContent(deps.actor, viewerRoles.get(draft.organisationId) ?? null))
    : drafts;

  return visible.map((draft) => ({
    draftId: draft.id,
    organisationId: draft.organisationId,
    organisationName: organisationNames.get(draft.organisationId) ?? "Unknown account",
    campaignName: draft.campaign?.name ?? null,
    title: draft.title,
    contentType: draft.contentType,
    status: draft.status,
    assignedReviewer: draft.assignedReviewer,
    updatedAt: draft.updatedAt,
    updatedBy: draft.updatedBy,
  }));
}
