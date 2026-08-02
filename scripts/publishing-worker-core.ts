/**
 * Sprint 6A — background publishing worker core logic.
 *
 * A long-lived process that polls for due publishing_jobs, claims one at a
 * time (atomically — see public.claim_next_publishing_job in
 * 20260801140000_publishing_engine.sql), resolves the right publisher,
 * publishes, and records success/failure. This is the ONLY process that
 * ever moves a job from queued -> processing -> published/failed; the
 * Next.js web app never drives that transition, matching the mission's
 * "the operator must not manually move content from Publishing to
 * Published" requirement.
 *
 * Uses the service-role client throughout (this is exactly the "server/
 * worker context" the codebase's existing admin-client.ts doc-comment
 * reserves service-role usage for) — publishing_attempts grants no
 * INSERT/UPDATE to `authenticated` at all, so this worker is the only thing
 * that can ever write an attempt row.
 *
 * Sprint 6E: this file holds only the runtime logic and reads whatever is
 * already in process.env when runWorker() is called — it never loads any
 * .env* file itself. That responsibility belongs entirely to the two thin
 * entrypoints that import it:
 *   - publishing-worker.ts        (npm run worker:publishing        — local)
 *   - worker-publishing-cloud.ts  (npm run worker:publishing:cloud  — cloud)
 * Keeping the env-loading decision out of this shared module is what
 * guarantees the cloud entrypoint can never silently inherit a value from
 * .env.local: it simply never calls the function that would load it.
 */
import { createAdminClient } from "../src/infrastructure/supabase/admin-client";
import { SupabasePublishingRepository } from "../src/infrastructure/repositories/supabase-publishing-repository";
import { SupabaseContentRepository } from "../src/infrastructure/repositories/supabase-content-repository";
import { SupabaseAuditRepository } from "../src/infrastructure/repositories/supabase-audit-repository";
import { SupabaseNotificationRepository } from "../src/infrastructure/repositories/supabase-notification-repository";
import { SupabaseBlotatoAccountRepository } from "../src/infrastructure/repositories/supabase-blotato-account-repository";
import { SupabaseMediaRepository } from "../src/infrastructure/repositories/supabase-media-repository";
import { SupabaseStoragePort } from "../src/infrastructure/ports/supabase-storage-port";
import { HttpBlotatoClient } from "../src/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "../src/infrastructure/blotato/blotato-config";
import { resolvePublisher } from "../src/infrastructure/publishers/publisher-factory";
import { resolveEffectiveSimulationMode } from "../src/infrastructure/publishers/simulation-mode";
import { resolvePublishMediaUrls } from "../src/core/application/use-cases/publishing/media";
import { redactMediaUrl } from "../src/core/domain/entities/publishing-media";
import {
  claimNextPublishingJob,
  completePublishingAttempt,
  failPublishingAttempt,
  recoverStalePublishingJobs,
  startPublishingAttempt,
} from "../src/core/application/use-cases/publishing";
import type { PublishingJob } from "../src/core/domain/entities/publishing";

const POLL_INTERVAL_MS = Number(process.env.PUBLISHING_WORKER_POLL_INTERVAL_MS ?? 2000);
const STALE_RECOVERY_INTERVAL_MS = Number(process.env.PUBLISHING_WORKER_STALE_RECOVERY_INTERVAL_MS ?? 60_000);
const STALE_AFTER_SECONDS = Number(process.env.PUBLISHING_WORKER_STALE_AFTER_SECONDS ?? 300);
const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/** Exported so both entrypoint wrappers (local and cloud) can log a fatal startup error in the same shape as everything else this worker logs. */
export function log(event: string, fields: Record<string, unknown> = {}) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), workerId: WORKER_ID, event, ...fields }));
}

let shuttingDown = false;

