import { randomUUID } from "crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import { canWriteContent } from "@/core/domain/entities/identity";
import {
  DEFAULT_MAX_PUBLISHING_RETRIES,
  PUBLISHING_PLATFORM_LABELS,
  type PublishingAnalytics,
  type PublishingAttempt,
  type PublishingExecutionMode,
  type PublishingJob,
  type PublishingPlatform,
} from "@/core/domain/entities/publishing";
import { toBlotatoPlatform } from "@/core/domain/entities/blotato";
import type { PublishingRepository, PublishingQueueFilters } from "@/core/application/ports/publishing-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { AuditRepository } from "@/core/application/ports/audit-port";
import type { NotificationRepository } from "@/core/application/ports/notification-port";
import { computePublishingAnalytics } from "./analytics";

interface PublishingDeps {
  actor: Actor;
  publishing: PublishingRepository;
  blotatoAccounts: BlotatoAccountRepository;
  content: ContentRepository;
  organisations: OrganisationRepository;
  audits: AuditRepository;
  notifications: NotificationRepository;
}

async function requireRole(
  deps: PublishingDeps,
  organisationId: string,
  check: (actor: Actor, role: OrganisationRole | null) => boolean,
): Promise<void> {
  if (deps.actor.isPlatformAdmin) return;
  const role = await deps.organisations.viewerRole(organisationId);
  if (!check(deps.actor, role)) {
    throw new ForbiddenError("You do not have permission to do that in the Publishing Queue.");
  }
}

async function requireMember(deps: PublishingDeps, organisationId: string): Promise<void> {
  if (deps.actor.isPlatformAdmin) return;
  const role = await deps.organisations.viewerRole(organisationId);
  if (!role) throw new ForbiddenError("You do not have access to this account's Publishing Queue.");
}

const PUBLISHABLE_STATUSES = ["approved", "scheduled", "failed"] as const;

/**
 * Resolves the destination Blotato account ID for the given org+platform and
 * returns its ID — this becomes the destination lock stored on the job row.
 *
 * When an explicit account ID is provided (from the channel selector UI):
 *   - validates it is in the active pool for this org+platform (active + providerActive)
 *   - returns it; allows disambiguation when 2+ accounts exist on the same platform
 *
 * Without an explicit ID (backward compat / single-account orgs):
 *   0 accounts → ValidationError (no account to publish through)
 *   2+ accounts → ValidationError (ambiguous; select a specific account in the UI)
 *   1 account  → returns that account's Blotato ID
 */
async function resolveAndLockAccountId(
  deps: Pick<PublishingDeps, "blotatoAccounts">,
  organisationId: string,
  platform: PublishingPlatform,
  explicitAccountId?: string | null,
): Promise<string> {
  const blotatoPlatform = toBlotatoPlatform(platform);
  const active = await deps.blotatoAccounts.findActiveForOrganisationAndPlatform(blotatoPlatform, organisationId);

  if (active.length === 0) {
    throw new ValidationError(
      `No active ${PUBLISHING_PLATFORM_LABELS[platform]} account is connected for this organisation. ` +
        `Assign one from Connected Channels in Organisation Settings before publishing.`,
    );
  }

  if (explicitAccountId) {
    const matched = active.find((a) => a.id === explicitAccountId);
    if (!matched) {
      throw new ValidationError(
        `The selected ${PUBLISHING_PLATFORM_LABELS[platform]} account is no longer available for this organisation. ` +
          `Refresh the page and choose a destination before publishing.`,
      );
    }
    return matched.id;
  }

  if (active.length > 1) {
    throw new ValidationError(
      `Multiple ${PUBLISHING_PLATFORM_LABELS[platform]} accounts are connected for this organisation. ` +
        `Select a specific account before publishing.`,
    );
  }
  return active[0]!.id;
}

