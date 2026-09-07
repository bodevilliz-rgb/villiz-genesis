-- Only the Render caller that implements the durable pre-POST barrier opts in.
-- Existing processing rows and callers without the barrier remain excluded.
alter table public.publishing_jobs
  add column pre_submission_recovery boolean not null default false;
create index publishing_jobs_pre_submission_recovery_idx
  on public.publishing_jobs(claimed_at, id)
  where status = 'processing' and pre_submission_recovery;

-- Clear any opt-in left on an explicitly retried row for legacy callers.
create or replace function public.claim_next_publishing_job(p_worker_id text)
returns setof public.publishing_jobs
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
    and coalesce(next_attempt_at, scheduled_for) <= now()
  order by scheduled_for asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return;
  end if;

  update public.publishing_jobs
  set status = 'processing',
      claimed_by = p_worker_id,
      claimed_at = now(),
      pre_submission_recovery = false
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.claim_pre_submission_publishing_job(p_worker_id text)
returns setof public.publishing_jobs language plpgsql as $$
declare v_job public.publishing_jobs;
begin
  select * into v_job from public.claim_next_publishing_job(p_worker_id);
  if v_job.id is null then return; end if;
  update public.publishing_jobs set pre_submission_recovery = true
    where id = v_job.id returning * into v_job;
  return next v_job;
end;
$$;

-- Both recovery and submission lock job then attempt. A worker whose lease
-- was recovered cannot cross this barrier, even if its upload finishes late.
create or replace function public.begin_publishing_submission(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text
) returns void language plpgsql as $$
declare v_job public.publishing_jobs; v_attempt public.publishing_attempts;
begin
  select * into strict v_job from public.publishing_jobs where id = p_job_id for update;
  select * into strict v_attempt from public.publishing_attempts
    where id = p_attempt_id and job_id = p_job_id for update;
  if v_job.status <> 'processing' or v_job.claimed_by is distinct from p_worker_id
     or not v_job.pre_submission_recovery or v_attempt.status <> 'started' then
    raise exception 'Publishing claim is no longer eligible for submission';
  end if;
  update public.publishing_jobs set status = 'awaiting_confirmation',
    pre_submission_recovery = false, awaiting_confirmation_since = now(),
    next_status_check_at = null, completed_at = null where id = p_job_id;
  update public.publishing_attempts set status = 'awaiting_confirmation',
    provider_metadata = jsonb_build_object('submissionOutcome', 'unknown') where id = p_attempt_id;
end;
$$;

-- Owner-fenced failure settlement. Lock order matches submission and recovery.
-- Lost responses replay as no-ops; no partially failed job can escape recovery.
create or replace function public.settle_failed_publishing_claim(
  p_job_id uuid, p_worker_id text, p_error_code text, p_error_message text
) returns boolean language plpgsql as $$
declare v_job public.publishing_jobs;
begin
  select * into v_job from public.publishing_jobs where id = p_job_id for update;
  if not found or v_job.claimed_by is distinct from p_worker_id then return false; end if;
  if v_job.status = 'failed' then return true; end if;
  if v_job.status <> 'processing' or not v_job.pre_submission_recovery then return false; end if;
  perform id from public.publishing_attempts where job_id = p_job_id order by id for update;
  if exists (select 1 from public.publishing_attempts where job_id = p_job_id
    and (status in ('completed', 'awaiting_confirmation') or external_post_id is not null
      or provider_metadata ? 'postSubmissionId' or provider_metadata ? 'submissionOutcome')) then
    return false;
  end if;
  update public.publishing_jobs set status = 'failed', completed_at = now(),
    next_status_check_at = null, pre_submission_recovery = false where id = p_job_id;
  update public.publishing_attempts set status = 'failed', failed_at = now(),
    error_code = left(p_error_code, 128), error_message = left(p_error_message, 1024)
    where job_id = p_job_id and status in ('queued', 'started');
  update public.content_drafts set status = 'failed', updated_by = v_job.requested_by
    where id = v_job.draft_id and organisation_id = v_job.organisation_id;
  return true;
