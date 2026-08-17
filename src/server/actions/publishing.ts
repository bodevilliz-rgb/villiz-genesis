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
import type { CommercialDisclosure } from "@/core/domain/entities/publishing-preflight";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { ValidationError } from "@/core/domain/errors";
import { isPublishingPlatform, resolveEffectiveLivePublishing } from "@/core/domain/entities/publishing";
import { isContentDraftLocked } from "@/core/domain/entities/content";
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
    engagement: context.engagement,
  };
}

function revalidatePublishing(organisationId: string, draftId?: string) {
  revalidatePath(routes.organisations.content.index(organisationId));
  revalidatePath(routes.organisations.detail(organisationId));
  revalidatePath(routes.dashboard);
  if (draftId) revalidatePath(routes.organisations.content.draft(organisationId, draftId));
}

/**
 * Parses the publishing panel's AI-generated-content declaration. Strictly
 * three-state: only the literal strings "true"/"false" count as a
 * declaration; anything else (missing field, empty string, tampered value)
 * is null = "never declared", which deterministic preflight blocks for
 * platforms that require the disclosure. Never defaults.
 */
function parseAiDisclosure(formData: FormData): boolean | null {
  const raw = formData.get("isAiGenerated")?.toString();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * P0 fix: parses the operator-reviewed execution Mode captured in the
 * publishing panel's intent snapshot. Fails closed to "simulation" — the
 * one safe default — for anything but the literal string "live" (missing
 * field, empty string, tampered value). This is the single point where a
 * form submission becomes the value persisted on the job and later
 * consulted by every worker (see resolveEffectiveLivePublishing); nothing
 * downstream may ever re-derive it from a process's own environment.
 */
function parseExecutionMode(formData: FormData): "simulation" | "live" {
  const raw = formData.get("executionMode")?.toString();
  return raw === "live" ? "live" : "simulation";
}

/**
 * Parses the publishing panel's Commercial Content declaration — a single
 * hidden field carrying which of the mutually-considered checkbox states
 * the operator actively chose ("none" | "own" | "branded" | "both"),
 * mapped onto TikTok's two independent target booleans. Anything else
 * (missing field, empty string, tampered value) means "never declared":
 * both fields come back null, which deterministic preflight blocks for
 * platforms that require the disclosure. Never defaults.
 */
function parseCommercialDisclosure(formData: FormData): CommercialDisclosure {
  const raw = formData.get("commercialDisclosure")?.toString();
  switch (raw) {
    case "none":
      return { isYourBrand: false, isBrandedContent: false };
    case "own":
      return { isYourBrand: true, isBrandedContent: false };
    case "branded":
      return { isYourBrand: false, isBrandedContent: true };
    case "both":
      return { isYourBrand: true, isBrandedContent: true };
    default:
      return { isYourBrand: null, isBrandedContent: null };
  }
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
    const executionMode = parseExecutionMode(formData);
    const isAiGenerated = parseAiDisclosure(formData);
    const commercialDisclosure = parseCommercialDisclosure(formData);

    if (!isPublishingPlatform(platform)) throw new Error("Choose a destination platform.");
    if (!idempotencyKey) throw new Error("Missing request identifier — reload the page and try again.");

    // P0 fix: preflight enforcement (and every deterministic platform
    // requirement) is now gated on the SAME single authority every worker
    // uses (resolveEffectiveLivePublishing) — not this process's global
    // flag alone. A simulation-reviewed job must never be preflight-
    // enforced as if it were live just because this request happens to be
    // running where the global flag is on, and a live-reviewed job must
    // always be enforced regardless.
    if (resolveEffectiveLivePublishing(executionMode, blotatoConfig().livePublishingEnabled)) {
      const preflight = await checkPublishingPreflight(
        { content: context.content, media: context.media },
        { organisationId, draftId, platform, aiGeneratedDisclosure: isAiGenerated, commercialDisclosure },
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
      executionMode,
      isAiGenerated,
      isYourBrand: commercialDisclosure.isYourBrand,
      isBrandedContent: commercialDisclosure.isBrandedContent,
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
    const executionMode = parseExecutionMode(formData);
    const isAiGenerated = parseAiDisclosure(formData);
    const commercialDisclosure = parseCommercialDisclosure(formData);

    if (!isPublishingPlatform(platform)) throw new Error("Choose a destination platform.");
    if (!scheduledForUtc) throw new Error("Choose a date and time to publish.");
    const scheduledForDate = new Date(scheduledForUtc);
    if (Number.isNaN(scheduledForDate.getTime())) throw new Error("That date and time could not be understood.");
    if (!idempotencyKey) throw new Error("Missing request identifier — reload the page and try again.");

    // P0 fix — see the identical comment in createImmediatePublishingJobAction.
    if (resolveEffectiveLivePublishing(executionMode, blotatoConfig().livePublishingEnabled)) {
      const preflight = await checkPublishingPreflight(
        { content: context.content, media: context.media },
        { organisationId, draftId, platform, aiGeneratedDisclosure: isAiGenerated, commercialDisclosure },
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
      executionMode,
      isAiGenerated,
      isYourBrand: commercialDisclosure.isYourBrand,
      isBrandedContent: commercialDisclosure.isBrandedContent,
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
    if (existingJob) {
      // Governed correction workflow (fix/failed-publish-recovery): a Lead
      // may reopen a failed draft for correction (failed -> needs_review),
      // which unlocks editing but does NOT touch this job row. Once that
      // happens the draft is actively being edited, and retry must wait for
      // it to be freshly re-approved — resending mid-edit content would
      // resubmit whatever half-finished state happens to be saved.
      //
      // Deliberately narrower than "must be approved": a job that failed for
      // a reason that needed no content correction at all (a transient
      // network blip, a temporarily disconnected account) leaves the draft
      // at status "failed" untouched — that must remain retryable exactly as
      // before, with no forced reopen/reapprove detour. Only an EXPLICIT
      // reopen (moving the draft into an editable review state) creates the
      // "must reapprove first" requirement.
      const draft = await context.content.findDraft(organisationId, existingJob.draftId);
      if (draft && !isContentDraftLocked(draft.status) && draft.status !== "approved") {
        throw new ValidationError("Approve the corrected draft before retrying.");
      }

      // P0 fix: the retry reuses the SAME job row, so its persisted
      // executionMode — the operator-reviewed value from original creation
      // — is what gates preflight here too, exactly matching what the
      // worker will do when it re-claims this job. A simulated job's retry
      // is never preflight-enforced just because this process's global
      // flag happens to be on.
      if (resolveEffectiveLivePublishing(existingJob.executionMode, blotatoConfig().livePublishingEnabled)) {
        // The retry reuses the SAME job row, so the governed disclosure
        // values for this publication are the ones persisted on it at
        // creation — passed through here so the checks reflect what the
        // worker will actually send, not unset form fields.
        const preflight = await checkPublishingPreflight(
          { content: context.content, media: context.media },
          {
            organisationId,
            draftId: existingJob.draftId,
            platform: existingJob.platform,
            aiGeneratedDisclosure: existingJob.isAiGenerated,
            commercialDisclosure: { isYourBrand: existingJob.isYourBrand, isBrandedContent: existingJob.isBrandedContent },
          },
        );
        if (!preflight.ready) {
          throw new ValidationError(`Cannot retry: ${preflight.blockers.join(" ")} Correct the draft, then retry again.`);
        }
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
      // P0 fix: preserve the original operator-reviewed execution mode —
      // dragging to a new time is not a new Pre-Publish Review, so the
      // replacement job must carry forward exactly what was originally
      // confirmed, never re-derived from whatever this process's global
      // flag happens to be right now.
      executionMode: activeJob.executionMode,
      // Same preservation for the AI disclosure: dragging to a new time is not
      // a new declaration — the content is unchanged, so the operator's
      // original declaration carries to the replacement job.
      isAiGenerated: activeJob.isAiGenerated ?? null,
      isYourBrand: activeJob.isYourBrand ?? null,
      isBrandedContent: activeJob.isBrandedContent ?? null,
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
