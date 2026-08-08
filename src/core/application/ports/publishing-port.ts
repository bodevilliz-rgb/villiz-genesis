import type {
  PublishingAttempt,
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
