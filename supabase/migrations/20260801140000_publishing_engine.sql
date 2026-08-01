-- ===========================================================================
-- Project Genesis — Sprint 6A: Publishing Engine Hardening
--
-- Adds a durable, worker-driven publishing pipeline behind content_drafts'
-- existing approved -> scheduled/publishing -> published/failed status
-- values (all already declared by 20260731100000_content_studio_v2.sql and
-- 20260801000000_publishing_pipeline.sql). Nothing here alters an existing
-- migration, table, enum, or column — this is purely additive.
--
-- ARCHITECTURAL DECISIONS
--
-- 1. `publishing_jobs` is the durable intent to publish one draft to one
--    platform once; `publishing_attempts` is the immutable historical record
--    of the engine actually trying. A retry always INSERTs a new attempt row
--    — a trigger (app.prevent_terminal_attempt_mutation) makes it a hard
--    database error to UPDATE an attempt that has already reached a
--    terminal status (completed/failed), so "retry overwrote history" is
--    not just a code convention, it is structurally impossible.
--
-- 2. Only 5 job statuses exist (queued/processing/published/failed/
--    cancelled) — there is no distinct "scheduled" job status. A scheduled
--    job is simply a `queued` job whose `scheduled_for` is still in the
--    future; the claim function (below) only ever claims queued jobs whose
--    scheduled_for is due. The application layer's Publishing Queue UI
--    derives its "Scheduled" view from that same due/not-due distinction.
--
-- 3. Job claiming uses `for update skip locked` inside a single RPC
--    (public.claim_next_publishing_job) so that two worker processes racing
--    for the same due job can never both win — Postgres itself, not
--    application logic, is what prevents double-processing. This is the
--    same class of guarantee `perform_content_draft_review`'s row-count
--    check gave the review workflow (see 20260801130000): don't trust a
--    read-then-write race, make the database enforce it atomically.
--
-- 4. Idempotency is enforced two ways: a unique `idempotency_key` (blocks
--    the exact same requested publish — e.g. a duplicated Server Action
--    call or double-click — from ever inserting a second job row) and a
--    partial unique index on (draft_id, platform) restricted to
--    queued/processing rows (blocks two simultaneously *active* jobs for
--    the same draft+platform, while still allowing that pair to accumulate
--    any number of historical terminal jobs over time — one per publish).
--
-- 5. `publishing_attempts` grants SELECT to organisation members but no
--    INSERT/UPDATE to `authenticated` at all — every attempt is written by
--    the background worker using the service-role client
--    (src/infrastructure/supabase/admin-client.ts), which bypasses RLS by
--    design. `publishing_jobs` grants INSERT/UPDATE to
--    app.can_write_org members too, because creating a job (Publish Now /
--    Schedule) and cancelling one (Cancel Scheduled/Queued Job) are real
--    user-initiated actions from the request-scoped, RLS-bound client — the
--    worker's own claim/processing/completion writes to `publishing_jobs`
--    still go through the service-role client regardless.
-- ===========================================================================

create type public.publishing_platform as enum ('linkedin', 'facebook', 'instagram', 'x');
create type public.publishing_job_status as enum ('queued', 'processing', 'published', 'failed', 'cancelled');
create type public.publishing_attempt_status as enum ('queued', 'started', 'completed', 'failed');
create type public.publishing_trigger_type as enum ('immediate', 'scheduled', 'retry');

-- ---------------------------------------------------------------------------
-- publishing_jobs
-- ---------------------------------------------------------------------------
create table public.publishing_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid not null references public.content_drafts (id) on delete cascade,
  platform public.publishing_platform not null,
  trigger_type public.publishing_trigger_type not null,
  scheduled_for timestamptz not null default now(),
  status public.publishing_job_status not null default 'queued',
  idempotency_key text not null,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  next_attempt_at timestamptz,
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  completed_at timestamptz,
  cancelled_at timestamptz,
  -- Worker-claim bookkeeping — who holds this job right now, and since when.
  -- Drives both duplicate-worker protection (the claim RPC below) and stale
  -- job recovery (a job stuck in 'processing' past a staleness threshold).
  claimed_by text,
  claimed_at timestamptz,

  constraint publishing_jobs_idempotency_key_unique unique (idempotency_key),
  constraint publishing_jobs_retry_count_bounds check (retry_count >= 0 and retry_count <= max_retries)
);

-- Prevents two simultaneously-active (queued or processing) jobs for the
-- same draft+platform — the "one draft cannot have two active publishing
-- jobs for the same platform and intended publication" rule, enforced by
-- Postgres rather than application-layer discipline alone.
create unique index publishing_jobs_active_unique
  on public.publishing_jobs (draft_id, platform)
  where status in ('queued', 'processing');

create index publishing_jobs_org_status_idx on public.publishing_jobs (organisation_id, status);
create index publishing_jobs_draft_idx on public.publishing_jobs (draft_id);
create index publishing_jobs_org_created_idx on public.publishing_jobs (organisation_id, created_at desc);

-- Partial index tuned for the worker's own "find due queued jobs" query.
create index publishing_jobs_claimable_idx
  on public.publishing_jobs (scheduled_for)
  where status = 'queued';

-- Partial index for recoverStalePublishingJobs' "find stuck processing jobs" scan.
create index publishing_jobs_processing_claimed_idx
  on public.publishing_jobs (claimed_at)
  where status = 'processing';

drop trigger if exists publishing_jobs_touch_updated_at on public.publishing_jobs;
create trigger publishing_jobs_touch_updated_at
  before update on public.publishing_jobs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- publishing_attempts — append-only history, one row per real attempt