/** Immediate publish — "Publish Now". Queues a due-now job; the worker (never the operator) drives it to Published/Failed. */
export async function createImmediatePublishingJob(
  deps: PublishingDeps,
  input: {
    organisationId: string;
    draftId: string;
    platform: PublishingPlatform;
    idempotencyKey: string;
    devSimulationMode?: "always_succeed" | "fail_next_attempt" | "always_fail" | null;
    /** Destination lock from the channel selector UI. When provided, validates against the active pool
     *  and uses this exact account. When absent, auto-resolves if exactly one account is connected. */
    resolvedAccountId?: string | null;
    /**
     * P0 fix: the exact Mode Pre-Publish Review showed and the operator
     * confirmed — required, never optional or defaulted here. Every caller
     * must supply it explicitly (compile-time enforced) so a job can never
     * be created without a persisted, operator-reviewed execution mode.
     */
    executionMode: PublishingExecutionMode;
    /** Operator's per-post AI-generated-content declaration (see PublishingJob.isAiGenerated). Persisted verbatim; enforcement is the preflight's job, not this function's. */
    isAiGenerated?: boolean | null;
    /** Operator's per-post commercial-content declarations (see PublishingJob.isYourBrand/isBrandedContent). Persisted verbatim; enforcement is the preflight's job, not this function's. */
    isYourBrand?: boolean | null;
    isBrandedContent?: boolean | null;
  },
): Promise<PublishingJob> {
  await requireRole(deps, input.organisationId, canWriteContent);

  const draft = await deps.content.findDraft(input.organisationId, input.draftId);
  if (!draft) throw new NotFoundError("Draft");

  // Checked before the status guard, deliberately: a double-click or action
  // retry arrives after the first call has already moved the draft to
  // "publishing" (no longer in PUBLISHABLE_STATUSES) — without this early
  // return, the replay would throw a confusing ValidationError instead of
  // idempotently returning the job the first call already created.
  const existingActive = await deps.publishing.findActiveJobForDraftPlatform(input.draftId, input.platform);
  if (existingActive) return existingActive;

  if (!PUBLISHABLE_STATUSES.includes(draft.status as (typeof PUBLISHABLE_STATUSES)[number])) {
    throw new ValidationError("Only approved, scheduled, or failed content can be published.");
  }

  const resolvedAccountId = await resolveAndLockAccountId(deps, input.organisationId, input.platform, input.resolvedAccountId);

  const job = await deps.publishing.createJob({
    organisationId: input.organisationId,
    draftId: input.draftId,
    platform: input.platform,
    triggerType: "immediate",
    scheduledFor: new Date().toISOString(),
    idempotencyKey: input.idempotencyKey,
    requestedBy: deps.actor.id,
    maxRetries: DEFAULT_MAX_PUBLISHING_RETRIES,
    devSimulationMode: input.devSimulationMode ?? null,
    resolvedAccountId,
    executionMode: input.executionMode,
    isAiGenerated: input.isAiGenerated ?? null,
    isYourBrand: input.isYourBrand ?? null,
    isBrandedContent: input.isBrandedContent ?? null,
  });

  if (draft.status !== "publishing") {
    await deps.content.updateStatus(input.organisationId, input.draftId, "publishing", deps.actor.id);
  }

  await deps.audits.recordEvent({
    organisationId: input.organisationId,
    draftId: input.draftId,
    actorId: deps.actor.id,
    eventType: "publishing_job_queued",
    description: `Queued an immediate publish to ${PUBLISHING_PLATFORM_LABELS[input.platform]}.`,
    metadata: { jobId: job.id, platform: input.platform, triggerType: "immediate" },
  });

  return job;
}

