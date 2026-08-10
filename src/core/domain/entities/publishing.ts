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

export type PublishingPlatform = "linkedin" | "facebook" | "instagram" | "x" | "tiktok";

export const PUBLISHING_PLATFORM_LABELS: Record<PublishingPlatform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  tiktok: "TikTok",
};

export const PUBLISHING_PLATFORMS: PublishingPlatform[] = ["linkedin", "facebook", "instagram", "x", "tiktok"];

/** Narrows an arbitrary string (e.g. a loosely-typed `string | null` draft field) to a real PublishingPlatform — the one shared guard, reused wherever a platform value needs validating rather than re-implemented per call site. */
export function isPublishingPlatform(value: string | null | undefined): value is PublishingPlatform {
  return value === "linkedin" || value === "facebook" || value === "instagram" || value === "x" || value === "tiktok";
}

/**
 * Five statuses only — "Scheduled" is not a distinct job status. A scheduled
 * job is a `queued` job whose `scheduledFor` is still in the future; the
 * worker only claims `queued` jobs whose `scheduledFor` is due. The
 * Publishing Queue UI derives its "Scheduled" view from
 * `status === "queued" && triggerType === "scheduled" && scheduledFor > now`,
 * and its "Queued" view from the complementary case — see
 * getPublishingQueue in application/use-cases/publishing.
 */
/**
 * P0 fix (2026-08-10, second incident): `awaiting_confirmation` exists
 * because a provider submission that has been ACCEPTED but has not yet
 * reached a terminal provider status is not a failure. Genesis previously
 * had no way to say "the post is really out there, we just don't know its
 * outcome yet", so the publisher's local polling budget expiring
 * (blotato_status_timeout) was mapped straight onto `failed` — marking two
 * genuinely-published production posts (one Instagram, one TikTok:
 * submission 1144fce2-dc61-4e9b-b5ac-68e5f8511654) as failures.
 *
 * Only a provider-CONFIRMED failure may become `failed`. Provider-status
 * uncertainty is non-terminal by construction — see
 * isTerminalPublishingJobStatus, which deliberately excludes this state.
 */
export type PublishingJobStatus =
  | "queued"
  | "processing"
  | "awaiting_confirmation"
  | "published"
  | "failed"
  | "cancelled";