end;
$$;

-- One transaction owns receipt + schedule + terminal draft/job state.
-- Replaying a lost response skips immutable terminal attempts. Pending replay
-- does not reset the confirmation horizon or revive an already resolved job.
create or replace function public.settle_publishing_receipt(
  p_attempt_id uuid, p_outcome text, p_metadata jsonb,
  p_external_post_id text, p_external_url text
) returns public.publishing_attempts language plpgsql as $$
declare v_job public.publishing_jobs; v_attempt public.publishing_attempts;
begin
  select j.* into strict v_job from public.publishing_jobs j
    join public.publishing_attempts a on a.job_id = j.id
    where a.id = p_attempt_id for update of j;
  select * into strict v_attempt from public.publishing_attempts where id = p_attempt_id for update;
  if p_outcome is null or p_outcome not in ('pending', 'published', 'failed') then raise exception 'Invalid settlement outcome'; end if;
  if p_outcome = 'failed' then
    if v_job.execution_mode <> 'live'
      or p_metadata->'confirmedAfterAwaiting' is distinct from 'true'::jsonb
      or jsonb_typeof(p_metadata->'postSubmissionId') is distinct from 'string'
      or nullif(btrim(p_external_post_id), '') is null
      or p_metadata->>'postSubmissionId' is distinct from p_external_post_id
      or v_attempt.provider_metadata->>'postSubmissionId' is distinct from p_external_post_id
      or (v_attempt.external_post_id is not null and v_attempt.external_post_id <> p_external_post_id)
      or v_attempt.organisation_id <> v_job.organisation_id
      or v_attempt.draft_id <> v_job.draft_id or v_attempt.platform <> v_job.platform then
      raise exception 'Invalid confirmed provider failure receipt';
    end if;
    if v_attempt.status = 'failed' and v_attempt.error_code = 'blotato_publish_failed' then
      return v_attempt; -- Response loss, including replay after a governed retry.
    end if;
    if v_job.status <> 'awaiting_confirmation' or v_attempt.status <> 'awaiting_confirmation'
      or exists(select 1 from public.publishing_attempts
        where job_id = v_job.id and attempt_number > v_attempt.attempt_number) then
      raise exception 'Publishing job or attempt is not awaiting this confirmation';
    end if;
    update public.publishing_attempts set status = 'failed', failed_at = now(),
      duration_ms = greatest(0, extract(epoch from (now() - coalesce(started_at, queued_at))) * 1000)::integer,
      error_code = 'blotato_publish_failed',
      error_message = coalesce(p_metadata->>'errorMessage', 'Provider confirmed failure'),
      provider_metadata = provider_metadata || p_metadata
      where id = p_attempt_id returning * into v_attempt;
    update public.publishing_jobs set status = 'failed', completed_at = now(),
      next_status_check_at = null, pre_submission_recovery = false where id = v_job.id;
    update public.content_drafts set status = 'failed', updated_by = v_job.requested_by
      where id = v_job.draft_id and organisation_id = v_job.organisation_id;
    if not found then raise exception 'Confirmation draft missing'; end if;
    return v_attempt;
  end if;
  if v_attempt.status in ('completed', 'failed') then return v_attempt; end if;
  if v_job.status not in ('processing', 'awaiting_confirmation') then
    raise exception 'Publishing job is no longer eligible for settlement';
  end if;
  if p_outcome = 'pending' then
    if nullif(p_metadata->>'postSubmissionId', '') is null then raise exception 'Missing provider receipt'; end if;
    if v_attempt.provider_metadata->>'submissionOutcome' = 'accepted'
       and v_attempt.provider_metadata->>'postSubmissionId' = p_metadata->>'postSubmissionId' then
      return v_attempt; -- Includes a deliberately stopped confirmation schedule.
    end if;
    update public.publishing_attempts set status = 'awaiting_confirmation',
      provider_metadata = provider_metadata || p_metadata || '{"submissionOutcome":"accepted"}'::jsonb where id = p_attempt_id returning * into v_attempt;
    update public.publishing_jobs set status = 'awaiting_confirmation', pre_submission_recovery = false,
      awaiting_confirmation_since = coalesce(awaiting_confirmation_since, now()),
      next_status_check_at = coalesce(next_status_check_at, now() + interval '60 seconds')
      where id = v_job.id;
  else
    if nullif(p_external_post_id, '') is null then raise exception 'Missing provider receipt'; end if;
    update public.publishing_attempts set status = 'completed', completed_at = now(),
      duration_ms = greatest(0, extract(epoch from (now() - coalesce(started_at, queued_at))) * 1000)::integer,
      external_post_id = p_external_post_id, external_url = p_external_url,
      provider_metadata = provider_metadata || p_metadata where id = p_attempt_id returning * into v_attempt;
    update public.publishing_jobs set status = 'published', completed_at = now(),
      next_status_check_at = null, pre_submission_recovery = false where id = v_job.id;
    update public.content_drafts set status = 'published', updated_by = v_job.requested_by
      where id = v_job.draft_id and organisation_id = v_job.organisation_id;
  end if;
  return v_attempt;
