import "server-only";
import type {
  CompletePublishingAttemptInput,
  CreatePublishingAttemptInput,
  CreatePublishingJobInput,
  FailPublishingAttemptInput,
  PublishingQueueFilters,
  PublishingRepository,
} from "@/core/application/ports/publishing-port";
import type { PublishingJobStatus, PublishingPlatform } from "@/core/domain/entities/publishing";
import type { GenesisClient } from "../supabase/server-client";
import type { Json, PublishingAttemptRow, PublishingSimulationModeDb } from "../supabase/database.types";
import { toPublishingAttempt, toPublishingJob, type PublishingJobRowWithRelations } from "../mappers/publishing-mapper";
import { translateError, unwrap } from "./errors";

const JOB_STATUSES: PublishingJobStatus[] = ["queued", "processing", "published", "failed", "cancelled"];

/** Joins the requester's profile so the UI never has to display a raw UUID for "requested by". */
const JOB_SELECT = `
  *,
  requested_by_profile:profiles!publishing_jobs_requested_by_fkey(id, full_name, email)
`;

/**
 * Implements the full PublishingRepository port. Constructed once per
 * request with the RLS-bound request client (see server/container.ts) for
 * every user-facing operation — create/cancel/list/read. The background
 * worker (scripts/publishing-worker.ts) constructs a *second*, independent
 * instance of this same class with the service-role admin client
 * (src/infrastructure/supabase/admin-client.ts) for the worker-only methods
 * (claimNextJob, recoverStaleJobs, and the full attempt lifecycle) — those
 * write to publishing_attempts, which grants no INSERT/UPDATE to
 * `authenticated` at all, so they only ever function through that client.
 */
export class SupabasePublishingRepository implements PublishingRepository {
  constructor(private readonly client: GenesisClient) {}

  async createJob(input: CreatePublishingJobInput) {
    const insertResult = await this.client
      .from("publishing_jobs")
      .insert({
        organisation_id: input.organisationId,
        draft_id: input.draftId,
        platform: input.platform,
        trigger_type: input.triggerType,
        scheduled_for: input.scheduledFor,
        idempotency_key: input.idempotencyKey,
        requested_by: input.requestedBy,
        max_retries: input.maxRetries,
        dev_simulation_mode: input.devSimulationMode,
        resolved_account_id: input.resolvedAccountId,
        is_ai_generated: input.isAiGenerated,
        is_your_brand: input.isYourBrand,
        is_branded_content: input.isBrandedContent,
        execution_mode: input.executionMode,
      })
      .select(JOB_SELECT)
      .single();

    if (insertResult.error) {
      // 23505 = unique_violation, from either the idempotency-key constraint
      // (an exact replay of the same requested publish) or the active-job
      // partial unique index (a genuinely new request racing an existing,
      // still-active job for the same draft+platform). Either way, the
      // correct response to a double-click/retry is the existing job, not
      // an error surfaced to the operator.
      if (insertResult.error.code === "23505") {
        const byKey = await this.client
          .from("publishing_jobs")
          .select(JOB_SELECT)
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle();
        if (byKey.data) return toPublishingJob(byKey.data as unknown as PublishingJobRowWithRelations);

        const active = await this.findActiveJobForDraftPlatform(input.draftId, input.platform);
        if (active) return active;
      }
      translateError(insertResult.error, "Publishing job creation");
    }

    return toPublishingJob(insertResult.data as unknown as PublishingJobRowWithRelations);
  }

  async findJobById(organisationId: string, jobId: string) {
    const { data, error } = await this.client
      .from("publishing_jobs")
      .select(JOB_SELECT)
      .eq("organisation_id", organisationId)
      .eq("id", jobId)
      .maybeSingle();

    if (error) translateError(error, "Publishing job");
    return data ? toPublishingJob(data as unknown as PublishingJobRowWithRelations) : null;
  }

  async findActiveJobForDraftPlatform(draftId: string, platform: PublishingPlatform) {
    const { data, error } = await this.client
      .from("publishing_jobs")
      .select(JOB_SELECT)
      .eq("draft_id", draftId)
      .eq("platform", platform)
      .in("status", ["queued", "processing"])
      .maybeSingle();

    if (error) translateError(error, "Publishing job");
    return data ? toPublishingJob(data as unknown as PublishingJobRowWithRelations) : null;
  }

