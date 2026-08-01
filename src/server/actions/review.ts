"use server";
import { revalidatePath } from "next/cache";
import { requireContext, RequestContext } from "../container";
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

function reviewDeps(context: RequestContext) {
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

// Internal Audit Event Helper
async function recordAudit(
  context: RequestContext,
  organisationId: string,
  draftId: string | null,
  eventType: string,
  description: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    await context.audits.recordEvent({
      organisationId,
      draftId,
      actorId: context.actor.id,
      eventType,
      description,
      metadata,
    });
  } catch (err) {
    console.error("Failed to record audit event:", err);
  }
}

// Internal Notification Helper
async function notifyUser(
  context: RequestContext,
  organisationId: string,
  profileId: string,
  type: string,
  message: string
) {
  try {
    await context.notifications.createNotification({
      organisationId,
      profileId,
      type,
      message,
    });
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}

// 1. Submit for Review
export async function submitForReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";

    const draft = await submitForReview(reviewDeps(context), { organisationId, draftId });

    // Audit Log
    await recordAudit(context, organisationId, draftId, "submitted", `Submitted draft "${draft.title}" for review.`);

    // Notification: revised resubmitted or newly submitted
    if (draft.assignedReviewer) {
      await notifyUser(
        context,
        organisationId,
        draft.assignedReviewer.id,
        "review_assigned",
        `Draft "${draft.title}" is ready for your review.`
      );
    }

    revalidateReview(organisationId, draftId);
    return successState("Submitted for review.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

// 2. Assign / Reassign Reviewer
export async function assignReviewerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const reviewerId = text(formData, "reviewerId") || "";

    const draft = await assignReviewer(reviewDeps(context), { organisationId, draftId, reviewerId });

    // Audit Log
    await recordAudit(context, organisationId, draftId, "assigned", `Assigned reviewer to draft "${draft.title}".`, { reviewerId });

    // Notification
    await notifyUser(
      context,
      organisationId,
      reviewerId,
      "review_assigned",
      `You have been assigned to review draft "${draft.title}".`
    );

    revalidateReview(organisationId, draftId);
    return successState("Reviewer assigned.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

// 3. Record Decision (Approve / Request Changes / Reject)
export async function recordReviewDecisionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const deps = reviewDeps(context);
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const comment = textOrEmpty(formData, "comment");
    const decision = text(formData, "decision") || "";

    const input = { organisationId, draftId, comment };
    let draft;
    let eventType = "";
    let description = "";

    if (decision === "approve") {
      draft = await approveDraft(deps, input);
      eventType = "approved";
      description = `Approved draft "${draft.title}".`;
      // Notify creator
      if (draft.createdBy) {
        await notifyUser(context, organisationId, draft.createdBy.id, "approval_granted", `Your draft "${draft.title}" has been approved!`);
      }
    } else if (decision === "reject") {
      draft = await rejectDraft(deps, input);
      eventType = "rejected";
      description = `Rejected draft "${draft.title}".`;
      // Notify creator
      if (draft.createdBy) {
        await notifyUser(context, organisationId, draft.createdBy.id, "review_rejected", `Your draft "${draft.title}" was rejected.`);
      }
    } else {
      draft = await requestDraftChanges(deps, input);
      eventType = "revision_requested";
      description = `Requested revisions on draft "${draft.title}".`;
      // Notify creator
      if (draft.createdBy) {
        await notifyUser(context, organisationId, draft.createdBy.id, "revision_requested", `Revisions requested on your draft "${draft.title}".`);
      }
    }

    // Audit Log
    await recordAudit(context, organisationId, draftId, eventType, description, { comment });

    revalidateReview(organisationId, draftId);
    return successState(
      decision === "approve" ? "Approved." : decision === "reject" ? "Rejected." : "Sent back for changes.",
      draft.id
    );
  } catch (error) {
    return errorState(error);
  }
}

// 4. Reopen Review
export async function reopenReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const comment = textOrEmpty(formData, "comment");

    const draft = await reopenReview(reviewDeps(context), { organisationId, draftId, comment });

    // Audit Log
    await recordAudit(context, organisationId, draftId, "reopened", `Reopened review on draft "${draft.title}".`, { comment });

    revalidateReview(organisationId, draftId);
    return successState("Reopened.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

// 5. Comments Actions
export async function createCommentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const body = text(formData, "body") || "";
    const parentId = formData.get("parentId") as string || null;

    const comment = await context.reviews.createComment(organisationId, draftId, context.actor.id, parentId, body);

    // Audit Log
    await recordAudit(context, organisationId, draftId, "comment_created", `Added a comment: "${body.substring(0, 50)}...".`, { commentId: comment.id });

    // Check for mentions or notify author
    const draft = await context.content.findDraft(organisationId, draftId);
    if (draft && draft.createdBy && draft.createdBy.id !== context.actor.id) {
      await notifyUser(context, organisationId, draft.createdBy.id, "comment_mention", `New comment on draft "${draft.title}" from ${context.actor.fullName || context.actor.email}.`);
    }

    revalidateReview(organisationId, draftId);
    return successState("Comment added.", comment.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateCommentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const commentId = text(formData, "commentId") || "";
    const body = text(formData, "body") || "";
    const draftId = text(formData, "draftId") || "";

    const comment = await context.reviews.updateComment(organisationId, commentId, context.actor.id, body);

    revalidateReview(organisationId, draftId);
    return successState("Comment updated.", comment.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function resolveCommentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const commentId = text(formData, "commentId") || "";
    const draftId = text(formData, "draftId") || "";

    await context.reviews.resolveComment(organisationId, commentId, context.actor.id);

    // Audit Log
    await recordAudit(context, organisationId, draftId, "comment_resolved", `Resolved comment.`, { commentId });

    revalidateReview(organisationId, draftId);
    return successState("Comment resolved.", commentId);
  } catch (error) {
    return errorState(error);
  }
}

export async function reopenCommentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const commentId = text(formData, "commentId") || "";
    const draftId = text(formData, "draftId") || "";

    await context.reviews.reopenComment(organisationId, commentId);

    // Audit Log
    await recordAudit(context, organisationId, draftId, "comment_reopened", `Reopened resolved comment.`, { commentId });

    revalidateReview(organisationId, draftId);
    return successState("Comment reopened.", commentId);
  } catch (error) {
    return errorState(error);
  }
}

