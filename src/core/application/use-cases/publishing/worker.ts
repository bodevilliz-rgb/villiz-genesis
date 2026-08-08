import { randomUUID } from "crypto";
import type { PublishingRepository } from "@/core/application/ports/publishing-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { AuditRepository } from "@/core/application/ports/audit-port";
import type { NotificationRepository } from "@/core/application/ports/notification-port";
import type { PublishingJob } from "@/core/domain/entities/publishing";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { resolvePublisher } from "@/infrastructure/publishers/publisher-factory";
import { resolveEffectiveSimulationMode } from "@/infrastructure/publishers/simulation-mode";
import {
  claimNextPublishingJob,
  completePublishingAttempt,
  failPublishingAttempt,
  recoverStalePublishingJobs,
  startPublishingAttempt,
} from "./index";

export interface WorkerDeps {
  publishing: PublishingRepository;
  content: ContentRepository;
  blotatoAccounts: BlotatoAccountRepository;
  blotatoClient: BlotatoClient;
  audits: AuditRepository;
  notifications: NotificationRepository;
}

export type WorkerIterationResult =
  | { status: "idle" }
  | { status: "processed"; jobId: string; result: "published"; externalUrl: string }
  | { status: "processed"; jobId: string; result: "failed"; failureCode: string };

const DEFAULT_STALE_AFTER_SECONDS = 300;

/**
 * Executes one bounded iteration of the publishing worker:
 *
 *   1. Recover any stale/stuck processing jobs (called every iteration so a
 *      restart or crash does not leave jobs permanently processing).
 *   2. Claim the next due queued job using FOR UPDATE SKIP LOCKED — two
 *      concurrent invocations of this function can never both claim the same
 *      job; the database enforces that atomically.
 *   3. If no job is due, return idle.
 *   4. Load the draft body/title (needed for the publish payload).
 *   5. Start a publishing attempt (append-only; transitions draft → publishing).
 *   6. Execute the publisher (simulated or live Blotato, decided by env flag).
 *   7. Record success or failure, transition job and draft to terminal state.
 *
 * One call = at most one job. This is intentional — the caller (cron or
 * endpoint) controls concurrency/throughput by invocation frequency and
 * parallelism, not by looping inside here. A single-job-per-invocation design
 * also makes failures trivially bounded: one job failure cannot corrupt
 * another job's lifecycle.
 *
 * The function never throws. Any unexpected error in the publish path is
 * caught, recorded as a failed attempt, and returned as a "processed/failed"
 * result. Only errors during stale-recovery or claim — before a job is
 * in-flight — can propagate to the caller.
 */
export async function runPublishingWorkerIteration(
  deps: WorkerDeps,
  options: { workerId?: string; staleAfterSeconds?: number } = {},
): Promise<WorkerIterationResult> {
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const staleAfterSeconds = options.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;

  await recoverStalePublishingJobs({ publishing: deps.publishing }, staleAfterSeconds);

  const job = await claimNextPublishingJob({ publishing: deps.publishing }, workerId);
  if (!job) {
    return { status: "idle" };
  }

  return executeJob(deps, job);
}

async function executeJob(deps: WorkerDeps, job: PublishingJob): Promise<WorkerIterationResult> {
  const innerDeps = {
    publishing: deps.publishing,
    content: deps.content,
    audits: deps.audits,
    notifications: deps.notifications,
  };

  let attempt;
  try {
    attempt = await startPublishingAttempt(innerDeps, job);
  } catch (_startError) {
    // startPublishingAttempt itself threw (e.g. DB error creating the attempt
    // row). There is no attempt row to update, so we mark the job failed
    // directly via the repository and surface a clean result.
    await deps.publishing.markJobFailed(job.id).catch(() => undefined);
    return { status: "processed", jobId: job.id, result: "failed", failureCode: "start_attempt_error" };
  }

  try {
    const config = blotatoConfig();
    const publisher = resolvePublisher(job.platform, {
      blotatoAccounts: deps.blotatoAccounts,
      blotatoClient: deps.blotatoClient,
      livePublishingEnabled: config.livePublishingEnabled,
    });

    const draft = await deps.content.findDraft(job.organisationId, job.draftId);
    if (!draft) {
      throw Object.assign(new Error("Draft not found for publishing job."), { code: "draft_not_found" });
    }

    const devSimulationMode = resolveEffectiveSimulationMode(
      job.devSimulationMode as "always_succeed" | "fail_next_attempt" | "always_fail" | null,
    );

    const publishResult = await publisher.publish({
      organisationId: job.organisationId,
      draftId: job.draftId,
      jobId: job.id,
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      platform: job.platform,
      title: draft.title,
      body: draft.body,
      assetUrls: [],
      devSimulationMode,
      resolvedAccountId: job.resolvedAccountId,
    });

    if (publishResult.success) {
      await completePublishingAttempt(innerDeps, job, attempt, {
        externalPostId: publishResult.externalPostId,
        externalUrl: publishResult.externalUrl,
        providerMetadata: publishResult.metadata ?? {},
      });
      return {
        status: "processed",
        jobId: job.id,
        result: "published",
        externalUrl: publishResult.externalUrl,
      };
    }

    let publisherFailureCode = publishResult.errorCode;
    try {
      await failPublishingAttempt(innerDeps, job, attempt, {
        errorCode: publishResult.errorCode,
        errorMessage: publishResult.errorMessage,
        providerMetadata: publishResult.metadata ?? {},
      });
    } catch (_finalisationError) {
      // failPublishingAttempt threw — the attempt row may be incomplete, but the
      // job must still reach a terminal state within this worker invocation.
      await deps.publishing.markJobFailed(job.id).catch(() => undefined);
      publisherFailureCode = "publishing_attempt_finalisation_failed";
    }
    return {
      status: "processed",
      jobId: job.id,
      result: "failed",
      failureCode: publisherFailureCode,
    };
  } catch (unexpectedError) {
    // Unexpected throw (network error, uncaught exception). Record it as a
    // failed attempt so the operator can retry — never silently lose the job.
    const errorCode = (unexpectedError as { code?: string }).code ?? "unexpected_worker_error";
    const errorMessage =
      unexpectedError instanceof Error ? unexpectedError.message : "An unexpected error occurred during publishing.";

    let finalErrorCode = errorCode;
    try {
      await failPublishingAttempt(innerDeps, job, attempt, {
        errorCode,
        errorMessage,
        providerMetadata: {},
      });
    } catch (_finalisationError) {
      await deps.publishing.markJobFailed(job.id).catch(() => undefined);
      finalErrorCode = "publishing_attempt_finalisation_failed";
    }

    return { status: "processed", jobId: job.id, result: "failed", failureCode: finalErrorCode };
  }
}