/** Scheduled publish. Draft-level scheduledAt/platform/timezone are kept in sync too, since Content Studio and the Calendar already read those fields directly. */
export async function createScheduledPublishingJob(
  deps: PublishingDeps,
  input: {
    organisationId: string;
    draftId: string;
    platform: PublishingPlatform;
    scheduledFor: string;
    timezone: string;
    idempotencyKey: string;
    devSimulationMode?: "always_succeed" | "fail_next_attempt" | "always_fail" | null;
    /** Destination lock from the channel selector UI. When provided, validates against the active pool
     *  and uses this exact account. When absent, auto-resolves if exactly one account is connected. */
    resolvedAccountId?: string | null;
    /** P0 fix: see the identical field on createImmediatePublishingJob's input — required, never defaulted. */
    executionMode: PublishingExecutionMode;
    /** Operator's per-post AI-generated-content declaration (see PublishingJob.isAiGenerated). Persisted verbatim; enforcement is the preflight's job, not this function's. */
    isAiGenerated?: boolean | null;
    /** Operator's per-post commercial-content declarations (see PublishingJob.isYourBrand/isBrandedContent). Persisted verbatim; enforcement is the preflight's job, not this function's. */
    isYourBrand?: boolean | null;
    isBrandedContent?: boolean | null;
  },
): Promise<PublishingJob> {
  await requireRole(deps, input.organisationId, canWriteContent);

  const scheduledForDate = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledForDate.getTime())) {
    throw new ValidationError("That scheduled date and time could not be understood.");
  }
  if (scheduledForDate.getTime() <= Date.now()) {
    throw new ValidationError("Scheduled publish time must be in the future.");
  }

  const draft = await deps.content.findDraft(input.organisationId, input.draftId);
  if (!draft) throw new NotFoundError("Draft");

  // See the identical comment in createImmediatePublishingJob — checked
  // before the status guard so a double-click/replay idempotently returns
  // the already-created job instead of erroring on a status the first call
  // already advanced past.
  const existingActive = await deps.publishing.findActiveJobForDraftPlatform(input.draftId, input.platform);
  if (existingActive) return existingActive;

  if (!PUBLISHABLE_STATUSES.includes(draft.status as (typeof PUBLISHABLE_STATUSES)[number])) {
    throw new ValidationError("Only approved, scheduled, or failed content can be scheduled for publishing.");
  }

  const resolvedAccountId = await resolveAndLockAccountId(deps, input.organisationId, input.platform, input.resolvedAccountId);

  const job = await deps.publishing.createJob({
    organisationId: input.organisationId,
    draftId: input.draftId,
    platform: input.platform,
    triggerType: "scheduled",
    scheduledFor: scheduledForDate.toISOString(),
    idempotencyKey: input.idempotencyKey,
    requestedBy: deps.actor.id,
    maxRetries: DEFAULT_MAX_PUBLISHING_RETRIES,
    devSimulationMode: input.devSimulationMode ?? null,
    resolvedAccountId,
    executionMode: input.executionMode,
    isAiGenerated: input.isAiGenerated ?? null,
    isYourBrand: input.isYourBrand ?? null,
    isBrandedContent: input.isBrandedContent ?? null,
  });

  await deps.content.scheduleDraft(input.organisationId, input.draftId, {
    scheduledAt: scheduledForDate.toISOString(),
    platform: input.platform,
    timezone: input.timezone,
    updatedBy: deps.actor.id,
  });

  await deps.audits.recordEvent({
    organisationId: input.organisationId,
    draftId: input.draftId,
    actorId: deps.actor.id,
    eventType: "publishing_job_queued",
    description: `Scheduled a publish to ${PUBLISHING_PLATFORM_LABELS[input.platform]} for ${scheduledForDate.toISOString()}.`,
    metadata: { jobId: job.id, platform: input.platform, triggerType: "scheduled", scheduledFor: scheduledForDate.toISOString() },
  });

  return job;
}

/** Worker-only. `deps` here is expected to be backed by the service-role client — see scripts/publishing-worker.ts. */
export async function claimNextPublishingJob(
  deps: Pick<PublishingDeps, "publishing">,
  workerId: string,
): Promise<PublishingJob | null> {
  return deps.publishing.claimNextJob(workerId);
}

/** Worker-only. Creates the next attempt row (append-only) and flips the draft to "publishing" the moment real work starts. */
export async function startPublishingAttempt(
  deps: Pick<PublishingDeps, "publishing" | "content">,
  job: PublishingJob,
): Promise<PublishingAttempt> {
  const existingAttempts = await deps.publishing.listAttemptsForJob(job.organisationId, job.id);
  const attemptNumber = existingAttempts.length + 1;
  const previousAttempt = existingAttempts[existingAttempts.length - 1] ?? null;

  const attempt = await deps.publishing.createAttempt({
    jobId: job.id,
    organisationId: job.organisationId,
    draftId: job.draftId,
    platform: job.platform,
    attemptNumber,
    retryOfAttemptId: previousAttempt?.id ?? null,
  });

  await deps.content.updateStatus(job.organisationId, job.draftId, "publishing", job.requestedBy || "");

  return deps.publishing.startAttempt(attempt.id);
}

