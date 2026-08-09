"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import {
  cancelPublishingJob,
  createImmediatePublishingJob,
  createScheduledPublishingJob,
  generateIdempotencyKey,
  retryFailedPublishingJob,
} from "@/core/application/use-cases/publishing";
import { checkPublishingPreflight } from "@/core/application/use-cases/publishing/preflight";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { ValidationError } from "@/core/domain/errors";
import { isPublishingPlatform } from "@/core/domain/entities/publishing";
import { errorState, successState, textOrEmpty, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

function publishingDeps(context: Awaited<ReturnType<typeof requireContext>>) {
  return {
    actor: context.actor,
    publishing: context.publishing,
    blotatoAccounts: context.blotatoAccounts,
    content: context.content,
    organisations: context.organisations,
    audits: context.audits,
    notifications: context.notifications,
  };
}

function revalidatePublishing(organisationId: string, draftId?: string) {
  revalidatePath(routes.organisations.content.index(organisationId));
  revalidatePath(routes.organisations.detail(organisationId));
  revalidatePath(routes.dashboard);
  if (draftId) revalidatePath(routes.organisations.content.draft(organisationId, draftId));
}

export async function createImmediatePublishingJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");
    const platform = textOrEmpty(formData, "platform");
    const idempotencyKey = textOrEmpty(formData, "idempotencyKey");
    const devSimulationModeRaw = textOrEmpty(formData, "devSimulationMode");
    const devSimulationMode =
      devSimulationModeRaw === "fail_next_attempt" || devSimulationModeRaw === "always_fail"
        ? devSimulationModeRaw
        : null;

    const resolvedAccountId = formData.get("resolvedAccountId")?.toString() || null;

    if (!isPublishingPlatform(platform)) throw new Error("Choose a destination platform.");
    if (!idempotencyKey) throw new Error("Missing request identifier — reload the page and try again.");

    if (blotatoConfig().livePublishingEnabled) {
      const preflight = await checkPublishingPreflight(
        { content: context.content, media: context.media },
        { organisationId, draftId, platform },
      );
      if (!preflight.ready) {
        throw new ValidationError(`Cannot publish: ${preflight.blockers.join(" ")}`);
      }
    }

    const job = await createImmediatePublishingJob(publishingDeps(context), {
      organisationId,
      draftId,
      platform,
      idempotencyKey,
      devSimulationMode,
      resolvedAccountId,
    });

    revalidatePublishing(organisationId, draftId);
    return successState("Queued for publishing — this page will update automatically as it publishes.", job.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function createScheduledPublishingJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");
    const platform = textOrEmpty(formData, "platform");
    // Read the pre-converted UTC instant, not the raw local datetime — the
    // browser already resolved it (via the same convertLocalTimeToUtc, at
    // the moment the operator clicked Schedule) into the always-enabled
    // hidden `scheduledForUtc` field. Re-deriving it here from the visible
    // scheduledAt/timezone controls is what broke: those controls disable
    // themselves the instant the review dialog opens, and a disabled native
    // form control is excluded from FormData entirely, so a submission that
    // happens while the dialog is open (the normal case) silently lost them.
    const scheduledForUtc = textOrEmpty(formData, "scheduledForUtc");
    const timezone = textOrEmpty(formData, "timezone") || "UTC";
    const idempotencyKey = textOrEmpty(formData, "idempotencyKey");

    const resolvedAccountId = formData.get("resolvedAccountId")?.toString() || null;

    if (!isPublishingPlatform(platform)) throw new Error("Choose a destination platform.");
    if (!scheduledForUtc) throw new Error("Choose a date and time to publish.");
    const scheduledForDate = new Date(scheduledForUtc);
    if (Number.isNaN(scheduledForDate.getTime())) throw new Error("That date and time could not be understood.");
    if (!idempotencyKey) throw new Error("Missing request identifier — reload the page and try again.");

    if (blotatoConfig().livePublishingEnabled) {
      const preflight = await checkPublishingPreflight(
        { content: context.content, media: context.media },
        { organisationId, draftId, platform },
      );
      if (!preflight.ready) {
        throw new ValidationError(`Cannot schedule: ${preflight.blockers.join(" ")}`);
      }
    }

    const job = await createScheduledPublishingJob(publishingDeps(context), {
      organisationId,
      draftId,
      platform,
      scheduledFor: scheduledForDate.toISOString(),
      timezone,
      idempotencyKey,
      resolvedAccountId,
    });

    revalidatePublishing(organisationId, draftId);
    return successState("Scheduled — the worker will publish it automatically at the scheduled time.", job.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function retryPublishingJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const jobId = textOrEmpty(formData, "jobId");
    const draftId = textOrEmpty(formData, "draftId");

    // Fail closed BEFORE requeueing: a job that was failed for a genuine
    // provider reason (e.g. the Instagram hashtag-limit rejection this
    // guards against) must not be silently requeued only to fail the exact
    // same way again a few seconds later once the worker re-claims it. The
    // worker's own preflight (defense in depth) would still catch it, but
    // checking here gives the operator an immediate, actionable reason
    // instead of a pointless queued→failed round trip.
    const existingJob = await context.publishing.findJobById(organisationId, jobId);
    if (existingJob && blotatoConfig().livePublishingEnabled) {
      const preflight = await checkPublishingPreflight(
        { content: context.content, media: context.media },
        { organisationId, draftId: existingJob.draftId, platform: existingJob.platform },
      );
      if (!preflight.ready) {
        throw new ValidationError(`Cannot retry: ${preflight.blockers.join(" ")} Correct the draft, then retry again.`);
      }
    }

    const job = await retryFailedPublishingJob(publishingDeps(context), organisationId, jobId);

    revalidatePublishing(organisationId, draftId);
    return successState("Retry queued.", job.id);
  } catch (error) {
    return errorState(error);
  }
}

/**
 * Called directly from the Content Calendar's drag-and-drop (not a
 * useActionState form — Server Actions can be invoked as plain typed
 * functions too). Only a still-`queued` scheduled job may move: a job
 * already `processing`/`published`/`failed`/`cancelled` is left completely
 * untouched, so dragging can never bypass the state machine or reopen a
 * settled outcome — this is the "do not permit dragging published content
 * into an invalid state" rule enforced server-side, not just by the UI
 * disabling the drag handle.
 */
export async function reschedulePublishingJob(
  organisationId: string,
  draftId: string,
  platform: string,
  newScheduledFor: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const context = await requireContext();
    if (!isPublishingPlatform(platform)) return { success: false, message: "Unknown destination platform." };

    const scheduledDate = new Date(newScheduledFor);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      return { success: false, message: "Choose a future date to reschedule to." };
    }

    const deps = publishingDeps(context);
    const activeJob = await context.publishing.findActiveJobForDraftPlatform(draftId, platform);
    if (!activeJob || activeJob.status !== "queued") {
      return {
        success: false,
        message: "This item can no longer be rescheduled — it is already publishing, published, failed, or has no active job.",
      };
    }

    await cancelPublishingJob(deps, organisationId, activeJob.id);
    const rescheduled = await createScheduledPublishingJob(deps, {
      organisationId,
      draftId,
      platform,
      scheduledFor: scheduledDate.toISOString(),
      timezone: "UTC",
      idempotencyKey: generateIdempotencyKey(),
      // Preserve the original destination lock so a drag-and-drop reschedule never
      // re-opens account resolution and never fails on 2+ same-platform accounts.
      resolvedAccountId: activeJob.resolvedAccountId ?? null,
    });

    revalidatePublishing(organisationId, draftId);
    return { success: true, message: `Rescheduled for ${new Date(rescheduled.scheduledFor).toLocaleString()}.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Failed to reschedule." };
  }
}

export async function cancelPublishingJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const jobId = textOrEmpty(formData, "jobId");
    const draftId = textOrEmpty(formData, "draftId");

    const job = await cancelPublishingJob(publishingDeps(context), organisationId, jobId);

    revalidatePublishing(organisationId, draftId);
    return successState("Publishing job cancelled.", job.id);
  } catch (error) {
    return errorState(error);
  }
}