export const PUBLISHING_JOB_STATUS_LABELS: Record<PublishingJobStatus, string> = {
  queued: "Queued",
  processing: "Publishing",
  awaiting_confirmation: "Awaiting confirmation",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * `awaiting_confirmation` mirrors the job-level state: the attempt really
 * did reach the provider and really did get a submission id back, so
 * recording it as `failed` would falsify attempt history. It stays
 * non-terminal (and therefore outside every success/failure analytic)
 * until the provider itself resolves it.
 */
export type PublishingAttemptStatus = "queued" | "started" | "awaiting_confirmation" | "completed" | "failed";

export const PUBLISHING_ATTEMPT_STATUS_LABELS: Record<PublishingAttemptStatus, string> = {
  queued: "Queued",
  started: "Started",
  awaiting_confirmation: "Awaiting confirmation",
  completed: "Completed",
  failed: "Failed",
};

export type PublishingTriggerType = "immediate" | "scheduled" | "retry";

/**
 * P0 fix (2026-08-10 incident): a Pre-Publish Review that displayed "Mode:
 * Simulation" was followed by a REAL Blotato submission — because
 * live-vs-simulation had never been anything but a value each executing
 * process derived independently from its own BLOTATO_LIVE_PUBLISHING_ENABLED
 * env var. The Render background worker's environment had live publishing
 * enabled; Vercel's (what the operator actually saw) did not. Nothing
 * persisted what the operator reviewed, so the two processes silently
 * disagreed.
 *
 * PublishingExecutionMode is captured ONCE — from the same isLivePublishing
 * value the Pre-Publish Review Mode badge itself renders from — at the exact
 * moment the operator confirms Publish Now / Schedule, the same
 * capture-once pattern as resolvedAccountId/isAiGenerated. It is persisted
 * on the job row and is the ONLY thing any worker (Render or the Vercel
 * API-route) may consult to decide whether a publish is allowed to reach
 * the real provider — see resolveEffectiveLivePublishing. A process's own
 * environment can never again silently upgrade a job the operator reviewed
 * as simulation into a live provider call.
 */
export type PublishingExecutionMode = "simulation" | "live";

export const PUBLISHING_EXECUTION_MODE_LABELS: Record<PublishingExecutionMode, string> = {
  simulation: "Simulation",
  live: "Live",
};

/**
 * The single authority for whether a publish is allowed to reach the real
 * provider. `jobExecutionMode` is the operator-reviewed, immutable value
 * captured on the job at creation; `globalLiveEnabled` is the deployment-
 * wide BLOTATO_LIVE_PUBLISHING_ENABLED kill switch for whichever process is
 * asking.
 *
 * One-directional fail-safe: a "simulation" job NEVER goes live, regardless
 * of what the asking process's own environment says — this is the exact
 * rule the incident violated. A "live" job still requires the asking
 * process's own global flag too — this preserves the existing, unchanged
 * kill-switch behaviour (BLOTATO_LIVE_PUBLISHING_ENABLED=false already
 * means "simulate, full stop, regardless of anything else" for every
 * platform) rather than inventing a new failure mode for it.
 */
export function resolveEffectiveLivePublishing(
  jobExecutionMode: PublishingExecutionMode,
  globalLiveEnabled: boolean,
): boolean {
  if (jobExecutionMode === "simulation") return false;
  return globalLiveEnabled;
}

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
      /** P0 fix: the exact Mode the operator was shown in Pre-Publish Review, captured once and persisted with the job — see resolveEffectiveLivePublishing. Never re-derived from a process's own environment after this snapshot is taken. */
      executionMode: PublishingExecutionMode;
      /** Operator's explicit AI-generated-content declaration for THIS post. Only meaningful for platforms whose policy sets requiresAiDisclosure (TikTok today); null = not declared, which deterministic preflight blocks for those platforms. Never defaulted. */
      isAiGenerated?: boolean | null;
      /** Operator's explicit "promotes my own brand/business" declaration (TikTok commercial-content disclosure). Independent of isBrandedContent — both may be true. Null = not declared. Never defaulted. */
      isYourBrand?: boolean | null;
      /** Operator's explicit "promotes a third-party brand under a paid partnership" declaration (TikTok commercial-content disclosure). Null = not declared. Never defaulted. */
      isBrandedContent?: boolean | null;
    }
  | {
      mode: "scheduled";
      organisationId: string;
      draftId: string;
      platform: PublishingPlatform;
      resolvedAccountId: string;
      /** See the immediate variant. */
      executionMode: PublishingExecutionMode;
      /** See the immediate variant — same declaration, captured in the same immutable snapshot. */
      isAiGenerated?: boolean | null;
      /** See the immediate variant. */
      isYourBrand?: boolean | null;
      /** See the immediate variant. */
      isBrandedContent?: boolean | null;
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
  /**
   * P0 fix (2026-08-10 incident): the exact Mode ("Simulation"/"Live") the
   * operator was shown and confirmed in Pre-Publish Review, captured once
   * at job creation. This is now the ONLY thing any worker may consult to
   * decide whether a publish reaches the real provider — see
   * resolveEffectiveLivePublishing. Never re-derived from a process's own
   * BLOTATO_LIVE_PUBLISHING_ENABLED after this snapshot is taken, so a
   * Render worker and Vercel can never again silently disagree about what
   * the operator actually reviewed.
   */
  executionMode: PublishingExecutionMode;
  /**
   * Operator's explicit AI-generated-content declaration, captured at job
   * creation from the publishing panel — the same capture-once pattern as
   * resolvedAccountId. Only platforms whose policy sets requiresAiDisclosure
   * (TikTok today) require it; for them, null means "never declared" and
   * deterministic preflight blocks live publishing at BOTH job creation and
   * worker execution. Never inferred (not from Awo usage, organisation,
   * account, or media), never defaulted — this is a per-post compliance
   * declaration only the operator can truthfully make.
   */
  isAiGenerated: boolean | null;
  /**
   * Operator's explicit "promotes my own brand/business" declaration
   * (TikTok commercial-content disclosure — developers.tiktok.com/doc/
   * content-sharing-guidelines). Same capture-once, never-defaulted pattern
   * as isAiGenerated; independent of isBrandedContent — both may be true.
   */
  isYourBrand: boolean | null;
  /**
   * Operator's explicit "promotes a third-party brand under a paid
   * partnership" declaration. Same pattern as isYourBrand.
   */
  isBrandedContent: boolean | null;
  /**
   * When the background confirmation pass should next call getPostStatus for
   * this job's existing provider submission. Only ever set while status is
   * `awaiting_confirmation`. Null means "no automatic check scheduled" —
   * either the job is not awaiting confirmation at all, or it has passed
   * MAX_CONFIRMATION_HORIZON_MS and now needs operator attention
   * (see isProviderConfirmationUnresolved).
   */
  nextStatusCheckAt: string | null;
  /** When the provider's status was last checked for this job. Null until the first background check. */
  lastStatusCheckAt: string | null;
  /** How many background confirmation checks have run for this job. Drives the backoff curve; never resets. */
  statusCheckCount: number;
  /** When this job first entered awaiting_confirmation — the anchor for MAX_CONFIRMATION_HORIZON_MS. */
  awaitingConfirmationSince: string | null;
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
    }
  | {
      /**
       * P0 fix: the provider ACCEPTED the submission and returned a real id,
       * but had not reached a terminal status before the synchronous polling
       * budget expired. Deliberately a third outcome rather than
       * `success: false` — every existing `!result.success` branch treats its
       * subject as a failure, and this is precisely the case that must never
       * be treated as one again.
       */
      success: "pending";
      /** The provider's own submission id — the exact value later reconciliation must re-check, and must never re-submit. */
      providerSubmissionId: string;
      metadata?: Record<string, unknown>;
    };

