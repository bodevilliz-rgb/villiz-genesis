import type { PublishingRepository } from "@/core/application/ports/publishing-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { AuditRepository } from "@/core/application/ports/audit-port";
import type { NotificationRepository } from "@/core/application/ports/notification-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import {
  PUBLISHING_PLATFORM_LABELS,
  hasExceededConfirmationHorizon,
  nextConfirmationCheckDelayMs,
  type PublishingJob,
} from "@/core/domain/entities/publishing";

/**
 * The ONE background provider-confirmation pass, shared verbatim by both
 * publishing workers (the Render long-lived worker and the Vercel
 * API-route worker). Extracted as its own module specifically so those two
 * paths cannot drift again — the previous P0 was caused by exactly that
 * kind of divergence.
 *
 * What this does: takes one job that is `awaiting_confirmation` and due for
 * a check, asks the provider what happened to the submission it ALREADY
 * has, and resolves the job accordingly.
 *
 * THE CENTRAL SAFETY INVARIANT — this pass may call `getPostStatus` and
 * nothing else. It never calls `publishPost`, never calls `uploadMedia`,
 * never resolves media, never creates a second provider submission. That is
 * enforced structurally by the dependency type below: `blotatoClient` is
 * narrowed to `Pick<BlotatoClient, "getPostStatus">`, so there is no
 * publish method in scope to call even by mistake.
 */
export interface ConfirmationDeps {
  publishing: PublishingRepository;
  content: ContentRepository;
  audits: AuditRepository;
  notifications: NotificationRepository;
  /** Deliberately narrowed: this pass structurally cannot publish or upload. */
  blotatoClient: Pick<BlotatoClient, "getPostStatus">;
}

export type ConfirmationOutcome =
  | { status: "idle" }
  | { status: "resolved"; jobId: string; result: "published"; externalUrl: string }
  | { status: "resolved"; jobId: string; result: "failed"; errorMessage: string }
  | { status: "pending"; jobId: string; nextStatusCheckAt: string }
  | { status: "unresolved"; jobId: string; reason: "horizon_exceeded" | "missing_submission_id" };

