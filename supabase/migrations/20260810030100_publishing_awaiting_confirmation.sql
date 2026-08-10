-- P0: asynchronous provider confirmation without false failures — part 2 of 2
-- (schema + claim RPC). See 20260810030000 for the incident and root cause;
-- this file is separate only because Postgres forbids using the enum values
-- that migration adds inside the same transaction.

-- Durable confirmation scheduling. All nullable / defaulted so existing rows
-- are untouched and no backfill is required: a job that is not awaiting
-- confirmation simply has no next check scheduled.
--
-- next_status_check_at NULL *while status = 'awaiting_confirmation'* is the
-- "stopped checking, needs operator attention" signal (the job passed the
-- maximum unresolved horizon). It is derived from these columns rather than
-- given its own enum value deliberately — a second terminal-looking state
-- would risk re-introducing exactly the false-failure semantics this work
-- exists to remove.
alter table public.publishing_jobs
  add column if not exists next_status_check_at timestamptz,
  add column if not exists last_status_check_at timestamptz,
  add column if not exists status_check_count integer not null default 0,
  add column if not exists awaiting_confirmation_since timestamptz;

comment on column public.publishing_jobs.next_status_check_at is
  'When the background confirmation pass should next call the provider''s status endpoint for this job''s EXISTING submission. Only set while status = awaiting_confirmation. NULL while awaiting_confirmation means automatic checking has stopped (horizon exceeded) and the job needs operator attention.';
comment on column public.publishing_jobs.last_status_check_at is
  'When the provider status was last checked for this job. NULL until the first background check.';
comment on column public.publishing_jobs.status_check_count is
  'Count of background confirmation checks performed. Drives the bounded backoff curve (see nextConfirmationCheckDelayMs).';
comment on column public.publishing_jobs.awaiting_confirmation_since is
  'When this job first entered awaiting_confirmation — the anchor for the maximum unresolved horizon.';

-- Indexes the background pass's exact query shape (due awaiting-confirmation
-- jobs, oldest first) so the claim stays cheap as history grows.
create index if not exists publishing_jobs_awaiting_confirmation_due_idx
  on public.publishing_jobs (next_status_check_at)
  where status = 'awaiting_confirmation' and next_status_check_at is not null;

-- ---------------------------------------------------------------------------
-- Atomic confirmation claim.
--
-- Mirrors claim_next_publishing_job's `for update skip locked` guarantee, for
-- exactly the same reason: the Render worker and the Vercel API-route worker
-- both run this pass on their own schedules, and two processes must never
-- both check (and both resolve) the same job. Postgres enforces that here,
-- not application logic.
--
-- CRITICAL: claiming for confirmation does NOT set status = 'processing' and
-- does NOT touch claimed_by/claimed_at. A confirmation check is a read of the
-- provider's state for an ALREADY-SUBMITTED post — it must never look like,
-- or become, a new publishing attempt. The only mutation here is pushing
-- next_status_check_at out by a lease so a second worker polling concurrently
-- skips this row; the caller then writes the real next check time (or the
-- terminal outcome) when the provider answers.
-- ---------------------------------------------------------------------------
create or replace function public.claim_publishing_job_for_confirmation(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns public.publishing_jobs
language plpgsql
as $$
declare
  v_job public.publishing_jobs;
begin
  select *
  into v_job
  from public.publishing_jobs
  where status = 'awaiting_confirmation'
    and next_status_check_at is not null
    and next_status_check_at <= now()
  order by next_status_check_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return null;
  end if;

  update public.publishing_jobs
  set next_status_check_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

comment on function public.claim_publishing_job_for_confirmation(text, integer) is
  'Atomically leases one due awaiting_confirmation job for a provider status check. Never sets processing, never touches claimed_by — a confirmation check is a read of an already-submitted post, never a new publish.';
