import type {
  PublishingAttempt,
  PublishingExecutionMode,
  PublishingJob,
  PublishingJobStatus,
  PublishingPlatform,
  PublishingTriggerType,
} from "@/core/domain/entities/publishing";

export interface CreatePublishingJobInput {
  organisationId: string;
  draftId: string;
  platform: PublishingPlatform;
  triggerType: PublishingTriggerType;
  scheduledFor: string;
  idempotencyKey: string;
  requestedBy: string;
  maxRetries: number;
  devSimulationMode: "always_succeed" | "fail_next_attempt" | "always_fail" | null;
  resolvedAccountId: string | null;
  /** P0 fix: the operator-reviewed Mode captured on the job — see PublishingJob.executionMode. Always required, never inferred. */
  executionMode: PublishingExecutionMode;
  /** Operator's per-post AI-generated-content declaration (see PublishingJob.isAiGenerated). Null = never declared. */
  isAiGenerated: boolean | null;
  /** Operator's per-post commercial-content declarations (see PublishingJob.isYourBrand/isBrandedContent). Null = never declared. */
  isYourBrand: boolean | null;
  isBrandedContent: boolean | null;
}

export interface PublishingQueueFilters {
  organisationId?: string;
  status?: PublishingJobStatus;
  platform?: PublishingPlatform;
  triggerType?: PublishingTriggerType;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export interface CreatePublishingAttemptInput {
  jobId: string;
  organisationId: string;
  draftId: string;
  platform: PublishingPlatform;
  attemptNumber: number;
  retryOfAttemptId: string | null;
}

export interface CompletePublishingAttemptInput {
  externalPostId: string;
  externalUrl: string;
  providerMetadata: Record<string, unknown>;
}

export interface FailPublishingAttemptInput {
  errorCode: string;
  errorMessage: string;
  providerMetadata: Record<string, unknown>;
}

export interface PublishingRepository {
  /**
   * Deterministic idempotency: a repeated call with the same
   * `idempotencyKey` returns the row that already exists instead of
   * inserting a second one (insert ... on conflict do nothing, then
   * re-select) — this is what makes a double-click or an action retry safe.
   */
  createJob(input: CreatePublishingJobInput): Promise<PublishingJob>;
  findJobById(organisationId: string, jobId: string): Promise<PublishingJob | null>;
  findActiveJobForDraftPlatform(draftId: string, platform: PublishingPlatform): Promise<PublishingJob | null>;
  listJobs(filters: PublishingQueueFilters): Promise<PublishingJob[]>;
  listJobsForDraft(organisationId: string, draftId: string): Promise<PublishingJob[]>;
  cancelJob(organisationId: string, jobId: string): Promise<PublishingJob>;
  countJobsByStatus(organisationId: string): Promise<Record<PublishingJobStatus, number>>;

  /** Requeues a failed job as a new queued attempt cycle — never mutates any existing attempt row. */
  requeueJobForRetry(organisationId: string, jobId: string): Promise<PublishingJob>;
  markJobPublished(jobId: string): Promise<PublishingJob>;
  markJobFailed(jobId: string): Promise<PublishingJob>;

  /**
   * Moves a job into the non-terminal awaiting_confirmation state and
   * schedules its first background provider status check. Sets
   * awaiting_confirmation_since only on the first transition, so the
   * unresolved horizon is anchored to when waiting actually began.
   */
  markJobAwaitingConfirmation(jobId: string, nextStatusCheckAt: string): Promise<PublishingJob>;
  /**
   * Records the outcome of one background confirmation check that did NOT
   * resolve: bumps the counter, stamps last_status_check_at, and schedules
   * the next check — or passes null to stop automatic checking (horizon
   * exceeded), leaving the job awaiting_confirmation for operator attention.
   */
  recordConfirmationCheck(jobId: string, nextStatusCheckAt: string | null): Promise<PublishingJob>;
  /**
   * Worker-only. Atomically leases one due awaiting_confirmation job for a
   * provider status check (`for update skip locked`), so two workers can
   * never both check — and both resolve — the same job. Never sets
   * processing and never touches claimed_by: a confirmation check is a read
   * of an already-submitted post, never a new publish.
   */
  claimJobForConfirmation(workerId: string): Promise<PublishingJob | null>;
  /** Marks an attempt as awaiting provider confirmation, preserving its provider metadata (including the submission id). Never a terminal state. */
  awaitAttemptConfirmation(attemptId: string, providerMetadata: Record<string, unknown>): Promise<PublishingAttempt>;

  /** Worker-only — must be called with the service-role client. Atomic (`for update skip locked`) at the database level. */
  claimNextJob(workerId: string): Promise<PublishingJob | null>;
  /** Worker-only — must be called with the service-role client. */
  recoverStaleJobs(staleAfterSeconds: number): Promise<PublishingJob[]>;

  createAttempt(input: CreatePublishingAttemptInput): Promise<PublishingAttempt>;
  startAttempt(attemptId: string): Promise<PublishingAttempt>;
  completeAttempt(attemptId: string, input: CompletePublishingAttemptInput): Promise<PublishingAttempt>;
  failAttempt(attemptId: string, input: FailPublishingAttemptInput): Promise<PublishingAttempt>;
  listAttemptsForJob(organisationId: string, jobId: string): Promise<PublishingAttempt[]>;
  listAttemptsForDraft(organisationId: string, draftId: string): Promise<PublishingAttempt[]>;

  /**
   * Raw rows only — every analytics formula is computed by the application
   * layer from these, never derived from content_drafts. `organisationId`
   * omitted queries every organisation the caller's RLS-bound client can
   * see (the Dashboard's cross-organisation rollup); provided, it scopes to
   * one account (the Publishing Queue page).
   */
  listAttemptsForAnalytics(organisationId: string | undefined, input: { dateFrom?: string; dateTo?: string }): Promise<PublishingAttempt[]>;
  listJobsForAnalytics(organisationId: string | undefined, input: { dateFrom?: string; dateTo?: string }): Promise<PublishingJob[]>;
}