/** Worker-only. Records success and drives the draft the rest of the way to Published — the operator never does this manually. */
export async function completePublishingAttempt(
  deps: Pick<PublishingDeps, "publishing" | "content" | "audits" | "notifications">,
  job: PublishingJob,
  attempt: PublishingAttempt,
  result: { externalPostId: string; externalUrl: string; providerMetadata: Record<string, unknown> },
): Promise<void> {
  await deps.publishing.completeAttempt(attempt.id, result);
  await deps.publishing.markJobPublished(job.id);
  await deps.content.updateStatus(job.organisationId, job.draftId, "published", job.requestedBy || "");

  await deps.audits.recordEvent({
    organisationId: job.organisationId,
    draftId: job.draftId,
    actorId: null,
    eventType: "publishing_attempt_completed",
    description: `Published to ${PUBLISHING_PLATFORM_LABELS[job.platform]}.`,
    metadata: { jobId: job.id, attemptId: attempt.id, externalUrl: result.externalUrl },
  });

  if (job.requestedBy) {
    // Notification delivery is best-effort — a failure here must never roll back the publish that already succeeded.
    try {
      await deps.notifications.createNotification({
        organisationId: job.organisationId,
        profileId: job.requestedBy,
        type: "publish_succeeded",
        message: `Your ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish succeeded. ${result.externalUrl}`,
      });
    } catch {
      // Logged by the worker's own structured logging around this call; swallow here by design.
    }
  }
}

/** Worker-only. Records failure as a terminal, immutable attempt — no automatic retry. An operator must explicitly retry. */
export async function failPublishingAttempt(
  deps: Pick<PublishingDeps, "publishing" | "content" | "audits" | "notifications">,
  job: PublishingJob,
  attempt: PublishingAttempt,
  failure: { errorCode: string; errorMessage: string; providerMetadata: Record<string, unknown> },
): Promise<void> {
  await deps.publishing.failAttempt(attempt.id, failure);
  await deps.publishing.markJobFailed(job.id);
  await deps.content.updateStatus(job.organisationId, job.draftId, "failed", job.requestedBy || "");

  await deps.audits.recordEvent({
    organisationId: job.organisationId,
    draftId: job.draftId,
    actorId: null,
    eventType: "publishing_attempt_failed",
    description: `Publish to ${PUBLISHING_PLATFORM_LABELS[job.platform]} failed: ${failure.errorMessage}`,
    metadata: { jobId: job.id, attemptId: attempt.id, errorCode: failure.errorCode },
  });

  if (job.requestedBy) {
    try {
      await deps.notifications.createNotification({
        organisationId: job.organisationId,
        profileId: job.requestedBy,
        type: "publish_failed",
        message: `Your ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish failed: ${failure.errorMessage}`,
      });
    } catch {
      // Best-effort, see completePublishingAttempt's identical rationale.
    }
  }
}

export async function retryFailedPublishingJob(
  deps: PublishingDeps,
  organisationId: string,
  jobId: string,
): Promise<PublishingJob> {
  await requireRole(deps, organisationId, canWriteContent);

  const job = await deps.publishing.findJobById(organisationId, jobId);
  if (!job) throw new NotFoundError("Publishing job");
  if (job.status !== "failed") {
    throw new ValidationError("Only a failed publishing job can be retried.");
  }
  if (job.retryCount >= job.maxRetries) {
    throw new ValidationError(`This job has reached its retry limit (${job.maxRetries}).`);
  }

  const retried = await deps.publishing.requeueJobForRetry(organisationId, jobId);

  await deps.audits.recordEvent({
    organisationId,
    draftId: job.draftId,
    actorId: deps.actor.id,
    eventType: "publishing_job_retry_requested",
    description: `Requested a retry of the ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish (attempt ${job.retryCount + 2}).`,
    metadata: { jobId, platform: job.platform },
  });

  return retried;
}

/**
 * Reconciles a job whose last attempt ended in `blotato_status_timeout` —
 * BlotatoPublisherBase.pollForFinalStatus() exhausted its attempts without
 * observing a terminal status, so the attempt was recorded as failed even
 * though Blotato may still have been processing the submission. Root-caused
 * in the P0 incident where an Instagram post published successfully at
 * Blotato but Genesis had already marked the job/draft "failed" — the post
 * was real; only the local status was stale.
 *
 * Safety invariants:
 *   - Never calls blotatoClient.publishPost — only GET /posts/{id} via
 *     getPostStatus, using the postSubmissionId already recorded on the
 *     timed-out attempt. No new content is ever submitted to the provider.
 *   - Only operates on a job whose CURRENT status is "failed" and whose most
 *     recent attempt's errorCode is exactly "blotato_status_timeout" — a job
 *     that failed for any other reason (no connected account, media
 *     resolution, preflight, or a confirmed blotato_publish_failed) has
 *     nothing to reconcile and is rejected.
 *   - Idempotent: once reconciled to "published", the job's status is no
 *     longer "failed", so a second call is rejected by the same guard —
 *     there is no path that republishes or double-completes.
 *   - Never mutates the timed-out attempt row directly — `completeAttempt`/
 *     `failAttempt` are enforced immutable once an attempt is terminal (see
 *     20260801140000_publishing_engine.sql's trigger). A confirmed "published"
 *     outcome is recorded as a NEW attempt (retryOfAttemptId pointing at the
 *     timed-out one), keeping the append-only history honest: attempt N says
 *     "the provider's status was still unknown when we gave up", attempt N+1
 *     says "the provider confirms it was already published — no new
 *     submission was made for this one".
 */
