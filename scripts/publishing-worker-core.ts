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
import { evaluatePlatformPreflight } from "../src/core/domain/entities/publishing-preflight";
import { redactMediaUrl } from "../src/core/domain/entities/publishing-media";
import { resolveEffectiveLivePublishing } from "../src/core/domain/entities/publishing";
import { composePublishedText } from "../src/core/application/use-cases/content/hashtags";
import {
  awaitProviderConfirmation,
  claimNextPublishingJob,
  completePublishingAttempt,
  failPublishingAttempt,
  recoverStalePublishingJobs,
  startPublishingAttempt,
} from "../src/core/application/use-cases/publishing";
import { runProviderConfirmationPass } from "../src/core/application/use-cases/publishing/confirmation";
import type { PublishingJob } from "../src/core/domain/entities/publishing";

const POLL_INTERVAL_MS = Number(process.env.PUBLISHING_WORKER_POLL_INTERVAL_MS ?? 2000);
const STALE_RECOVERY_INTERVAL_MS = Number(process.env.PUBLISHING_WORKER_STALE_RECOVERY_INTERVAL_MS ?? 60_000);
const STALE_AFTER_SECONDS = Number(process.env.PUBLISHING_WORKER_STALE_AFTER_SECONDS ?? 300);
const POLL_BACKOFF_BASE_MS = Number(process.env.PUBLISHING_WORKER_BACKOFF_BASE_MS ?? 1000);
const POLL_BACKOFF_MAX_MS = Number(process.env.PUBLISHING_WORKER_BACKOFF_MAX_MS ?? 30_000);
const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Sprint 7.1 resilience fix: a transient infrastructure error (observed in
 * the cloud pilot as `TypeError: fetch failed`) thrown by claimNextPublishingJob
 * previously propagated straight out of pollOnce's for(;;) loop. pollOnce is
 * invoked as `void pollOnce(deps)` inside setInterval (runWorker, below), so
 * that unhandled rejection terminated the entire worker process — Node
 * treats an unhandled promise rejection as fatal by default. Only
 * processJob (an already-claimed job failing to publish) was ever caught;
 * the claim call itself was not.
 *
 * classifyPollError/nextBackoffMs/createBackoffController are pure and
 * exported specifically so this behavior is unit-testable without a real
 * Supabase connection or real timers (see
 * tests/publishing-worker-resilience.test.ts).
 */
export function classifyPollError(error: unknown): "network" | "unknown" {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up/i.test(message) ? "network" : "unknown";
}

/** Exponential backoff, doubling from a base and capped at a max — the same shape as any standard bounded-retry policy, deliberately nothing fancier. */
export function nextBackoffMs(currentMs: number, baseMs: number, maxMs: number): number {
  return currentMs <= 0 ? baseMs : Math.min(currentMs * 2, maxMs);
}

export interface BackoffController {
  /** Resolves after `ms`, or immediately if cancel() is called first — so a worker backing off never delays graceful shutdown. */
  wait(ms: number): Promise<void>;
  cancel(): void;
}

export function createBackoffController(): BackoffController {
  let pendingResolve: (() => void) | null = null;
  return {
    wait(ms: number): Promise<void> {
      if (ms <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        pendingResolve = resolve;
        const timer = setTimeout(() => {
          pendingResolve = null;
          resolve();
        }, ms);
        // Never keep the process alive on this timer alone — the poll/stale-recovery
        // intervals already do that; this just must not block a clean exit.
        if (typeof timer.unref === "function") timer.unref();
      });
    },
    cancel(): void {
      if (pendingResolve) {
        pendingResolve();
        pendingResolve = null;
      }
    },
  };
}

/** Exported so both entrypoint wrappers (local and cloud) can log a fatal startup error in the same shape as everything else this worker logs. */
export function log(event: string, fields: Record<string, unknown> = {}) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), workerId: WORKER_ID, event, ...fields }));
}

let shuttingDown = false;
let currentBackoffMs = 0;
const pollBackoff = createBackoffController();