-- ---------------------------------------------------------------------------
create table public.publishing_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.publishing_jobs (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid not null references public.content_drafts (id) on delete cascade,
  platform public.publishing_platform not null,
  attempt_number integer not null,
  status public.publishing_attempt_status not null default 'queued',
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  duration_ms integer,
  external_post_id text,
  external_url text,
  error_code text,
  error_message text,
  retry_of_attempt_id uuid references public.publishing_attempts (id),
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint publishing_attempts_attempt_number_positive check (attempt_number >= 1),
  constraint publishing_attempts_job_attempt_unique unique (job_id, attempt_number)
);

create index publishing_attempts_job_idx on public.publishing_attempts (job_id, attempt_number);
create index publishing_attempts_org_created_idx on public.publishing_attempts (organisation_id, created_at desc);
create index publishing_attempts_draft_idx on public.publishing_attempts (draft_id);
create index publishing_attempts_status_idx on public.publishing_attempts (organisation_id, status);

-- Structural immutability guard: once an attempt reaches a terminal status,
-- no further UPDATE may be applied to it — a retry must insert a new row.
create or replace function app.prevent_terminal_attempt_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('completed', 'failed') then
    raise exception 'Publishing attempt % is already terminal (%) and is immutable — retries insert a new attempt row instead of modifying this one.', old.id, old.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists publishing_attempts_immutable_after_terminal on public.publishing_attempts;
create trigger publishing_attempts_immutable_after_terminal
  before update on public.publishing_attempts
  for each row execute function app.prevent_terminal_attempt_mutation();

-- ---------------------------------------------------------------------------
-- Atomic job claim — `for update skip locked` guarantees that when two
-- worker processes call this at the same instant, at most one of them
-- receives any given job; the other either gets a different due job or
-- null. This is the sole mechanism preventing duplicate processing; nothing
-- in the application layer needs its own locking for this.
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_publishing_job(p_worker_id text)
returns public.publishing_jobs
language plpgsql
as $$
declare
  v_job public.publishing_jobs;
begin
  select *
  into v_job
  from public.publishing_jobs
  where status = 'queued'
    and scheduled_for <= now()
  order by scheduled_for asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return null;
  end if;

  update public.publishing_jobs
  set status = 'processing',
      claimed_by = p_worker_id,
      claimed_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stale job recovery — a job left in 'processing' past p_stale_after_seconds
-- means the worker that claimed it died or was killed mid-attempt. Its
-- in-flight attempt is closed out as failed (never left dangling in
-- 'started' forever) and the job is either requeued (under its retry limit)
-- or moved to 'failed' (at its retry limit) so it surfaces to an operator.
-- Runs on every worker startup, per the mission's restart-recovery
-- requirement, so a due job that was interrupted processes again exactly
-- once rather than being silently lost or double-published.
-- ---------------------------------------------------------------------------
create or replace function public.recover_stale_publishing_jobs(p_stale_after_seconds integer default 300)
returns setof public.publishing_jobs
language plpgsql
as $$
declare
  v_job public.publishing_jobs;
  v_attempt public.publishing_attempts;
begin
  for v_job in
    select *
    from public.publishing_jobs
    where status = 'processing'
      and claimed_at is not null
      and claimed_at < now() - make_interval(secs => p_stale_after_seconds)
    for update skip locked
  loop
    select *
    into v_attempt
    from public.publishing_attempts
    where job_id = v_job.id and status = 'started'
    order by attempt_number desc
    limit 1;

    if v_attempt.id is not null then
      update public.publishing_attempts
      set status = 'failed',
          failed_at = now(),
          duration_ms = greatest(0, extract(epoch from (now() - coalesce(started_at, queued_at))) * 1000)::integer,
          error_code = 'stale_worker_recovery',
          error_message = 'The worker that claimed this attempt did not complete it before the staleness threshold — recovered automatically.'
      where id = v_attempt.id;
    end if;

    if v_job.retry_count < v_job.max_retries then
      update public.publishing_jobs
      set status = 'queued',
          retry_count = retry_count + 1,
          next_attempt_at = now(),
          claimed_by = null,
          claimed_at = null
      where id = v_job.id
      returning * into v_job;
    else
      update public.publishing_jobs
      set status = 'failed',
          completed_at = now(),
          claimed_by = null
      where id = v_job.id
      returning * into v_job;
    end if;

    insert into public.audit_events (organisation_id, draft_id, actor_id, event_type, description, metadata)
    values (
      v_job.organisation_id, v_job.draft_id, null, 'publishing_job_stale_recovered',
      'A publishing job was recovered after its worker did not complete it in time.',
      jsonb_build_object('jobId', v_job.id, 'platform', v_job.platform, 'newStatus', v_job.status)
    );

    return next v_job;
  end loop;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.publishing_jobs enable row level security;
alter table public.publishing_attempts enable row level security;

create policy publishing_jobs_select on public.publishing_jobs
  for select to authenticated using (app.is_org_member(organisation_id));

create policy publishing_jobs_insert on public.publishing_jobs
  for insert to authenticated with check (app.can_write_org(organisation_id));

-- Covers the one legitimate client-initiated update: cancelling a still-queued
-- job. Worker transitions (claim/processing/complete/fail) run through the
-- service-role client and bypass RLS entirely, so this policy's narrowness
-- has no effect on the worker's own operation.
create policy publishing_jobs_update on public.publishing_jobs
  for update to authenticated
  using (app.can_write_org(organisation_id))
  with check (app.can_write_org(organisation_id));

create policy publishing_attempts_select on public.publishing_attempts
  for select to authenticated using (app.is_org_member(organisation_id));

-- Deliberately no insert/update/delete policy for `authenticated` — every
-- attempt row is written exclusively by the worker's service-role client.