export async function reconcileBlotatoStatusTimeout(
  deps: PublishingDeps & { blotatoClient: Pick<BlotatoClient, "getPostStatus"> },
  organisationId: string,
  jobId: string,
): Promise<{ outcome: "published" | "confirmed_failed" | "still_processing"; job: PublishingJob }> {
  await requireRole(deps, organisationId, canWriteContent);

  const job = await deps.publishing.findJobById(organisationId, jobId);
  if (!job) throw new NotFoundError("Publishing job");
  if (job.status !== "failed") {
    throw new ValidationError("Only a failed publishing job can be reconciled with the provider.");
  }
  // P0 defense in depth: a "blotato_status_timeout" error is structurally
  // only reachable via the live provider path (simulatePublish never sets
  // an error code or a postSubmissionId), so this should be unreachable —
  // but the incident this fix responds to was exactly a case of trusting
  // that a scenario was "structurally impossible" without an explicit
  // guard. A simulation job can never have anything real to reconcile.
  if (job.executionMode !== "live") {
    throw new ValidationError("This job was simulated — there is no real provider submission to reconcile.");
  }

  const attempts = await deps.publishing.listAttemptsForJob(organisationId, jobId);
  const lastAttempt = attempts[attempts.length - 1];
  if (!lastAttempt || lastAttempt.errorCode !== "blotato_status_timeout") {
    throw new ValidationError(
      "This job's last attempt did not time out waiting for the provider's status — there is nothing to reconcile. Use retry instead.",
    );
  }

  const postSubmissionId = lastAttempt.providerMetadata?.postSubmissionId as string | undefined;
  if (!postSubmissionId) {
    throw new ValidationError(
      "No provider submission id was recorded for this attempt — the status cannot be safely checked without resubmitting, which reconciliation will never do.",
    );
  }

  const status = await deps.blotatoClient.getPostStatus(postSubmissionId);

  if (status.status === "published") {
    const reconciliationAttempt = await deps.publishing.createAttempt({
      jobId,
      organisationId,
      draftId: job.draftId,
      platform: job.platform,
      attemptNumber: lastAttempt.attemptNumber + 1,
      retryOfAttemptId: lastAttempt.id,
    });
    await deps.publishing.startAttempt(reconciliationAttempt.id);
    await deps.publishing.completeAttempt(reconciliationAttempt.id, {
      externalPostId: status.postSubmissionId,
      externalUrl: status.publicUrl ?? "https://my.blotato.com",
      providerMetadata: { ...lastAttempt.providerMetadata, reconciledFromAttemptId: lastAttempt.id },
    });
    const publishedJob = await deps.publishing.markJobPublished(jobId);
    await deps.content.updateStatus(organisationId, job.draftId, "published", job.requestedBy || "");

    await deps.audits.recordEvent({
      organisationId,
      draftId: job.draftId,
      actorId: deps.actor.id,
      eventType: "publishing_attempt_reconciled",
      description: `Reconciled a delayed ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish as published — the provider had already published it; no new post was submitted.`,
      metadata: { jobId, attemptId: reconciliationAttempt.id, retryOfAttemptId: lastAttempt.id, postSubmissionId, outcome: "published" },
    });

    if (job.requestedBy) {
      try {
        await deps.notifications.createNotification({
          organisationId,
          profileId: job.requestedBy,
          type: "publish_succeeded",
          message: `Your ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish succeeded (confirmed after a delayed provider status). ${status.publicUrl ?? ""}`.trim(),
        });
      } catch {
        // Best-effort, matching completePublishingAttempt's identical rationale.
      }
    }

    return { outcome: "published", job: publishedJob };
  }

  if (status.status === "failed") {
    await deps.audits.recordEvent({
      organisationId,
      draftId: job.draftId,
      actorId: deps.actor.id,
      eventType: "publishing_attempt_reconciled",
      description: `Confirmed with the provider that the delayed ${PUBLISHING_PLATFORM_LABELS[job.platform]} publish genuinely failed: ${status.errorMessage ?? "no further detail"}.`,
      metadata: { jobId, attemptId: lastAttempt.id, postSubmissionId, outcome: "confirmed_failed" },
    });
    return { outcome: "confirmed_failed", job };
  }

  // Still "in-progress" or "scheduled" at the provider — genuinely unresolved.
  // No DB write: the job stays exactly as it is (failed/blotato_status_timeout)
  // until a later reconciliation call observes a terminal status.
  return { outcome: "still_processing", job };
}

