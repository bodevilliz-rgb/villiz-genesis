"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import {
  approveDraft,
  assignReviewer,
  rejectDraft,
  reopenReview,
  requestDraftChanges,
  submitForReview,
} from "@/core/application/use-cases/review";
import { errorState, successState, text, textOrEmpty, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

function reviewDeps(context: Awaited<ReturnType<typeof requireContext>>) {
  return {
    actor: context.actor,
    content: context.content,
    reviews: context.reviews,
    organisations: context.organisations,
  };
}

function revalidateReview(organisationId: string, draftId: string) {
  revalidatePath(routes.organisations.content.draft(organisationId, draftId));
  revalidatePath(routes.organisations.content.index(organisationId));
  revalidatePath(routes.dashboard);
  revalidatePath(routes.review);
}

export async function submitForReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const draft = await submitForReview(reviewDeps(context), {
      organisationId: text(formData, "organisationId"),
      draftId: text(formData, "draftId"),
    });

    revalidateReview(draft.organisationId, draft.id);
    return successState("Submitted for review.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function assignReviewerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const draft = await assignReviewer(reviewDeps(context), {
      organisationId: text(formData, "organisationId"),
      draftId: text(formData, "draftId"),
      reviewerId: text(formData, "reviewerId"),
    });

    revalidateReview(draft.organisationId, draft.id);
    return successState("Reviewer assigned.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

/**
 * One dispatch point for all three decisions rather than three near-identical
 * server actions — the `decision` field selects which review use-case runs,
 * but each use-case remains fully separate and independently testable; this
 * is thin plumbing, not shared business logic.
 */
export async function recordReviewDecisionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const deps = reviewDeps(context);
    const input = {
      organisationId: text(formData, "organisationId"),
      draftId: text(formData, "draftId"),
      comment: textOrEmpty(formData, "comment"),
    };

    const decision = text(formData, "decision");
    const draft =
      decision === "approve"
        ? await approveDraft(deps, input)
        : decision === "reject"
          ? await rejectDraft(deps, input)
          : await requestDraftChanges(deps, input);

    revalidateReview(draft.organisationId, draft.id);
    return successState(
      decision === "approve" ? "Approved." : decision === "reject" ? "Rejected." : "Sent back for changes.",
      draft.id,
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function reopenReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const draft = await reopenReview(reviewDeps(context), {
      organisationId: text(formData, "organisationId"),
      draftId: text(formData, "draftId"),
      comment: textOrEmpty(formData, "comment"),
    });

    revalidateReview(draft.organisationId, draft.id);
    return successState("Reopened.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}