async function processJob(job: PublishingJob, deps: ReturnType<typeof buildDeps>) {
  const started = Date.now();
  log("job_claimed", { jobId: job.id, draftId: job.draftId, platform: job.platform, triggerType: job.triggerType, executionMode: job.executionMode });

  // P0 fix: the ONLY authority for whether this publish may reach the real
  // provider is the operator-reviewed value persisted on the job
  // (job.executionMode) combined with this process's own global kill
  // switch — never this worker's own environment alone. This closes the
  // incident where this exact worker process (Render), with its own
  // BLOTATO_LIVE_PUBLISHING_ENABLED=true, silently executed a job the
  // operator had reviewed and confirmed as Simulation on Vercel.
  const effectiveLive = resolveEffectiveLivePublishing(job.executionMode, deps.blotatoLivePublishingEnabled);

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

  // Fail-closed: when live publishing is enabled, mandatory platform
  // requirements must be met at execution time — not just at job creation.
  // Media may have been removed from the draft after the job was queued
  // (e.g. operator retries a job that was previously valid). Simulation
  // always proceeds regardless, so this guard is invisible in UAT.
  if (effectiveLive) {
    const preflight = evaluatePlatformPreflight(job.platform, draft.body, media.mediaUrls.length, draft.hashtags ?? [], job.isAiGenerated, {
      isYourBrand: job.isYourBrand,
      isBrandedContent: job.isBrandedContent,
    });
    if (!preflight.ready) {
      const errorMessage = `Platform preflight failed: ${preflight.blockers.join(" ")}`;
      await failPublishingAttempt(deps, job, attempt, {
        errorCode: "preflight_failed",
        errorMessage,
        providerMetadata: { blockers: preflight.blockers },
      });
      log("attempt_failed", {
        jobId: job.id,
        attemptId: attempt.id,
        errorCode: "preflight_failed",
        blockers: preflight.blockers,
      });
      return;
    }
  }

  const publisher = resolvePublisher(job.platform, {
    blotatoAccounts: deps.blotatoAccounts,
    blotatoClient: deps.blotatoClient,
    livePublishingEnabled: effectiveLive,
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
    body: composePublishedText(draft.body, draft.hashtags ?? []),
    assetUrls: media.mediaUrls,
    devSimulationMode: effectiveMode,
    resolvedAccountId: job.resolvedAccountId,
    isAiGenerated: job.isAiGenerated,
    isYourBrand: job.isYourBrand,
    isBrandedContent: job.isBrandedContent,
  });

  if (result.success === true) {
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
  } else if (result.success === "pending") {
    // P0 fix: the provider accepted the submission but has not resolved it.
    // NOT a failure — awaitProviderConfirmation moves the job and attempt to
    // the non-terminal awaiting_confirmation state, leaves the draft alone,
    // and schedules a background re-check of THIS submission id.
    await awaitProviderConfirmation(deps, job, attempt, {
      providerSubmissionId: result.providerSubmissionId,
      providerMetadata: result.metadata ?? {},
    });
    log("attempt_awaiting_confirmation", {
      jobId: job.id,
      attemptId: attempt.id,
      postSubmissionId: result.providerSubmissionId,
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

export async function pollOnce(deps: ReturnType<typeof buildDeps>) {
  for (;;) {
    if (shuttingDown) return;

    let job: PublishingJob | null;
    try {
      job = await claimNextPublishingJob(deps, WORKER_ID);
    } catch (error) {
      // The claim call itself failing (e.g. a transient Supabase
      // `TypeError: fetch failed`) is an infrastructure error, not a job
      // failure — there is no job to blame it on. Catching it here (rather
      // than letting it propagate out of this loop) is what keeps the
      // worker alive: pollOnce runs as `void pollOnce(deps)` under
      // setInterval, and an unhandled rejection there previously killed
      // the whole process. Back off with growing delay rather than
      // hammering a struggling database, but keep polling — never exit.
      currentBackoffMs = nextBackoffMs(currentBackoffMs, POLL_BACKOFF_BASE_MS, POLL_BACKOFF_MAX_MS);
      log("poll_error", {
        errorCategory: classifyPollError(error),
        error: error instanceof Error ? error.message : String(error),
        backoffMs: currentBackoffMs,
      });
      await pollBackoff.wait(currentBackoffMs);
      continue;
    }

    // A successful poll — whether or not it found a due job — proves the
    // database is reachable again, so any accumulated backoff resets.
    currentBackoffMs = 0;

    if (!job) {
      // P0 fix: no new work to publish, so spend this tick confirming an
      // outstanding provider submission instead. Runs the SAME shared pass
      // the Vercel API-route worker runs (runProviderConfirmationPass),
      // which is structurally incapable of publishing or uploading.
      await runConfirmationPass(deps);
      return;
    }
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

/**
 * One background provider-confirmation check. Delegates entirely to the
 * shared runProviderConfirmationPass so this worker and the Vercel
 * API-route worker can never drift — the previous P0 was caused by exactly
 * that kind of divergence between these two paths.
 *
 * Never throws: a confirmation problem must not kill the poll loop.
 */
async function runConfirmationPass(deps: ReturnType<typeof buildDeps>) {
  try {
    const outcome = await runProviderConfirmationPass(
      {
        publishing: deps.publishing,
        content: deps.content,
        audits: deps.audits,
        notifications: deps.notifications,
        blotatoClient: deps.blotatoClient,
      },
      { workerId: WORKER_ID },
    );
    if (outcome.status !== "idle") {
      log("provider_confirmation", { ...outcome });
    }
  } catch (error) {
    log("provider_confirmation_error", { error: error instanceof Error ? error.message : String(error) });
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
    // A pollOnce loop currently backing off after a poll_error would
    // otherwise wait out the full backoff (up to POLL_BACKOFF_MAX_MS)
    // before ever re-checking `shuttingDown` — cancelling it here is what
    // makes shutdown interrupt that wait immediately instead.
    pollBackoff.cancel();
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