/** The failure half of PublisherResult, reused wherever only a failure is meaningful (e.g. failPublishingAttempt's input). */
export type PublishingFailure = Extract<PublisherResult, { success: false }>;

/** The awaiting-confirmation half of PublisherResult. */
export type PublishingPending = Extract<PublisherResult, { success: "pending" }>;

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
  /**
   * Jobs whose provider submission is accepted but not yet resolved. Counted
   * and surfaced separately, and deliberately excluded from every
   * success/failure rate above — an unresolved provider status is neither a
   * success nor a failure, and treating it as either is exactly the defect
   * this state was introduced to remove.
   */
  jobsAwaitingConfirmation: number;
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
 * Background confirmation-check backoff, in milliseconds, by how many
 * background checks this job has already had (0 = the first background
 * check after the synchronous window expired).
 *
 * Chosen from observed provider behaviour, not invented: the synchronous
 * publisher window is already 10 checks × 3s = 30s, and both production
 * incidents had the provider reach "published" some time after that. Blotato
 * processes video asynchronously (TikTok transcoding in particular), so the
 * useful range is minutes, not seconds. This ramps 1m → 2m → 5m → 10m → 20m
 * and then holds at 30m, which resolves the common case within a couple of
 * minutes while costing at most ~2 provider status calls per hour for a
 * genuinely stuck submission. Deliberately bounded: never faster than a
 * minute (no busy-loop against the provider) and never slower than half an
 * hour (an operator is never left staring at a stale state for long).
 */
const CONFIRMATION_BACKOFF_MS = [60_000, 120_000, 300_000, 600_000, 1_200_000, 1_800_000] as const;

export function nextConfirmationCheckDelayMs(completedCheckCount: number): number {
  const index = Math.min(Math.max(completedCheckCount, 0), CONFIRMATION_BACKOFF_MS.length - 1);
  return CONFIRMATION_BACKOFF_MS[index]!;
}

/**
 * How long a submission may stay unresolved before Genesis stops checking
 * automatically. 24 hours: long enough to survive a provider incident or
 * transcoding backlog (both incidents resolved within minutes, so this is
 * ~3 orders of magnitude of headroom), short enough that a job never sits
 * in an automated loop indefinitely. Reaching this horizon NEVER
 * republishes and never invents a failure — it stops the automatic checks
 * and surfaces the job for operator attention with the submission id
 * intact (see isProviderConfirmationUnresolved).
 */
export const MAX_CONFIRMATION_HORIZON_MS = 24 * 60 * 60 * 1000;

export function hasExceededConfirmationHorizon(firstAwaitedAt: string, now: Date): boolean {
  const started = new Date(firstAwaitedAt).getTime();
  if (Number.isNaN(started)) return false;
  return now.getTime() - started >= MAX_CONFIRMATION_HORIZON_MS;
}

/**
 * A job Genesis has stopped auto-checking but has NOT resolved: still
 * awaiting_confirmation, with no next check scheduled. Derived rather than
 * given its own enum value — the distinction is "is a check scheduled",
 * which `nextStatusCheckAt` already answers, and inventing a second
 * terminal-looking state would risk exactly the false-failure semantics
 * this whole fix removes.
 */
export function isProviderConfirmationUnresolved(job: Pick<PublishingJob, "status" | "nextStatusCheckAt">): boolean {
  return job.status === "awaiting_confirmation" && job.nextStatusCheckAt === null;
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
