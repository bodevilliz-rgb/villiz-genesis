-- Service-role repair of an already-submitted legacy timeout. This is NOT a
-- queue/claim path. Keep settle_publishing_receipt's live-state guards intact.
create or replace function public.reconcile_failed_publishing_timeout(
  p_organisation_id uuid, p_job_id uuid, p_attempt_id uuid,
  p_post_submission_id text, p_external_url text, p_actor_id uuid,
  p_outcome text default 'published', p_error_message text default null
) returns public.publishing_jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.publishing_jobs;
  v_old public.publishing_attempts;
  v_latest public.publishing_attempts;
  v_new_id uuid;
begin
  if p_outcome is null or p_outcome not in ('published', 'failed') then
    raise exception 'Invalid reconciliation outcome';
  end if;
  -- Serializes concurrent repairs and retry/claim updates to this job.
  select * into v_job from public.publishing_jobs
    where id = p_job_id and organisation_id = p_organisation_id for update;
  if not found or v_job.execution_mode <> 'live' then
    raise exception 'No eligible live publishing job';
  end if;
  select * into v_old from public.publishing_attempts
    where id = p_attempt_id and job_id = v_job.id and organisation_id = v_job.organisation_id
      and draft_id = v_job.draft_id and platform = v_job.platform;
  if not found or v_old.status <> 'failed' or v_old.error_code is distinct from 'blotato_status_timeout'
    or jsonb_typeof(v_old.provider_metadata->'postSubmissionId') is distinct from 'string'
    or nullif(btrim(p_post_submission_id), '') is null
    or v_old.provider_metadata->>'postSubmissionId' is distinct from p_post_submission_id
    or (v_old.external_post_id is not null and v_old.external_post_id <> p_post_submission_id) then
    raise exception 'Invalid legacy timeout attempt or provider receipt';
  end if;
  select * into v_latest from public.publishing_attempts
    where job_id = v_job.id order by attempt_number desc limit 1;
  if ((p_outcome = 'published' and v_job.status = 'published' and v_latest.status = 'completed')
      or (p_outcome = 'failed' and v_job.status = 'failed' and v_latest.status = 'failed'
        and v_latest.error_code = 'blotato_publish_failed'))
    and v_latest.retry_of_attempt_id = v_old.id
    and v_latest.provider_metadata->>'reconciledFromAttemptId' = v_old.id::text
    and v_latest.provider_metadata->>'postSubmissionId' = p_post_submission_id
    and v_latest.external_post_id = p_post_submission_id then
    return v_job; -- Lost response/restart/concurrent second caller: no writes.
  end if;
  if v_job.status <> 'failed' or v_latest.id <> v_old.id then
    raise exception 'Job or latest attempt no longer eligible for reconciliation';
  end if;

  -- Insert terminal directly: no independently visible queued/started attempt.
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform,
    attempt_number, status, started_at, completed_at, duration_ms, external_post_id,
    external_url, retry_of_attempt_id, provider_metadata, failed_at, error_code, error_message)
  values(v_job.id, v_job.organisation_id, v_job.draft_id, v_job.platform,
    v_old.attempt_number + 1, case when p_outcome = 'failed' then 'failed'::public.publishing_attempt_status else 'completed'::public.publishing_attempt_status end,
    now(), case when p_outcome = 'published' then now() end, 0, p_post_submission_id,
    p_external_url, v_old.id, v_old.provider_metadata ||
      jsonb_build_object('reconciledFromAttemptId', v_old.id),
    case when p_outcome = 'failed' then now() end,
    case when p_outcome = 'failed' then 'blotato_publish_failed' end,
    case when p_outcome = 'failed' then coalesce(p_error_message, 'Provider confirmed failure') end)
  returning id into v_new_id;
  update public.publishing_jobs set status = p_outcome::public.publishing_job_status, completed_at = now(),
    next_status_check_at = null, pre_submission_recovery = false
    where id = v_job.id returning * into v_job;
  update public.content_drafts set status = p_outcome::public.content_draft_status, updated_by = v_job.requested_by
    where id = v_job.draft_id and organisation_id = v_job.organisation_id;
  if not found then raise exception 'Reconciliation draft missing'; end if;
  insert into public.audit_events(organisation_id, draft_id, actor_id, event_type, description, metadata)
    values(v_job.organisation_id, v_job.draft_id, p_actor_id, 'publishing_attempt_reconciled',
      'Provider confirmed a legacy timeout as ' || p_outcome || '; no new post was submitted.',
      jsonb_build_object('jobId', v_job.id, 'attemptId', v_new_id, 'retryOfAttemptId', v_old.id,
        'postSubmissionId', p_post_submission_id, 'outcome', case when p_outcome = 'failed' then 'confirmed_failed' else 'published' end,
        'errorMessage', p_error_message));
  -- Preserve the existing best-effort success notification, but only the
  -- winning transaction can create it. Notification failure cannot undo repair.
  if p_outcome = 'published' and v_job.requested_by is not null then
    begin
      insert into public.notifications(organisation_id, profile_id, type, message)
        values(v_job.organisation_id, v_job.requested_by, 'publish_succeeded',
          'Your ' || case v_job.platform when 'instagram' then 'Instagram' when 'facebook' then 'Facebook' when 'tiktok' then 'TikTok' else v_job.platform::text end ||
          ' publish succeeded (confirmed after a delayed provider status). ' || coalesce(p_external_url, ''));
    exception when others then
      null;
    end;
  end if;
  return v_job;
end;
$$;
revoke all on function public.reconcile_failed_publishing_timeout(uuid, uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reconcile_failed_publishing_timeout(uuid, uuid, uuid, text, text, uuid, text, text) to service_role;