/** Reads the provider submission id recorded on the job's most recent attempt. Null when there is none to re-check. */
function findSubmissionId(providerMetadata: Record<string, unknown> | undefined): string | null {
  const value = providerMetadata?.postSubmissionId;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Runs at most one confirmation check. One call = at most one job, matching
 * runPublishingWorkerIteration's deliberate single-job-per-invocation design:
 * the caller controls throughput by invocation frequency, and one job's
 * confirmation failure can never corrupt another's.
 *
 * Never throws for a provider or job-level problem — every path either
 * resolves the job, reschedules it, or marks it unresolved for operator
 * attention.
 */
export async function runProviderConfirmationPass(
  deps: ConfirmationDeps,
  options: { workerId: string; now?: Date } = { workerId: "worker" },
): Promise<ConfirmationOutcome> {
  const now = options.now ?? new Date();

  const job = await deps.publishing.claimJobForConfirmation(options.workerId);
  if (!job) return { status: "idle" };

  // Defense in depth. A simulated job can never reach awaiting_confirmation
  // (simulatePublish always returns a terminal result), so this is
  // unreachable in practice — but the previous P0 was precisely a case of
  // trusting that something was "structurally impossible" without a guard.
  // Stop auto-checking rather than ever asking the provider about a
  // submission that does not exist.
  if (job.executionMode !== "live") {
    await deps.publishing.recordConfirmationCheck(job.id, null);
    return { status: "unresolved", jobId: job.id, reason: "missing_submission_id" };
  }

  const attempts = await deps.publishing.listAttemptsForJob(job.organisationId, job.id);
  const lastAttempt = attempts[attempts.length - 1];
  const submissionId = findSubmissionId(lastAttempt?.providerMetadata);

  if (!lastAttempt || !submissionId) {
    // Nothing to re-check safely. Deliberately does NOT republish and does
    // NOT invent a failure — it stops the automatic loop and leaves the job
    // visible for an operator.
    await deps.publishing.recordConfirmationCheck(job.id, null);
    await deps.audits.recordEvent({
      organisationId: job.organisationId,
      draftId: job.draftId,
      actorId: null,
      eventType: "publishing_confirmation_unresolved",
      description: `Cannot confirm the ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish: no provider submission id was recorded. Genesis will not resubmit — check the provider directly.`,
      metadata: { jobId: job.id, reason: "missing_submission_id" },
    });
    return { status: "unresolved", jobId: job.id, reason: "missing_submission_id" };
  }

  const status = await deps.blotatoClient.getPostStatus(submissionId);

  if (status.status === "published") {
    // The awaiting attempt is NOT terminal (the DB's
    // prevent_terminal_attempt_mutation trigger only guards
    // completed/failed), so it resolves in place. One real submission stays
    // one attempt row — no synthetic "reconciliation attempt" is needed, and
    // attempt history never claimed an outcome it did not have.
    await deps.publishing.completeAttempt(lastAttempt.id, {
      externalPostId: status.postSubmissionId,
      externalUrl: status.publicUrl ?? "https://my.blotato.com",
      providerMetadata: { ...lastAttempt.providerMetadata, confirmedAfterAwaiting: true },
    });
    await deps.publishing.markJobPublished(job.id);
    await deps.content.updateStatus(job.organisationId, job.draftId, "published", job.requestedBy || "");

    await deps.audits.recordEvent({
      organisationId: job.organisationId,
      draftId: job.draftId,
      actorId: null,
      eventType: "publishing_attempt_completed",
      description: `Provider confirmed the ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish. No new post was submitted.`,
      metadata: {
        jobId: job.id,
        attemptId: lastAttempt.id,
        postSubmissionId: submissionId,
        externalUrl: status.publicUrl ?? null,
        confirmedAfterAwaiting: true,
      },
    });

    if (job.requestedBy) {
      try {
        await deps.notifications.createNotification({
          organisationId: job.organisationId,
          profileId: job.requestedBy,
          type: "publish_succeeded",
          message: `Your ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish is confirmed. ${status.publicUrl ?? ""}`.trim(),
        });
      } catch {
        // Best-effort — never roll back a confirmed publish over a notification.
      }
    }

    return { status: "resolved", jobId: job.id, result: "published", externalUrl: status.publicUrl ?? "https://my.blotato.com" };
  }

  if (status.status === "failed") {
    // The ONLY path that may write a terminal failure: the provider itself
    // said so.
    const errorMessage = status.errorMessage ?? "The provider reported this post failed, with no further detail.";
    await deps.publishing.failAttempt(lastAttempt.id, {
      errorCode: "blotato_publish_failed",
      errorMessage,
      providerMetadata: { ...lastAttempt.providerMetadata, confirmedAfterAwaiting: true },
    });
    await deps.publishing.markJobFailed(job.id);
    await deps.content.updateStatus(job.organisationId, job.draftId, "failed", job.requestedBy || "");

    await deps.audits.recordEvent({
      organisationId: job.organisationId,
      draftId: job.draftId,
      actorId: null,
      eventType: "publishing_attempt_failed",
      description: `Provider confirmed the ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish failed: ${errorMessage}`,
      metadata: { jobId: job.id, attemptId: lastAttempt.id, postSubmissionId: submissionId, confirmedAfterAwaiting: true },
    });

    if (job.requestedBy) {
      try {
        await deps.notifications.createNotification({
          organisationId: job.organisationId,
          profileId: job.requestedBy,
          type: "publish_failed",
          message: `Your ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish failed: ${errorMessage}`,
        });
      } catch {
        // Best-effort, as everywhere else.
      }
    }

    return { status: "resolved", jobId: job.id, result: "failed", errorMessage };
  }

  // Provider still non-terminal ("in-progress" / "scheduled").
  const anchor = job.awaitingConfirmationSince ?? job.updatedAt;
  if (hasExceededConfirmationHorizon(anchor, now)) {
    // Stop checking automatically. Deliberately NOT a failure and
    // deliberately NOT a republish — the submission is real and its outcome
    // is genuinely unknown, so it stays awaiting_confirmation with no next
    // check, which isProviderConfirmationUnresolved surfaces as needing
    // operator attention.
    await deps.publishing.recordConfirmationCheck(job.id, null);
    await deps.audits.recordEvent({
      organisationId: job.organisationId,
      draftId: job.draftId,
      actorId: null,
      eventType: "publishing_confirmation_unresolved",
      description: `The provider has not confirmed this ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish within the confirmation window. Genesis has stopped checking automatically and will not resubmit — check the provider directly.`,
      metadata: { jobId: job.id, postSubmissionId: submissionId, reason: "horizon_exceeded" },
    });
    return { status: "unresolved", jobId: job.id, reason: "horizon_exceeded" };
  }

  const nextCheckAt = new Date(now.getTime() + nextConfirmationCheckDelayMs(job.statusCheckCount + 1)).toISOString();
  await deps.publishing.recordConfirmationCheck(job.id, nextCheckAt);
  return { status: "pending", jobId: job.id, nextStatusCheckAt: nextCheckAt };
}

/** True when this job is one the confirmation pass would act on — used by the queue UI and the retry guard. */
export function isAwaitingProviderConfirmation(job: Pick<PublishingJob, "status">): boolean {
  return job.status === "awaiting_confirmation";
}

/**
 * Backoff for INFRASTRUCTURE failures of the confirmation pass (a broken
 * RPC, an unreachable database) — deliberately distinct from
 * nextConfirmationCheckDelayMs, which paces provider status checks for a
 * healthy job.
 *
 * P0 follow-up: a return-shape defect made every confirmation attempt throw,
 * and because the pass ran on each poll tick the worker emitted an identical
 * error every ~2 seconds indefinitely — hammering Supabase and the logs with
 * no possibility of progress. Ramps 5s → 10s → 20s → 40s → 80s and holds at
 * 120s: fast enough that a transient blip self-heals within one cycle, slow
 * enough that a genuinely broken subsystem costs ~30 calls/hour instead of
 * ~1800.
 */
const CONFIRMATION_ERROR_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 120_000] as const;

