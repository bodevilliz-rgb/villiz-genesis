import type { PublishingJob, PublishingAttempt } from "@/core/domain/entities/publishing";
import type { PublishingJobRow, PublishingAttemptRow } from "../supabase/database.types";

export function toPublishingJob(row: PublishingJobRow): PublishingJob {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    draftId: row.draft_id,
    platform: row.platform,
    triggerType: row.trigger_type,
    scheduledFor: row.scheduled_for,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestedBy: row.requested_by ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextAttemptAt: row.next_attempt_at,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    devSimulationMode: row.dev_simulation_mode,
  };
}

export function toPublishingAttempt(row: PublishingAttemptRow): PublishingAttempt {
  return {
    id: row.id,
    jobId: row.job_id,
    organisationId: row.organisation_id,
    draftId: row.draft_id,
    platform: row.platform,
    attemptNumber: row.attempt_number,
    status: row.status,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    durationMs: row.duration_ms,
    externalPostId: row.external_post_id,
    externalUrl: row.external_url,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    retryOfAttemptId: row.retry_of_attempt_id,
    providerMetadata: (row.provider_metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  };
}