export async function cancelPublishingJob(
  deps: PublishingDeps,
  organisationId: string,
  jobId: string,
): Promise<PublishingJob> {
  await requireRole(deps, organisationId, canWriteContent);

  const job = await deps.publishing.findJobById(organisationId, jobId);
  if (!job) throw new NotFoundError("Publishing job");
  if (job.status !== "queued") {
    throw new ValidationError("Only a still-queued publishing job can be cancelled.");
  }

  const cancelled = await deps.publishing.cancelJob(organisationId, jobId);

  const draft = await deps.content.findDraft(organisationId, job.draftId);
  if (draft && (draft.status === "publishing" || draft.status === "scheduled")) {
    await deps.content.updateStatus(organisationId, job.draftId, "approved", deps.actor.id);
  }

  await deps.audits.recordEvent({
    organisationId,
    draftId: job.draftId,
    actorId: deps.actor.id,
    eventType: "publishing_job_cancelled",
    description: `Cancelled the ${job.triggerType} publish to ${PUBLISHING_PLATFORM_LABELS[job.platform]}.`,
    metadata: { jobId, platform: job.platform },
  });

  return cancelled;
}

/** Worker-only, called once at startup and then on a fixed interval — see scripts/publishing-worker.ts. */
export async function recoverStalePublishingJobs(
  deps: Pick<PublishingDeps, "publishing">,
  staleAfterSeconds: number,
): Promise<PublishingJob[]> {
  return deps.publishing.recoverStaleJobs(staleAfterSeconds);
}

export async function getPublishingJob(
  deps: PublishingDeps,
  organisationId: string,
  jobId: string,
): Promise<PublishingJob> {
  await requireMember(deps, organisationId);
  const job = await deps.publishing.findJobById(organisationId, jobId);
  if (!job) throw new NotFoundError("Publishing job");
  return job;
}

export async function listPublishingQueue(
  deps: PublishingDeps,
  filters: PublishingQueueFilters,
): Promise<PublishingJob[]> {
  if (filters.organisationId) await requireMember(deps, filters.organisationId);
  return deps.publishing.listJobs(filters);
}

export async function getPublishingAttempts(
  deps: PublishingDeps,
  organisationId: string,
  jobId: string,
): Promise<PublishingAttempt[]> {
  await requireMember(deps, organisationId);
  return deps.publishing.listAttemptsForJob(organisationId, jobId);
}

export async function getPublishingAnalytics(
  deps: PublishingDeps,
  organisationId: string,
  input: { dateFrom?: string; dateTo?: string } = {},
): Promise<PublishingAnalytics> {
  await requireMember(deps, organisationId);
  const [jobs, attempts] = await Promise.all([
    deps.publishing.listJobsForAnalytics(organisationId, input),
    deps.publishing.listAttemptsForAnalytics(organisationId, input),
  ]);
  return computePublishingAnalytics(jobs, attempts, new Date());
}

/**
 * Cross-organisation rollup for the Dashboard, mirroring
 * ContentRepository.listDraftsForActor's own reliance on RLS alone (no
 * organisationId filter) rather than a per-org permission check — the
 * Dashboard already shows every account the actor can see at once.
 */
export async function getPublishingAnalyticsForActor(
  deps: Pick<PublishingDeps, "publishing">,
  input: { dateFrom?: string; dateTo?: string } = {},
): Promise<PublishingAnalytics> {
  const [jobs, attempts] = await Promise.all([
    deps.publishing.listJobsForAnalytics(undefined, input),
    deps.publishing.listAttemptsForAnalytics(undefined, input),
  ]);
  return computePublishingAnalytics(jobs, attempts, new Date());
}

/** Convenience for callers (server actions) that don't want to mint their own idempotency key for a one-off action. */
export function generateIdempotencyKey(): string {
  return randomUUID();
}
