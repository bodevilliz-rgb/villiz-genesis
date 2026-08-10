-- TikTok AI-generated-content disclosure (pre-merge compliance correction on
-- feature/tiktok-publishing).
--
-- WHY A MIGRATION IS REQUIRED: Blotato's TikTok target schema makes
-- isAiGenerated a REQUIRED field, and it is a per-post truthfulness
-- declaration only the operator can make — it cannot be defaulted, inferred
-- from Awo usage, or derived from any existing column. The declaration is
-- captured once at job creation (the same capture-once pattern as
-- resolved_account_id, the destination lock added in Sprint 10B) and must
-- survive until worker execution, which for a scheduled job can be hours or
-- days later, across worker restarts, and through retries of the same job
-- row. publishing_jobs has no metadata/JSONB column to piggyback on
-- (provider_metadata lives on publishing_attempts, which are append-only
-- execution RECORDS, not pre-execution intent), so a dedicated nullable
-- column on publishing_jobs is the smallest persistence that preserves
-- immediate publishing, scheduled publishing, retries, worker execution,
-- and auditability.
--
-- NULL semantics: "never declared". Legacy rows (all non-TikTok today —
-- no TikTok job can exist before this feature merges) stay NULL and are
-- unaffected: only platforms whose canonical policy sets
-- requiresAiDisclosure (TikTok alone) ever have the value enforced, by
-- deterministic preflight at BOTH job creation and worker execution.
-- Deliberately no DEFAULT clause — a database default would silently
-- fabricate the exact untruthful blanket declaration this change exists to
-- remove.
alter table public.publishing_jobs
  add column if not exists is_ai_generated boolean;

comment on column public.publishing_jobs.is_ai_generated is
  'Operator''s explicit per-post AI-generated-content declaration, captured at job creation. NULL = never declared; enforced (non-null required for live publishing) only for platforms whose canonical policy requires the disclosure (TikTok). Never defaulted or inferred.';