end;
$$;

-- Finite batch, oldest first. No legacy or post-barrier processing row can
-- enter recovery. Retrying an expired pre-submission lease is safe only when
-- every observed attempt also lacks evidence of a submission.
create or replace function public.recover_stale_publishing_jobs(p_stale_after_seconds integer default 300)
returns setof public.publishing_jobs language plpgsql as $$
declare v_job public.publishing_jobs;
begin
  for v_job in
    select j.* from public.publishing_jobs j
    where j.status = 'processing' and j.pre_submission_recovery
      and j.claimed_at < now() - make_interval(secs => greatest(300, coalesce(p_stale_after_seconds, 300)))
      and not exists (select 1 from public.publishing_attempts a where a.job_id = j.id
        and (a.status in ('completed', 'awaiting_confirmation') or a.external_post_id is not null
             or a.provider_metadata ? 'postSubmissionId' or a.provider_metadata ? 'submissionOutcome'))
    order by j.claimed_at, j.id limit 25 for update of j skip locked
  loop
    update public.publishing_attempts set status = 'failed', failed_at = now(),
      error_code = 'stale_worker_recovery', error_message = 'Pre-submission worker lease expired.'
      where job_id = v_job.id and status in ('queued', 'started');
    update public.publishing_jobs set
      status = case when retry_count < max_retries then 'queued'::public.publishing_job_status else 'failed'::public.publishing_job_status end,
      retry_count = least(retry_count + 1, max_retries), next_attempt_at = now() + interval '60 seconds',
      completed_at = case when retry_count >= max_retries then now() else null end,
      claimed_by = null, claimed_at = null, pre_submission_recovery = false
      where id = v_job.id returning * into v_job;
    if v_job.status = 'failed' then
      update public.content_drafts set status = 'failed' where id = v_job.draft_id;
    end if;
    insert into public.audit_events(organisation_id, draft_id, actor_id, event_type, description, metadata)
      values(v_job.organisation_id, v_job.draft_id, null, 'publishing_job_stale_recovered',
        'Recovered an expired pre-submission worker lease.', jsonb_build_object('jobId', v_job.id, 'newStatus', v_job.status));
    return next v_job;
  end loop;
end;
$$;

revoke all on function public.claim_pre_submission_publishing_job(text) from public, anon, authenticated;
revoke all on function public.begin_publishing_submission(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.settle_publishing_receipt(uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.recover_stale_publishing_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_pre_submission_publishing_job(text) to service_role;
grant execute on function public.begin_publishing_submission(uuid, uuid, text) to service_role;
grant execute on function public.settle_publishing_receipt(uuid, text, jsonb, text, text) to service_role;
grant execute on function public.recover_stale_publishing_jobs(integer) to service_role;

revoke all on function public.settle_failed_publishing_claim(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.settle_failed_publishing_claim(uuid, text, text, text) to service_role;
