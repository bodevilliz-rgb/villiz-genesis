/**
 * Sprint 6A — Publishing Engine domain model.
 *
 * A PublishingJob is the durable intent to publish one draft to one platform
 * once. A PublishingAttempt is one immutable historical record of the
 * publishing engine actually trying to do that — a retry creates a NEW
 * attempt row, it never overwrites the previous one, so attempt history is
 * append-only and the full timeline (Attempt 1: failed, Attempt 2:
 * completed) can always be reconstructed from persisted rows alone.
 *
 * This file intentionally knows nothing about Supabase, mock adapters, or
 * real social platform APIs — see core/application/ports/publisher-port.ts
 * for the provider-neutral publishing abstraction those live behind.
 */

export type PublishingPlatform = "linkedin" | "facebook" | "instagram" | "x";

export const PUBLISHING_PLATFORM_LABELS: Record<PublishingPlatform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
};

export const PUBLISHING_PLATFORMS: PublishingPlatform[] = ["linkedin", "facebook", "instagram", "x"];

/**
 * Five statuses only — "Scheduled" is not a distinct job status. A scheduled
 * job is a `queued` job whose `scheduledFor` is still in the future; the
 * worker only claims `queued` jobs whose `scheduledFor` is due. The
 * Publishing Queue UI derives its "Scheduled" view from
 * `status === "queued" && triggerType === "scheduled" && scheduledFor > now`,
 * and its "Queued" view from the complementary case — see
 * getPublishingQueue in application/use-cases/publishing.
 */
export type PublishingJobStatus = "queued" | "processing" | "published" | "failed" | "cancelled";

