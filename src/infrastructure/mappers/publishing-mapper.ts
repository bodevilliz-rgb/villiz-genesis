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

/**
 * The ONE place a claim RPC's payload becomes a domain job, regardless of
 * what PostgREST hands back.
 *
 * P0 follow-up (2026-08-10): claim_publishing_job_for_confirmation was
 * declared `returns publishing_jobs` (a single composite) while the
 * proven-working claim_next_publishing_job is `returns setof`. PostgREST
 * serialises those differently — an array for a set, a bare object for a
 * single composite — and a plpgsql `return null` from a single-composite
 * function can arrive as a composite of ALL-NULL fields rather than null at
 * all (diagnosed in 20260801160000). The repository destructured the payload
 * as an array (`const [row] = rows`), so a non-array payload threw
 * "rows is not iterable" on every worker tick.
 *
 * 20260810040000 fixes the SQL to the proven `setof` shape. This function
 * additionally removes the application's dependence on that shape entirely,
 * so the same class of defect cannot recur for either claim RPC:
 *
 *   - null / undefined            → null   (nothing claimed)
 *   - []                          → null   (nothing claimed — the setof shape)
 *   - [row] / row                 → job    (array or bare composite)
 *   - a composite with a null id  → null   (the all-null "nothing" composite)
 *   - anything else               → throws a clear, named error rather than
 *                                   a cryptic TypeError deep in a worker loop
 */
export function toClaimedPublishingJob(payload: unknown, context: string): PublishingJob | null {
  if (payload === null || payload === undefined) return null;

  const candidate = Array.isArray(payload) ? payload[0] : payload;
  if (candidate === null || candidate === undefined) return null;

  if (typeof candidate !== "object") {
    throw new Error(
      `${context} returned an unexpected payload shape (${typeof candidate}) — expected a publishing_jobs row, an array of them, or null.`,
    );
  }

  const row = candidate as Partial<PublishingJobRow>;
  if (!("id" in row)) {
    throw new Error(`${context} returned an object with no 'id' column — it does not look like a publishing_jobs row.`);
  }

  // The all-null composite a single-row plpgsql function can produce for
  // "nothing to claim". Truthy as an object, but genuinely nothing.
  if (typeof row.id !== "string" || row.id === "") return null;

  return toPublishingJob(row as PublishingJobRowWithRelations);
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
