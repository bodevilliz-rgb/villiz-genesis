import type { PublishingJob, PublishingAttempt } from "@/core/domain/entities/publishing";
import type { PublishingJobRow, PublishingAttemptRow } from "../supabase/database.types";

type ProfileRef = { id: string; full_name: string | null; email: string } | null;

/** The bare generated row plus the `requested_by_profile` embed — present whenever a query uses JOB_SELECT (see supabase-publishing-repository.ts), absent for the worker-only claim/recovery RPCs. */
export type PublishingJobRowWithRelations = PublishingJobRow & {
  requested_by_profile?: ProfileRef;
};

function toProfileRef(ref: ProfileRef) {
  return ref ? { id: ref.id, fullName: ref.full_name, email: ref.email } : null;
}

export function toPublishingJob(row: PublishingJobRowWithRelations): PublishingJob {
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
    requestedByProfile: toProfileRef(row.requested_by_profile ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedBy: row.claimed_by,
    nextAttemptAt: row.next_attempt_at,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    devSimulationMode: row.dev_simulation_mode,
    resolvedAccountId: (row as PublishingJobRowWithRelations & { resolved_account_id?: string | null }).resolved_account_id ?? null,
    isAiGenerated: (row as PublishingJobRowWithRelations & { is_ai_generated?: boolean | null }).is_ai_generated ?? null,
    isYourBrand: (row as PublishingJobRowWithRelations & { is_your_brand?: boolean | null }).is_your_brand ?? null,
    isBrandedContent: (row as PublishingJobRowWithRelations & { is_branded_content?: boolean | null }).is_branded_content ?? null,
    // P0 fix: fail-safe to "simulation" — the safe direction — for any row
    // read before the migration is applied or otherwise missing the
    // column, rather than ever defaulting toward "live".
    executionMode: (row as PublishingJobRowWithRelations & { execution_mode?: "simulation" | "live" | null }).execution_mode ?? "simulation",
    nextStatusCheckAt: (row as PublishingJobRowWithRelations & { next_status_check_at?: string | null }).next_status_check_at ?? null,
    lastStatusCheckAt: (row as PublishingJobRowWithRelations & { last_status_check_at?: string | null }).last_status_check_at ?? null,
    statusCheckCount: (row as PublishingJobRowWithRelations & { status_check_count?: number | null }).status_check_count ?? 0,
    awaitingConfirmationSince:
      (row as PublishingJobRowWithRelations & { awaiting_confirmation_since?: string | null }).awaiting_confirmation_since ?? null,
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