export const PUBLISHING_JOB_STATUS_LABELS: Record<PublishingJobStatus, string> = {
  queued: "Queued",
  processing: "Publishing",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

export type PublishingAttemptStatus = "queued" | "started" | "completed" | "failed";

export const PUBLISHING_ATTEMPT_STATUS_LABELS: Record<PublishingAttemptStatus, string> = {
  queued: "Queued",
  started: "Started",
  completed: "Completed",
  failed: "Failed",
};

export type PublishingTriggerType = "immediate" | "scheduled" | "retry";

/**
 * The operator's publishing intent, captured ONCE — at the instant they
 * click "Publish Now" or "Schedule" — and passed immutably through
 * Pre-Publish Review to confirmation. Nothing inside the review may mutate
 * `mode`, drop `scheduledForUtc`, or change the destination; the review
 * step only ever REVIEWS this exact snapshot, and the confirm button's
 * label and the action it invokes are both derived from `mode`, never
 * chosen independently. Root-caused a defect where the review dialog had
 * no knowledge of which action the operator had chosen at all, so its
 * confirm button always read "Publish Now" even inside a scheduling flow.
 */
export type PublishingIntent =
  | {
      mode: "immediate";
      organisationId: string;
      draftId: string;
      platform: PublishingPlatform;
      resolvedAccountId: string;
    }
  | {
      mode: "scheduled";
      organisationId: string;
      draftId: string;
      platform: PublishingPlatform;
      resolvedAccountId: string;
      /** Canonical instant — always UTC, always DST-correct for displayTimezone at that instant. */
      scheduledForUtc: string;
      /** The IANA zone the operator selected — preserved for display, never used to re-derive scheduledForUtc after this snapshot is taken. */
      displayTimezone: string;
      /** Pre-formatted local wall-clock string for the review UI, computed once from the same snapshot. */
      scheduledForLocalDisplay: string;
    };

export const PUBLISHING_TRIGGER_TYPE_LABELS: Record<PublishingTriggerType, string> = {
  immediate: "Immediate",
  scheduled: "Scheduled",
  retry: "Retry",
};

/** A job never has more attempts than this without an explicit operator retry beyond the limit. */
export const DEFAULT_MAX_PUBLISHING_RETRIES = 3;

export interface PublishingJob {
  id: string;
  organisationId: string;
  draftId: string;
  platform: PublishingPlatform;
  triggerType: PublishingTriggerType;
  /** UTC ISO timestamp. For immediate/retry jobs this is the moment the job was created (already due). */
  scheduledFor: string;
  status: PublishingJobStatus;
  /**
   * Deterministic per (organisationId, draftId, platform, triggerType-cycle) —
   * see application/use-cases/publishing for exact derivation. Backed by a
   * unique DB constraint so double-clicks, action retries, and worker
   * restarts can never create two live jobs for the same intended publish.
   */
  idempotencyKey: string;
  requestedBy: string;
  /**
   * Joined from profiles at read time — never resolve this from a raw
   * `requestedBy` UUID displayed in the normal operator UI. `null` when the
   * profile has been deleted (the FK is `on delete set null`) or when a
   * mapper call genuinely has no join available (e.g. the claim/recovery
   * RPCs, which are worker-only and never rendered).
   */
  requestedByProfile: { id: string; fullName: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Set by `claim_next_publishing_job` to the worker process's own generated
   * id (see `WORKER_ID` in scripts/publishing-worker.ts). Reflects only the
   * most recent claim — a retry re-claims and overwrites this — so it is
   * never a per-attempt historical record, only "who has this job now/last".
   */
  claimedBy: string | null;
  /** Null until a claim/retry sets it; drives worker polling ("find due jobs"). */
  nextAttemptAt: string | null;
  retryCount: number;
  maxRetries: number;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Non-production-only mock outcome override — see infrastructure/publishers/simulation-mode.ts. Always null in real use. */
  devSimulationMode: "always_succeed" | "fail_next_attempt" | "always_fail" | null;
  /** Destination lock: the exact blotato_account_id resolved at scheduling time. The worker passes this to the publisher so it can route to the correct account even when multiple accounts are connected for the same platform. Null for jobs scheduled before Sprint 10B or when only one account is connected (no ambiguity). */
  resolvedAccountId: string | null;
}

export interface PublishingAttempt {
  id: string;
  jobId: string;
  organisationId: string;
  draftId: string;
  platform: PublishingPlatform;
  /** 1-indexed — the first attempt is attempt 1, not 0. */
  attemptNumber: number;
  status: PublishingAttemptStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  durationMs: number | null;
  externalPostId: string | null;
  externalUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Points at the attempt this one is retrying, if any — null for attempt 1. */
  retryOfAttemptId: string | null;
  providerMetadata: Record<string, unknown>;
  createdAt: string;
}

/** What a PublisherPort.publish() call resolves to — never throws for an expected publish failure, only for infrastructure faults. */
export type PublisherResult =
  | {
      success: true;
      externalPostId: string;
      externalUrl: string;
      publishedAt: string;
      metadata?: Record<string, unknown>;
    }
  | {
      success: false;
      errorCode: string;
      errorMessage: string;
      metadata?: Record<string, unknown>;
    };

/** The failure half of PublisherResult, reused wherever only a failure is meaningful (e.g. failPublishingAttempt's input). */
export type PublishingFailure = Extract<PublisherResult, { success: false }>;

export interface PlatformAnalytics {
  platform: PublishingPlatform;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  /** Null when there are no resolved (completed or failed) attempts yet — never a misleading "0%". */
  successRate: number | null;
  averagePublishTimeMs: number | null;
}

export interface TriggerTypeAnalytics {
  triggerType: PublishingTriggerType;
  jobCount: number;
  averageDurationMs: number | null;
  /** Null when there are no terminal jobs of this trigger type yet. */
  successRate: number | null;
}

/**
 * Every figure here is derived from persisted publishing_jobs /
 * publishing_attempts rows only — never from content_drafts, which reflects
 * only the current state, not the historical attempt record. See
 * getPublishingAnalytics's exact formulas (application/use-cases/publishing).
 */
export interface PublishingAnalytics {
  /** completedAt - startedAt, successful (completed) attempts only. Null when there are none yet. */
  averagePublishTimeMs: number | null;
  /** successful attempts / completed attempts (completed + failed) * 100. Null when no attempt has resolved yet — never a misleading "0%". */
  attemptSuccessRate: number | null;
  /** jobs that eventually reached "published" / jobs that reached any terminal state * 100. Null when no job has reached a terminal state yet. */
  jobSuccessRate: number | null;
  /** failed attempts / completed attempts (completed + failed) * 100. Null when no attempt has resolved yet. */
  failureRate: number | null;
  successfulRetries: number;
  /** Null when no retry attempt has resolved yet. */
  retrySuccessRate: number | null;
  scheduledPublications: number;
  immediatePublications: number;
  jobsQueued: number;
  jobsProcessing: number;
  jobsFailedRequiringAttention: number;
  publishedToday: number;
  scheduledVsImmediate: {
    scheduled: TriggerTypeAnalytics;
    immediate: TriggerTypeAnalytics;
  };
  platformBreakdown: PlatformAnalytics[];
  /** Jobs excluded from every figure above because at least one of their attempts was simulated (see isSimulatedPublishingAttempt) — surfaced for transparency, never silently dropped without a count. */
  simulatedJobsExcluded: number;
}

export interface PublishingTransition {
  from: PublishingJobStatus;
  to: PublishingJobStatus;
}

/**
 * The full valid-move matrix for a publishing job, mirroring the shape of
 * REVIEW_TRANSITIONS in review.ts — one place decides what's a legal jump,
 * so manual UI actions (drag-and-drop, Retry, Cancel) can never bypass a
 * server-side rule by constructing a state change some other way.
 */
export const PUBLISHING_JOB_TRANSITIONS: PublishingTransition[] = [
  { from: "queued", to: "processing" },
  { from: "processing", to: "published" },
  { from: "processing", to: "failed" },
  { from: "failed", to: "queued" }, // retry — always creates a new attempt, see retryFailedPublishingJob
  { from: "queued", to: "cancelled" },
];

export function isValidPublishingJobTransition(from: PublishingJobStatus, to: PublishingJobStatus): boolean {
  return PUBLISHING_JOB_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function isTerminalPublishingJobStatus(status: PublishingJobStatus): boolean {
  return status === "published" || status === "failed" || status === "cancelled";
}

/**
 * True only for attempts settled by simulatePublish() (BLOTATO_LIVE_PUBLISHING_ENABLED
 * off, or any Mock*Publisher) — the one place that stamps `simulated: true`
 * onto PublisherResult.metadata, which flows verbatim into
 * providerMetadata via completePublishingAttempt/failPublishingAttempt.
 * Requires no schema change: the marker already exists on every attempt
 * that ever ran through the mock path.
 */
export function isSimulatedPublishingAttempt(attempt: Pick<PublishingAttempt, "providerMetadata">): boolean {
  return attempt.providerMetadata?.simulated === true;
}

/**
 * True only for an attempt created by reconcileBlotatoStatusTimeout — it
 * stamps `reconciledFromAttemptId` onto the new attempt's providerMetadata
 * and never calls publishPost. Distinguishing this from a genuine
 * provider-resubmission retry (also attemptNumber > 1) needs no schema
 * change: the marker already exists on every reconciliation attempt.
 */
export function isReconciliationAttempt(attempt: Pick<PublishingAttempt, "providerMetadata">): boolean {
  return attempt.providerMetadata?.reconciledFromAttemptId != null;
}