  async listJobs(filters: PublishingQueueFilters) {
    let query = this.client
      .from("publishing_jobs")
      .select(JOB_SELECT)
      .order("created_at", { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1);

    if (filters.organisationId) query = query.eq("organisation_id", filters.organisationId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.platform) query = query.eq("platform", filters.platform);
    if (filters.triggerType) query = query.eq("trigger_type", filters.triggerType);
    if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
    if (filters.dateTo) query = query.lte("created_at", filters.dateTo);

    const { data, error } = await query;
    if (error) translateError(error, "Publishing queue");
    return (data ?? []).map((row) => toPublishingJob(row as unknown as PublishingJobRowWithRelations));
  }

  async listJobsForDraft(organisationId: string, draftId: string) {
    const { data, error } = await this.client
      .from("publishing_jobs")
      .select(JOB_SELECT)
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false });

    if (error) translateError(error, "Publishing jobs");
    return (data ?? []).map((row) => toPublishingJob(row as unknown as PublishingJobRowWithRelations));
  }

  async cancelJob(organisationId: string, jobId: string) {
    const result = await this.client
      .from("publishing_jobs")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("organisation_id", organisationId)
      .eq("id", jobId)
      .eq("status", "queued")
      .select(JOB_SELECT)
      .single();

    return toPublishingJob(unwrap(result, "Publishing job") as unknown as PublishingJobRowWithRelations);
  }

  async countJobsByStatus(organisationId: string): Promise<Record<PublishingJobStatus, number>> {
    const counts = await Promise.all(
      JOB_STATUSES.map(async (status) => {
        const { count, error } = await this.client
          .from("publishing_jobs")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", organisationId)
          .eq("status", status);
        if (error) translateError(error, "Publishing job count");
        return [status, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(counts) as Record<PublishingJobStatus, number>;
  }

  async requeueJobForRetry(organisationId: string, jobId: string) {
    const existing = await this.findJobById(organisationId, jobId);
    if (!existing) throw new Error("Publishing job not found");

    // "fail_next_attempt" is a one-shot override — a retry always gets a
    // fresh, normal attempt. "always_fail"/"always_succeed" are persistent
    // test modes and are left untouched across retries.
    const rowResult = await this.client
      .from("publishing_jobs")
      .select("dev_simulation_mode")
      .eq("id", jobId)
      .single();
    const currentMode = (rowResult.data as { dev_simulation_mode: PublishingSimulationModeDb | null } | null)
      ?.dev_simulation_mode;

    const result = await this.client
      .from("publishing_jobs")
      .update({
        status: "queued",
        retry_count: existing.retryCount + 1,
        next_attempt_at: new Date().toISOString(),
        scheduled_for: new Date().toISOString(),
        claimed_by: null,
        claimed_at: null,
        completed_at: null,
        dev_simulation_mode: currentMode === "fail_next_attempt" ? null : currentMode,
      })
      .eq("organisation_id", organisationId)
      .eq("id", jobId)
      .eq("status", "failed")
      .select(JOB_SELECT)
      .single();

    return toPublishingJob(unwrap(result, "Publishing job") as unknown as PublishingJobRowWithRelations);
  }

  async markJobPublished(jobId: string) {
    const result = await this.client
      .from("publishing_jobs")
      .update({ status: "published", completed_at: new Date().toISOString() })
      .eq("id", jobId)
      .select(JOB_SELECT)
      .single();

    return toPublishingJob(unwrap(result, "Publishing job") as unknown as PublishingJobRowWithRelations);
  }

  async markJobFailed(jobId: string) {
    const result = await this.client
      .from("publishing_jobs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", jobId)
      .select(JOB_SELECT)
      .single();

    return toPublishingJob(unwrap(result, "Publishing job") as unknown as PublishingJobRowWithRelations);
  }

  async claimNextJob(workerId: string) {
    const { data, error } = await this.client.rpc("claim_next_publishing_job", { p_worker_id: workerId });
    if (error) translateError(error, "Publishing job claim");
    const rows = (data ?? []) as unknown as PublishingJobRowWithRelations[];
    const [row] = rows;
    if (!row) return null;
    return toPublishingJob(row);
  }

  async markJobAwaitingConfirmation(jobId: string, nextStatusCheckAt: string) {
    const existing = await this.client
      .from("publishing_jobs")
      .select("awaiting_confirmation_since")
      .eq("id", jobId)
      .single();
    const row = unwrap(existing, "Publishing job") as unknown as { awaiting_confirmation_since: string | null };

    const result = await this.client
      .from("publishing_jobs")
      .update({
        status: "awaiting_confirmation",
        next_status_check_at: nextStatusCheckAt,
        // Anchored to the FIRST transition only, so the unresolved horizon
        // measures how long the provider has actually been unresolved rather
        // than restarting on every check.
        awaiting_confirmation_since: row.awaiting_confirmation_since ?? new Date().toISOString(),
        // Explicitly not terminal: completed_at stays null until the provider
        // itself resolves this submission one way or the other.
        completed_at: null,
      })
      .eq("id", jobId)
      .select(JOB_SELECT)
      .single();

    return toPublishingJob(unwrap(result, "Publishing job") as unknown as PublishingJobRowWithRelations);
  }

  async recordConfirmationCheck(jobId: string, nextStatusCheckAt: string | null) {
    const existing = await this.client
      .from("publishing_jobs")
      .select("status_check_count")
      .eq("id", jobId)
      .single();
    const row = unwrap(existing, "Publishing job") as unknown as { status_check_count: number | null };

    const result = await this.client
      .from("publishing_jobs")
      .update({
        last_status_check_at: new Date().toISOString(),
        status_check_count: (row.status_check_count ?? 0) + 1,
        next_status_check_at: nextStatusCheckAt,
      })
      .eq("id", jobId)
      .select(JOB_SELECT)
      .single();

    return toPublishingJob(unwrap(result, "Publishing job") as unknown as PublishingJobRowWithRelations);
  }

  async claimJobForConfirmation(workerId: string) {
    const { data, error } = await this.client.rpc("claim_publishing_job_for_confirmation", {
      p_worker_id: workerId,
    });
    if (error) translateError(error, "Publishing confirmation claim");
    const rows = (data ?? []) as unknown as PublishingJobRowWithRelations[];
    const [row] = rows;
    if (!row) return null;
    return toPublishingJob(row);
  }

  async awaitAttemptConfirmation(attemptId: string, providerMetadata: Record<string, unknown>) {
    const result = await this.client
      .from("publishing_attempts")
      .update({
        status: "awaiting_confirmation",
        // Deliberately NOT setting failed_at/completed_at/duration_ms: this
        // attempt has not ended. Its provider metadata (including the real
        // submission id) is preserved so reconciliation re-checks the exact
        // submission rather than creating another one.
        provider_metadata: providerMetadata as Json,
      })
      .eq("id", attemptId)
      .select()
      .single();

    return toPublishingAttempt(unwrap(result, "Publishing attempt") as unknown as PublishingAttemptRow);
  }

  async recoverStaleJobs(staleAfterSeconds: number) {
    const { data, error } = await this.client.rpc("recover_stale_publishing_jobs", {
      p_stale_after_seconds: staleAfterSeconds,
    });
    if (error) translateError(error, "Stale publishing job recovery");
    const rows = (data ?? []) as unknown as PublishingJobRowWithRelations[];
    return rows.map((row) => toPublishingJob(row));
  }

  async createAttempt(input: CreatePublishingAttemptInput) {
    const result = await this.client
      .from("publishing_attempts")
      .insert({
        job_id: input.jobId,
        organisation_id: input.organisationId,
        draft_id: input.draftId,
        platform: input.platform,
        attempt_number: input.attemptNumber,
        retry_of_attempt_id: input.retryOfAttemptId,
      })
      .select()
      .single();

    return toPublishingAttempt(unwrap(result, "Publishing attempt") as unknown as PublishingAttemptRow);
  }

  async startAttempt(attemptId: string) {
    const result = await this.client
      .from("publishing_attempts")
      .update({ status: "started", started_at: new Date().toISOString() })
      .eq("id", attemptId)
      .select()
      .single();

    return toPublishingAttempt(unwrap(result, "Publishing attempt") as unknown as PublishingAttemptRow);
  }

  async completeAttempt(attemptId: string, input: CompletePublishingAttemptInput) {
    const existing = await this.client
      .from("publishing_attempts")
      .select("started_at, queued_at")
      .eq("id", attemptId)
      .single();
    const row = unwrap(existing, "Publishing attempt") as unknown as { started_at: string | null; queued_at: string };
    const startedAt = row.started_at ? new Date(row.started_at).getTime() : new Date(row.queued_at).getTime();
    const durationMs = Math.max(0, Date.now() - startedAt);

    const result = await this.client
      .from("publishing_attempts")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        external_post_id: input.externalPostId,
        external_url: input.externalUrl,
        provider_metadata: input.providerMetadata as Json,
      })
      .eq("id", attemptId)
      .select()
      .single();

    return toPublishingAttempt(unwrap(result, "Publishing attempt") as unknown as PublishingAttemptRow);
  }

  async failAttempt(attemptId: string, input: FailPublishingAttemptInput) {
    const existing = await this.client
      .from("publishing_attempts")
      .select("started_at, queued_at")
      .eq("id", attemptId)
      .single();
    const row = unwrap(existing, "Publishing attempt") as unknown as { started_at: string | null; queued_at: string };
    const startedAt = row.started_at ? new Date(row.started_at).getTime() : new Date(row.queued_at).getTime();
    const durationMs = Math.max(0, Date.now() - startedAt);

    const result = await this.client
      .from("publishing_attempts")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_code: input.errorCode,
        error_message: input.errorMessage,
        provider_metadata: input.providerMetadata as Json,
      })
      .eq("id", attemptId)
      .select()
      .single();

    return toPublishingAttempt(unwrap(result, "Publishing attempt") as unknown as PublishingAttemptRow);
  }

  async listAttemptsForJob(organisationId: string, jobId: string) {
    const { data, error } = await this.client
      .from("publishing_attempts")
      .select()
      .eq("organisation_id", organisationId)
      .eq("job_id", jobId)
      .order("attempt_number", { ascending: true });

    if (error) translateError(error, "Publishing attempts");
    return (data ?? []).map((row) => toPublishingAttempt(row as unknown as PublishingAttemptRow));
  }

  async listAttemptsForDraft(organisationId: string, draftId: string) {
    const { data, error } = await this.client
      .from("publishing_attempts")
      .select()
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false });

    if (error) translateError(error, "Publishing attempts");
    return (data ?? []).map((row) => toPublishingAttempt(row as unknown as PublishingAttemptRow));
  }

  async listAttemptsForAnalytics(organisationId: string | undefined, input: { dateFrom?: string; dateTo?: string }) {
    let query = this.client.from("publishing_attempts").select();
    if (organisationId) query = query.eq("organisation_id", organisationId);
    if (input.dateFrom) query = query.gte("created_at", input.dateFrom);
    if (input.dateTo) query = query.lte("created_at", input.dateTo);

    const { data, error } = await query;
    if (error) translateError(error, "Publishing analytics");
    return (data ?? []).map((row) => toPublishingAttempt(row as unknown as PublishingAttemptRow));
  }

  async listJobsForAnalytics(organisationId: string | undefined, input: { dateFrom?: string; dateTo?: string }) {
    let query = this.client.from("publishing_jobs").select(JOB_SELECT);
    if (organisationId) query = query.eq("organisation_id", organisationId);
    if (input.dateFrom) query = query.gte("created_at", input.dateFrom);
    if (input.dateTo) query = query.lte("created_at", input.dateTo);

    const { data, error } = await query;
    if (error) translateError(error, "Publishing analytics");
    return (data ?? []).map((row) => toPublishingJob(row as unknown as PublishingJobRowWithRelations));
  }
}