// 6. Version History Actions
export async function restoreVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const versionNumber = parseInt(text(formData, "versionNumber") || "0");

    const currentDraft = await context.content.findDraft(organisationId, draftId);
    if (!currentDraft) throw new Error("Draft not found.");

    const versions = await context.content.listVersions(organisationId, draftId);
    const targetVersion = versions.find(v => v.version === versionNumber);
    if (!targetVersion) throw new Error("Target version not found.");

    // Update draft with values from restored version
    const draft = await context.content.updateDraft(draftId, {
      organisationId,
      title: targetVersion.title,
      contentType: targetVersion.contentType,
      categoryId: targetVersion.categoryId,
      campaignId: targetVersion.campaignId,
      summary: currentDraft.summary,
      body: targetVersion.body,
      dueAt: currentDraft.dueAt,
      reviewerIds: currentDraft.reviewerIds || [],
      priority: targetVersion.priority,
      reviewDeadline: targetVersion.reviewDeadline,
      updatedBy: context.actor.id,
    });

    // Annotate restored version comment
    await context.content.annotateLatestVersion(draftId, `Restored from version ${versionNumber}`);

    // Audit Log
    await recordAudit(context, organisationId, draftId, "version_restored", `Restored version ${versionNumber} as new version ${draft.version}.`, { versionNumber });

    revalidateReview(organisationId, draftId);
    return successState(`Restored version ${versionNumber}.`, draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function duplicateVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const versionNumber = parseInt(text(formData, "versionNumber") || "0");

    const currentDraft = await context.content.findDraft(organisationId, draftId);
    if (!currentDraft) throw new Error("Draft not found.");

    const versions = await context.content.listVersions(organisationId, draftId);
    const targetVersion = versions.find(v => v.version === versionNumber);
    if (!targetVersion) throw new Error("Target version not found.");

    // Create a new draft duplicated from this version
    const draft = await context.content.createDraft({
      organisationId,
      title: `${targetVersion.title} (Copy)`,
      contentType: targetVersion.contentType,
      categoryId: targetVersion.categoryId,
      campaignId: targetVersion.campaignId,
      summary: currentDraft.summary,
      body: targetVersion.body,
      dueAt: currentDraft.dueAt,
      reviewerIds: currentDraft.reviewerIds || [],
      priority: targetVersion.priority,
      reviewDeadline: targetVersion.reviewDeadline,
      createdBy: context.actor.id,
    });

    // Audit Log
    await recordAudit(context, organisationId, draftId, "version_duplicated", `Duplicated version ${versionNumber} into new draft "${draft.title}".`, { duplicatedDraftId: draft.id });

    revalidateReview(organisationId, draftId);
    return successState(`Duplicated into new draft.`, draft.id);
  } catch (error) {
    return errorState(error);
  }
}

// 7. Scheduling & Archiving
export async function scheduleDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const scheduledAt = text(formData, "scheduledAt") || "";
    const platform = text(formData, "platform") || "";
    const timezone = text(formData, "timezone") || "UTC";

    const draft = await context.content.scheduleDraft(organisationId, draftId, {
      scheduledAt,
      platform,
      timezone,
      updatedBy: context.actor.id,
    });

    // Audit Log
    await recordAudit(context, organisationId, draftId, "scheduled", `Scheduled content for publishing on ${platform} at ${scheduledAt}.`, { scheduledAt, platform });

    revalidateReview(organisationId, draftId);
    return successState("Draft scheduled.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function archiveDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const isArchive = text(formData, "isArchive") === "true";

    const status = isArchive ? "archived" : "draft";
    const draft = await context.content.updateStatus(organisationId, draftId, status, context.actor.id);

    // Audit Log
    await recordAudit(context, organisationId, draftId, isArchive ? "archived" : "restored_from_archive", isArchive ? `Archived draft.` : `Restored draft from archive.`);

    revalidateReview(organisationId, draftId);
    return successState(isArchive ? "Archived." : "Restored.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

// 8. Update Priority & Deadline
export async function updatePriorityAndDeadlineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId") || "";
    const draftId = text(formData, "draftId") || "";
    const priority = (text(formData, "priority") || "medium") as "low" | "medium" | "high";
    const reviewDeadline = textOrEmpty(formData, "reviewDeadline");

    const draft = await context.content.findDraft(organisationId, draftId);
    if (!draft) throw new Error("Draft not found.");

    const updated = await context.content.updateDraft(draftId, {
      organisationId,
      title: draft.title,
      contentType: draft.contentType,
      categoryId: draft.category?.id || null,
      campaignId: draft.campaign?.id || null,
      summary: draft.summary,
      body: draft.body,
      dueAt: draft.dueAt,
      reviewerIds: draft.reviewerIds,
      priority,
      reviewDeadline: reviewDeadline || null,
      updatedBy: context.actor.id,
    });

    revalidateReview(organisationId, draftId);
    return successState("Priority and deadline updated.", updated.id);
  } catch (error) {
    return errorState(error);
  }
}