export function nextConfirmationErrorBackoffMs(consecutiveFailures: number): number {
  const index = Math.min(Math.max(consecutiveFailures - 1, 0), CONFIRMATION_ERROR_BACKOFF_MS.length - 1);
  return CONFIRMATION_ERROR_BACKOFF_MS[index]!;
}

export interface ConfirmationErrorGate {
  /** False while backing off from a recent infrastructure failure — the caller skips the pass entirely. */
  shouldAttempt(now: number): boolean;
  /** Clears any backoff. Called after a pass completes without throwing. */
  recordSuccess(): void;
  /** Starts/extends the backoff. Returns the delay applied, and whether this is the first failure of the streak (so the caller can log once rather than every tick). */
  recordFailure(now: number): { backoffMs: number; isFirstOfStreak: boolean };
}

/**
 * Small mutable gate the workers hold across ticks. Pure and injectable so
 * the "does not retry every 2 seconds" behaviour is directly testable
 * without timers or a real worker loop.
 */
export function createConfirmationErrorGate(): ConfirmationErrorGate {
  let consecutiveFailures = 0;
  let retryAfter = 0;

  return {
    shouldAttempt(now: number): boolean {
      return now >= retryAfter;
    },
    recordSuccess(): void {
      consecutiveFailures = 0;
      retryAfter = 0;
    },
    recordFailure(now: number): { backoffMs: number; isFirstOfStreak: boolean } {
      const isFirstOfStreak = consecutiveFailures === 0;
      consecutiveFailures += 1;
      const backoffMs = nextConfirmationErrorBackoffMs(consecutiveFailures);
      retryAfter = now + backoffMs;
      return { backoffMs, isFirstOfStreak };
    },
  };
}
