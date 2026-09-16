-- Fail-closed claim isolation for live-authorised publishing jobs.
-- Legacy callers can claim simulation jobs only.
create table public.publishing_worker_generations (
  generation_id text primary key check (btrim(generation_id) <> ''),
  live_publishing_capable boolean not null default false,
  capability_proof_sha256 text not null check (capability_proof_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('active', 'draining', 'retired')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (valid_until > valid_from)
);

create unique index publishing_worker_one_active_generation
  on public.publishing_worker_generations ((true)) where status = 'active';
alter table public.publishing_worker_generations enable row level security;

-- Append-only operator evidence. A reconciliation is valid only while its
-- exact sorted attempt set still equals every prior ambiguous/submitted row.
create table public.publishing_duplicate_reconciliations (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.publishing_jobs(id) on delete restrict,
  reconciled_attempt_ids uuid[] not null check (cardinality(reconciled_attempt_ids) > 0),
  disposition text not null check (disposition in ('safe_to_submit', 'already_published', 'ambiguous')),
  rationale text not null check (btrim(rationale) <> ''),
  reconciled_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(job_id, reconciled_attempt_ids, disposition)
);
alter table public.publishing_duplicate_reconciliations enable row level security;

create or replace function app.prevent_publishing_reconciliation_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Publishing duplicate reconciliation evidence is immutable' using errcode = '42501';
end;
$$;
create trigger publishing_duplicate_reconciliations_immutable
  before update or delete on public.publishing_duplicate_reconciliations
  for each row execute function app.prevent_publishing_reconciliation_mutation();

alter table public.publishing_jobs
  add column claimed_generation_id text references public.publishing_worker_generations(generation_id) on delete restrict;

create or replace function public.claim_next_publishing_job(p_worker_id text)
returns setof public.publishing_jobs
language plpgsql
as $$
declare v_job public.publishing_jobs;
begin
  select j.* into v_job
  from public.publishing_jobs j
  where j.status = 'queued'
    and j.scheduled_for <= now()
    and coalesce(j.next_attempt_at, j.scheduled_for) <= now()
    and j.execution_mode = 'simulation'
  order by j.scheduled_for, j.id
  for update of j skip locked
  limit 1;
  if v_job.id is null then return; end if;
  update public.publishing_jobs set status = 'processing', claimed_by = p_worker_id,
    claimed_at = now(), pre_submission_recovery = false, claimed_generation_id = null
    where id = v_job.id returning * into v_job;
  return next v_job;
end;
$$;

drop function if exists public.claim_pre_submission_publishing_job(text);
create or replace function public.claim_pre_submission_publishing_job(
  p_worker_id text,
  p_live_publishing_enabled boolean default false,
  p_worker_generation text default null,
  p_live_capability_proof text default null
) returns setof public.publishing_jobs language plpgsql as $$
declare v_job public.publishing_jobs;
begin
  select j.* into v_job
  from public.publishing_jobs j
  where j.status = 'queued'
    and j.scheduled_for <= now()
    and coalesce(j.next_attempt_at, j.scheduled_for) <= now()
    and (
      j.execution_mode = 'simulation'
      or (j.execution_mode = 'live' and p_live_publishing_enabled is true and exists (
        select 1 from public.publishing_worker_generations g
        where g.generation_id = p_worker_generation
          and g.status = 'active'
          and g.live_publishing_capable is true
          and g.valid_from <= now()
          and g.valid_until > now()
          and nullif(p_live_capability_proof, '') is not null
          and g.capability_proof_sha256 = encode(extensions.digest(p_live_capability_proof, 'sha256'), 'hex')
      ) and (
        not exists (
          select 1 from public.publishing_attempts a
          where a.draft_id = j.draft_id and a.platform = j.platform
            and (a.status in ('completed', 'awaiting_confirmation')
              or a.external_post_id is not null
              or a.provider_metadata ? 'postSubmissionId'
              or a.provider_metadata ? 'submissionOutcome'
              or a.provider_metadata->>'providerSubmissionAuthorized' = 'true')
        )
        or exists (
          select 1 from public.publishing_duplicate_reconciliations r
          where r.job_id = j.id and r.disposition = 'safe_to_submit'
            and r.reconciled_attempt_ids = (
              select array_agg(a.id order by a.id)
              from public.publishing_attempts a
              where a.draft_id = j.draft_id and a.platform = j.platform
                and (a.status in ('completed', 'awaiting_confirmation')
                  or a.external_post_id is not null
                  or a.provider_metadata ? 'postSubmissionId'
                  or a.provider_metadata ? 'submissionOutcome'
                  or a.provider_metadata->>'providerSubmissionAuthorized' = 'true')
            )
        )
      ))
    )
  order by j.scheduled_for, j.id
  for update of j skip locked
  limit 1;
  if v_job.id is null then return; end if;
  if v_job.execution_mode = 'live' then
    -- Re-read capability and receipt evidence after taking the job lock so a
    -- generation transition or newly committed attempt cannot race claim.
    perform 1 from public.publishing_worker_generations g
      where g.generation_id = p_worker_generation
        and g.status = 'active'
        and g.live_publishing_capable is true
        and g.valid_from <= now()
        and g.valid_until > now()
        and nullif(p_live_capability_proof, '') is not null
        and g.capability_proof_sha256 = encode(extensions.digest(p_live_capability_proof, 'sha256'), 'hex')
      for share;
    if not found then return; end if;
    if exists (
      select 1 from public.publishing_attempts a
      where a.draft_id = v_job.draft_id and a.platform = v_job.platform
        and (a.status in ('completed', 'awaiting_confirmation')
          or a.external_post_id is not null
          or a.provider_metadata ? 'postSubmissionId'
          or a.provider_metadata ? 'submissionOutcome'
          or a.provider_metadata->>'providerSubmissionAuthorized' = 'true')
    ) and not exists (
      select 1 from public.publishing_duplicate_reconciliations r
      where r.job_id = v_job.id and r.disposition = 'safe_to_submit'
        and r.reconciled_attempt_ids = (
          select array_agg(a.id order by a.id)
          from public.publishing_attempts a
          where a.draft_id = v_job.draft_id and a.platform = v_job.platform
            and (a.status in ('completed', 'awaiting_confirmation')
              or a.external_post_id is not null
              or a.provider_metadata ? 'postSubmissionId'
              or a.provider_metadata ? 'submissionOutcome'
              or a.provider_metadata->>'providerSubmissionAuthorized' = 'true')
        )
    ) then return;
    end if;
  end if;
  update public.publishing_jobs set status = 'processing', claimed_by = p_worker_id,
    claimed_at = now(), pre_submission_recovery = true,
    claimed_generation_id = case when v_job.execution_mode = 'live' then p_worker_generation else null end
    where id = v_job.id returning * into v_job;
  return next v_job;
end;
$$;

revoke all on function public.claim_pre_submission_publishing_job(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_pre_submission_publishing_job(text, boolean, text, text) to service_role;

drop function if exists public.begin_publishing_submission(uuid, uuid, text);
create or replace function public.begin_publishing_submission(
  p_job_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_worker_generation text default null,
  p_live_capability_proof text default null
) returns void language plpgsql as $$
declare
  v_job public.publishing_jobs;
  v_attempt public.publishing_attempts;
begin
  select * into strict v_job from public.publishing_jobs where id = p_job_id for update;
  select * into strict v_attempt from public.publishing_attempts
    where id = p_attempt_id and job_id = p_job_id for update;
  perform 1 from public.publishing_worker_generations g
    where g.generation_id = p_worker_generation
      and g.status = 'active'
      and g.live_publishing_capable is true
      and g.valid_from <= now()
      and g.valid_until > now()
      and nullif(p_live_capability_proof, '') is not null
      and g.capability_proof_sha256 = encode(extensions.digest(p_live_capability_proof, 'sha256'), 'hex')
    for share;
  if not found then
    raise exception 'Publishing claim is no longer eligible for live submission';
  end if;
  if v_job.execution_mode <> 'live'
     or v_job.status <> 'processing'
     or v_job.claimed_by is distinct from p_worker_id
     or v_job.claimed_generation_id is distinct from p_worker_generation
     or not v_job.pre_submission_recovery
     or v_attempt.status <> 'started'
     or v_attempt.organisation_id <> v_job.organisation_id
     or v_attempt.draft_id <> v_job.draft_id
     or v_attempt.platform <> v_job.platform
     or (
       exists (
         select 1 from public.publishing_attempts a
         where a.draft_id = v_job.draft_id and a.platform = v_job.platform
           and (a.status in ('completed', 'awaiting_confirmation')
             or a.external_post_id is not null
             or a.provider_metadata ? 'postSubmissionId'
             or a.provider_metadata ? 'submissionOutcome'
             or a.provider_metadata->>'providerSubmissionAuthorized' = 'true')
       )
       and not exists (
         select 1 from public.publishing_duplicate_reconciliations r
         where r.job_id = v_job.id and r.disposition = 'safe_to_submit'
           and r.reconciled_attempt_ids = (
             select array_agg(a.id order by a.id)
             from public.publishing_attempts a
             where a.draft_id = v_job.draft_id and a.platform = v_job.platform
               and (a.status in ('completed', 'awaiting_confirmation')
                 or a.external_post_id is not null
                 or a.provider_metadata ? 'postSubmissionId'
                 or a.provider_metadata ? 'submissionOutcome'
                 or a.provider_metadata->>'providerSubmissionAuthorized' = 'true')
           )
       )
     ) then
    raise exception 'Publishing claim is no longer eligible for live submission';
  end if;
  update public.publishing_jobs set status = 'awaiting_confirmation',
    pre_submission_recovery = false, awaiting_confirmation_since = now(),
    next_status_check_at = null, completed_at = null where id = p_job_id;
  update public.publishing_attempts set status = 'awaiting_confirmation',
    provider_metadata = jsonb_build_object(
      'submissionOutcome', 'unknown',
      'providerSubmissionAuthorized', true,
      'workerGeneration', p_worker_generation
    ) where id = p_attempt_id;
end;
$$;

revoke all on function public.begin_publishing_submission(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_publishing_submission(uuid, uuid, text, text, text) to service_role;

create or replace function app.enforce_publishing_attempt_semantics()
returns trigger language plpgsql as $$
declare
  v_job public.publishing_jobs;
  v_reconciled_from public.publishing_attempts;
begin
  if new.status not in ('awaiting_confirmation', 'completed') then return new; end if;
  select * into strict v_job from public.publishing_jobs where id = new.job_id;
  if new.organisation_id <> v_job.organisation_id
     or new.draft_id <> v_job.draft_id
     or new.platform <> v_job.platform then
    raise exception 'Publishing attempt identity does not match its job';
  end if;
  if v_job.execution_mode = 'live' then
    if new.provider_metadata->'simulated' = 'true'::jsonb
       or lower(coalesce(new.external_post_id, '')) like 'mock-%'
       or position('mock.local' in lower(coalesce(new.external_url, ''))) > 0 then
      raise exception 'Live publication requires authorised non-simulation provider evidence';
    end if;
    if new.provider_metadata->'providerSubmissionAuthorized' is distinct from 'true'::jsonb then
      -- The sole compatibility path is append-only reconciliation of an exact
      -- pre-existing provider timeout receipt. It confirms prior submission;
      -- it does not authorise or perform a new provider submission.
      if tg_op <> 'INSERT'
         or new.status <> 'completed'
         or new.retry_of_attempt_id is null
         or new.provider_metadata->>'reconciledFromAttemptId' is distinct from new.retry_of_attempt_id::text
         or new.provider_metadata->>'postSubmissionId' is distinct from new.external_post_id then
        raise exception 'Live publication requires authorised non-simulation provider evidence';
      end if;
      select * into v_reconciled_from from public.publishing_attempts
        where id = new.retry_of_attempt_id
          and job_id = new.job_id
          and organisation_id = new.organisation_id
          and draft_id = new.draft_id
          and platform = new.platform
          and status = 'failed'
          and error_code = 'blotato_status_timeout'
          and provider_metadata->>'postSubmissionId' = new.external_post_id
          and (external_post_id is null or external_post_id = new.external_post_id);
      if not found then
        raise exception 'Live publication requires authorised non-simulation provider evidence';
      end if;
    end if;
    if new.status = 'completed' and nullif(btrim(new.external_post_id), '') is null then
      raise exception 'Live publication requires a provider receipt';
    end if;
  else
    if new.status = 'awaiting_confirmation'
       or new.provider_metadata->'simulated' is distinct from 'true'::jsonb
       or coalesce(new.external_post_id, '') not like 'mock-%'
       or lower(coalesce(new.external_url, '')) !~ '^https://mock[.]local([/:]|$)' then
      raise exception 'Simulation settlement requires explicit mock semantics';
    end if;
  end if;
  return new;
end;
$$;

-- Sort after the existing immutable-terminal trigger so historical terminal
-- rows retain its established 42501 rejection before this semantic guard.
create trigger zz_publishing_attempts_enforce_execution_semantics
  before insert or update on public.publishing_attempts
  for each row execute function app.enforce_publishing_attempt_semantics();

-- Attempt evidence is append-only once it can affect settlement or duplicate
-- reconciliation. A child BEFORE DELETE trigger also aborts job/draft/organisation
-- ON DELETE CASCADE operations before they can erase historical evidence.
create or replace function app.prevent_publishing_attempt_evidence_deletion()
returns trigger language plpgsql as $$
begin
  if old.status in ('completed', 'failed')
     or old.external_post_id is not null
     or old.external_url is not null
     or old.provider_metadata ? 'postSubmissionId'
     or old.provider_metadata ? 'submissionOutcome'
     or old.provider_metadata ? 'simulated'
     or old.provider_metadata->>'providerSubmissionAuthorized' = 'true' then
    raise exception 'Publishing attempt evidence is immutable and cannot be deleted'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger publishing_attempts_preserve_evidence_on_delete
  before delete on public.publishing_attempts
  for each row execute function app.prevent_publishing_attempt_evidence_deletion();