async function processJob(job: PublishingJob, deps: ReturnType<typeof buildDeps>) {
  const started = Date.now();
  log("job_claimed", { jobId: job.id, draftId: job.draftId, platform: job.platform, triggerType: job.triggerType });

  const attempt = await startPublishingAttempt(deps, job);
  log("attempt_started", { jobId: job.id, attemptId: attempt.id, attemptNumber: attempt.attemptNumber });

  const draft = await deps.content.findDraft(job.organisationId, job.draftId);
  if (!draft) {
    // The draft was deleted out from under an already-queued job — fail the
    // attempt rather than crash the worker; a deleted draft can never publish.
    await failPublishingAttempt(deps, job, attempt, {
      errorCode: "draft_not_found",
      errorMessage: "The source draft no longer exists.",
      providerMetadata: {},
    });
    log("attempt_failed", { jobId: job.id, attemptId: attempt.id, errorCode: "draft_not_found" });
    return;
  }

  const media = await resolvePublishMediaUrls(
    { media: deps.media, storage: deps.storage },
    { organisationId: job.organisationId, draftId: job.draftId },
  );
  log("media_resolved", {
    jobId: job.id,
    draftId: job.draftId,
    mediaUrlsCount: media.mediaUrls.length,
    mediaMimeTypes: media.mimeTypes,
    redactedMediaUrls: media.mediaUrls.map(redactMediaUrl),
    skippedCrossOrganisation: media.skipped.crossOrganisation,
    skippedUnsupportedType: media.skipped.unsupportedType,
    skippedUnreachableUrl: media.skipped.unreachableUrl,
  });

  const publisher = resolvePublisher(job.platform, {
    blotatoAccounts: deps.blotatoAccounts,
    blotatoClient: deps.blotatoClient,
    livePublishingEnabled: deps.blotatoLivePublishingEnabled,
    assetMimeTypes: media.mimeTypes,
    onBeforePublish: (preview) => log("blotato_dry_run_preview", { jobId: job.id, draftId: job.draftId, ...preview }),
  });
  const effectiveMode = resolveEffectiveSimulationMode(job.devSimulationMode);

  const result = await publisher.publish({
    organisationId: job.organisationId,
    draftId: job.draftId,
    jobId: job.id,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    platform: job.platform,
    title: draft.title,
    body: draft.body,
    assetUrls: media.mediaUrls,
    devSimulationMode: effectiveMode,
  });

  if (result.success) {
    await completePublishingAttempt(deps, job, attempt, {
      externalPostId: result.externalPostId,
      externalUrl: result.externalUrl,
      providerMetadata: result.metadata ?? {},
    });
    log("attempt_completed", {
      jobId: job.id,
      attemptId: attempt.id,
      externalUrl: result.externalUrl,
      durationMs: Date.now() - started,
    });
  } else {
    await failPublishingAttempt(deps, job, attempt, {
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      providerMetadata: result.metadata ?? {},
    });
    log("attempt_failed", {
      jobId: job.id,
      attemptId: attempt.id,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      durationMs: Date.now() - started,
    });
  }
}

function buildDeps(client: ReturnType<typeof createAdminClient>) {
  const blotato = blotatoConfig();
  return {
    publishing: new SupabasePublishingRepository(client),
    content: new SupabaseContentRepository(client),
    audits: new SupabaseAuditRepository(client),
    notifications: new SupabaseNotificationRepository(client),
    blotatoAccounts: new SupabaseBlotatoAccountRepository(client),
    blotatoClient: new HttpBlotatoClient(blotato.apiKey),
    blotatoLivePublishingEnabled: blotato.livePublishingEnabled,
    media: new SupabaseMediaRepository(client),
    storage: new SupabaseStoragePort(client),
  };
}

async function runStaleRecovery(deps: ReturnType<typeof buildDeps>) {
  try {
    const recovered = await recoverStalePublishingJobs(deps, STALE_AFTER_SECONDS);
    for (const job of recovered) {
      log("stale_job_recovered", { jobId: job.id, draftId: job.draftId, newStatus: job.status });
      if (job.status === "failed") {
        await deps.content.updateStatus(job.organisationId, job.draftId, "failed", job.requestedBy || "");
      }
    }
  } catch (error) {
    log("stale_recovery_error", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function pollOnce(deps: ReturnType<typeof buildDeps>) {
  for (;;) {
    if (shuttingDown) return;
    const job = await claimNextPublishingJob(deps, WORKER_ID);
    if (!job) return;
    try {
      await processJob(job, deps);
    } catch (error) {
      // A crash mid-attempt leaves the job in 'processing' with a stale
      // claimed_at — the periodic stale-recovery pass (not this catch
      // block) is what safely requeues or fails it. Logging here is purely
      // observational.
      log("job_processing_error", { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** Entry point shared by both the local and cloud worker scripts. Assumes the caller has already loaded whichever env file is appropriate. */
export async function runWorker(): Promise<void> {
  log("worker_starting", { pollIntervalMs: POLL_INTERVAL_MS, staleAfterSeconds: STALE_AFTER_SECONDS });

  const client = createAdminClient();
  const deps = buildDeps(client);

  // Restart-recovery: a job left mid-flight by a previous worker process
  // that died must be recovered exactly once before this worker starts
  // claiming new work, so it never processes twice and is never lost.
  await runStaleRecovery(deps);

  const staleRecoveryTimer = setInterval(() => {
    void runStaleRecovery(deps);
  }, STALE_RECOVERY_INTERVAL_MS);

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("worker_shutting_down", { signal });
    clearInterval(staleRecoveryTimer);
    clearInterval(pollTimer);
    // Any in-flight attempt finishes naturally (we don't abort mid-publish);
    // the process exits once the current poll tick completes.
    setTimeout(() => process.exit(0), 250);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const pollTimer = setInterval(() => {
    void pollOnce(deps);
  }, POLL_INTERVAL_MS);

  log("worker_ready");
}
