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
import { classifyPollError, infrastructureErrorDetails } from "../src/core/domain/entities/infrastructure-error";
export { classifyPollError } from "../src/core/domain/entities/infrastructure-error";
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
import { engagementPayloadFingerprint } from "../src/core/application/use-cases/engagement/fingerprint";
import {
  awaitProviderConfirmation,
  completePublishingAttempt,
  failPublishingAttempt,
  startPublishingAttempt,
} from "../src/core/application/use-cases/publishing";
import { createConfirmationErrorGate, runProviderConfirmationPass } from "../src/core/application/use-cases/publishing/confirmation";
import type { PublishingAttempt, PublishingJob } from "../src/core/domain/entities/publishing";

const POLL_INTERVAL_MS = Number(process.env.PUBLISHING_WORKER_POLL_INTERVAL_MS ?? 2000);
const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/** No sleeping claims or retry queue: one finite probe deadline. */
export function createPublishingCircuit() {
  let retryAt = 0;
  let delay = 0;
  return {
    shouldAttempt: (now: number) => now >= retryAt,
    succeed: () => { retryAt = 0; delay = 0; },
    fail: (error: unknown, now: number) => {
      delay = classifyPollError(error) === "quota" ? 15 * 60_000 : nextBackoffMs(delay, 2000, 60_000);
      retryAt = now + delay;
      return delay;
    },
  };
}

/** Completion-driven scheduling: one outstanding cycle, zero queued cycles. */
export function createSingleFlightScheduler(cycle: () => Promise<void>, intervalMs: number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const delay = Number.isFinite(intervalMs) ? Math.max(1000, intervalMs) : 2000;
  const tick = async () => {
    try { await cycle(); }
    catch (error) { log("worker_cycle_error", { error: String(error) }); }
    finally { if (!stopped) timer = setTimeout(() => void tick(), delay); }
  };
  timer = setTimeout(() => void tick(), delay);
  return () => { stopped = true; clearTimeout(timer); };
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
        // This legacy cancellable-wait utility must not keep the process alive.
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
/** Additional bounded gate for provider confirmation checks. */
const confirmationErrorGate = createConfirmationErrorGate();

type FailedClaim = { job: PublishingJob; attempt: PublishingAttempt | null; category: ReturnType<typeof classifyPollError> };
class ClaimedFailure extends Error {
  constructor(readonly claim: FailedClaim) { super(claim.category); }
}

/** One bounded retry record; all failure state commits in one owned transaction. */
async function settleFailedClaim(deps: ReturnType<typeof buildDeps>, claim: FailedClaim) {
  await deps.publishing.settleFailedClaim(claim.job.id, WORKER_ID, {
    errorCode: claim.category === "quota" ? "infrastructure_blocked" : "infrastructure_transient",
    errorMessage: `Publishing stopped before submission (${claim.category}). Operator retry required.`,
  });
}

/** Bounded scalar receipt fields plus known structured diagnostics; no raw bodies. */
function receiptMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const bounded: Record<string, unknown> = {};
  let count = 0;
  for (const key in metadata) {
    if (!Object.hasOwn(metadata, key)) continue;
    if (++count > 32) break;
    if (key.length > 64 || /body|response|request|__proto__|constructor|prototype/i.test(key)) continue;
    const value = metadata[key];
    if (key === "confirmationError" || key === "infrastructureError") {
      bounded[key] = infrastructureErrorDetails(value);
    } else if (typeof value === "string") bounded[key] = value.slice(0, 256);
    else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) bounded[key] = value;
  }
  return bounded;
}

type ReceivedSettlement = {
  job: PublishingJob;
  attempt: PublishingAttempt;
  result: Parameters<typeof completePublishingAttempt>[3] | Parameters<typeof awaitProviderConfirmation>[3];
};
class SettlementFailure extends Error {
  constructor(readonly settlement: ReceivedSettlement, readonly failure: unknown) { super("Provider receipt settlement failed"); }
}
async function settleReceipt(deps: ReturnType<typeof buildDeps>, receipt: ReceivedSettlement) {
  if ("providerSubmissionId" in receipt.result) {
    await awaitProviderConfirmation(deps, receipt.job, receipt.attempt, receipt.result);
  } else {
    await completePublishingAttempt(deps, receipt.job, receipt.attempt, receipt.result);
  }
}

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

  let attempt: PublishingAttempt | null = null;
  let submissionMayHaveStarted = false;
  let terminalRecorded = false;
  let receipt: ReceivedSettlement | null = null;
  try {
    attempt = await startPublishingAttempt(deps, job);
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

    const publishedPayloadFingerprint = engagementPayloadFingerprint(draft.body, draft.hashtags ?? []);
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
      onBeforeSubmission: async () => {
        // Persist the non-retryable state BEFORE the network side effect. Even
        // a process crash or lost response cannot send this job through stale requeue.
        // A lost barrier response or an expired lease must not mutate a
        // recovered claim. If it did not commit, bounded recovery owns it.
        submissionMayHaveStarted = true;
        await deps.publishing.beginSubmission(job.id, attempt!.id, WORKER_ID);
      },
    });

    // Preserve the provider receipt even if the following database write fails.
    if (result.success === true || result.success === "pending") {
      log("provider_submission_result", {
        jobId: job.id,
        attemptId: attempt.id,
        postSubmissionId: result.success === true ? result.externalPostId : result.providerSubmissionId,
        outcome: result.success === true ? "published" : "pending",
      });
    }
    if (result.success === true || result.success === "pending") {
      const metadata = receiptMetadata(result.metadata);
      receipt = { job, attempt, result: result.success === true
        ? { externalPostId: result.externalPostId, externalUrl: result.externalUrl, providerMetadata: { ...metadata, postSubmissionId: typeof metadata.postSubmissionId === "string" && metadata.postSubmissionId ? metadata.postSubmissionId : result.externalPostId, publishedPayloadFingerprint } }
        : { providerSubmissionId: result.providerSubmissionId, providerMetadata: { ...metadata, postSubmissionId: result.providerSubmissionId, publishedPayloadFingerprint } } };
    }
    if (result.success === true) {
      await completePublishingAttempt(deps, job, attempt, {
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        providerMetadata: receipt!.result.providerMetadata,
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
        providerMetadata: receipt!.result.providerMetadata,
      });
      log("attempt_awaiting_confirmation", {
        jobId: job.id,
        attemptId: attempt.id,
        postSubmissionId: result.providerSubmissionId,
        durationMs: Date.now() - started,
      });
    } else {
      submissionMayHaveStarted = false; // Provider returned a definite failure.
      await failPublishingAttempt(deps, job, attempt, {
        errorCode: result.metadata?.infrastructureError
          ? (classifyPollError(result.metadata.infrastructureError) === "quota" ? "infrastructure_blocked" : "infrastructure_transient")
          : result.errorCode,
        errorMessage: result.errorMessage,
        providerMetadata: result.metadata ?? {},
      });
      terminalRecorded = true;
      log("attempt_failed", {
        jobId: job.id,
        attemptId: attempt.id,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        durationMs: Date.now() - started,
      });
    }
    receipt = null; // All settlement writes completed.
    // Provider failures returned as values must also open the circuit.
    const infrastructureError = result.metadata?.infrastructureError ?? result.metadata?.confirmationError;
    if (infrastructureError) throw infrastructureError;
    if (result.success === false && classifyPollError(result) !== "unknown") throw result;
  } catch (error) {
    if (receipt) throw new SettlementFailure(receipt, error);
    if (!submissionMayHaveStarted && !terminalRecorded) {
      throw new ClaimedFailure({ job, attempt, category: classifyPollError(error) });
    }
    // The durable awaiting_confirmation barrier excludes uncertain/accepted
    // submissions from both claim and stale recovery. Never mark these failed.
    throw error;
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

export const MAX_JOBS_PER_CYCLE = 1;

export function createPublishingPoller(deps: ReturnType<typeof buildDeps>, now = Date.now) {
  const circuit = createPublishingCircuit();
  let busy = false;
  let pending: FailedClaim | null = null;
  let received: ReceivedSettlement | null = null;
  let recoverAt = 0;
  return async () => {
    if (busy || shuttingDown || !circuit.shouldAttempt(now())) return;
    busy = true;
    try {
      // One retained receipt, no media/closures or further claims until saved.
      // Durable RPCs make replay after a committed-but-lost response safe.
      if (received) {
        await settleReceipt(deps, received);
        received = null;
        circuit.succeed();
        return;
      }
      if (pending) {
        await settleFailedClaim(deps, pending);
        pending = null;
        circuit.succeed();
        return;
      }
      // Exactly one claimed job per cycle; its media stays in processJob's
      // stack and is released before the scheduler can start another cycle.
      if (now() >= recoverAt) {
        await deps.publishing.recoverStaleJobs(300);
        recoverAt = now() + 60_000;
      }
      const job = await deps.publishing.claimNextJob(WORKER_ID, true);
      if (job) await processJob(job, deps);
      else await runConfirmationPass(deps);
      circuit.succeed();
    } catch (error) {
      let failure = error;
      if (error instanceof SettlementFailure) { received = error.settlement; failure = error.failure; }
      if (error instanceof ClaimedFailure) {
        pending = error.claim;
        failure = { infrastructureCategory: pending.category };
        try { await settleFailedClaim(deps, pending); pending = null; }
        catch (settlementError) { if (pending?.category !== "quota") failure = settlementError; }
      }
      if (pending?.category === "quota") failure = { infrastructureCategory: "quota" };
      const backoffMs = circuit.fail(failure, now());
      log("poll_error", { errorCategory: classifyPollError(failure), backoffMs });
    } finally {
      busy = false;
    }
  };
}

const pollers = new WeakMap<object, () => Promise<void>>();
export async function pollOnce(deps: ReturnType<typeof buildDeps>) {
  let poll = pollers.get(deps);
  if (!poll) { poll = createPublishingPoller(deps); pollers.set(deps, poll); }
  await poll();
}

/**
 * One background provider-confirmation check. Delegates entirely to the
 * shared runProviderConfirmationPass so this worker and the Vercel
 * API-route worker can never drift — the previous P0 was caused by exactly
 * that kind of divergence between these two paths.
 *
 * Infrastructure errors reach the shared circuit; pollOnce contains them.
 */
async function runConfirmationPass(deps: ReturnType<typeof buildDeps>) {
  // P0 follow-up: a broken confirmation subsystem must not hammer Supabase or
  // the logs on every 2s poll tick. This gate is checked BEFORE any work, so a
  // failing pass costs nothing until its backoff expires. Infrastructure
  // failures also reach the shared publishing circuit.
  if (!confirmationErrorGate.shouldAttempt(Date.now())) return;

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
    confirmationErrorGate.recordSuccess();
    if (outcome.status !== "idle") {
      log("provider_confirmation", { ...outcome });
    }
  } catch (error) {
    const { backoffMs, isFirstOfStreak } = confirmationErrorGate.recordFailure(Date.now());
    // Log once per failure streak, not once per tick — the previous behaviour
    // emitted an identical line every ~2 seconds indefinitely.
    if (isFirstOfStreak) {
      log("provider_confirmation_error", {
        error: error instanceof Error ? error.message : String(error),
        backoffMs,
      });
    }
    throw error;
  }
}

/** Entry point shared by both the local and cloud worker scripts. Assumes the caller has already loaded whichever env file is appropriate. */
export async function runWorker(): Promise<void> {
  log("worker_starting", { pollIntervalMs: POLL_INTERVAL_MS, maxJobsPerCycle: MAX_JOBS_PER_CYCLE });

  const client = createAdminClient();
  const deps = buildDeps(client);

  // Startup and periodic recovery share the single-flight cycle and circuit.
  const stop = createSingleFlightScheduler(() => pollOnce(deps), POLL_INTERVAL_MS);

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("worker_shutting_down", { signal });
    stop();
    // Do not exit mid-submission. In-flight work drains naturally.
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log("worker_ready");
}
