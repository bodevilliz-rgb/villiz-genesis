-- Supported, transactional operations for immediate publishing and worker
-- generation rotation. These functions replace operator-authored SQL so the
-- application has one reviewed path for each state transition.

-- Awaiting confirmation is still an active publication: the provider may
-- already have accepted it. It must block a second job for the same
-- draft/platform until that receipt reaches a terminal state.
drop index if exists public.publishing_jobs_active_unique;
create unique index publishing_jobs_active_unique
  on public.publishing_jobs (draft_id, platform)
  where status in ('queued', 'processing', 'awaiting_confirmation');

create or replace function public.enqueue_immediate_publishing_job(
  p_organisation_id uuid,
  p_draft_id uuid,
  p_expected_draft_version integer,
  p_platform public.publishing_platform,
  p_idempotency_key text,
  p_requested_by uuid,
  p_max_retries integer,
  p_dev_simulation_mode public.publishing_simulation_mode,
  p_resolved_account_id text,
  p_execution_mode public.publishing_execution_mode,
  p_is_ai_generated boolean,
  p_is_your_brand boolean,
  p_is_branded_content boolean
)
returns setof public.publishing_jobs
language plpgsql
security invoker
as $$
declare
  v_draft public.content_drafts;
  v_job public.publishing_jobs;
  v_created boolean := false;
  v_blotato_platform text;
begin
  if (select auth.uid()) is null
     or p_requested_by is distinct from (select auth.uid())
     or not app.can_write_org(p_organisation_id) then
    raise exception 'Not authorised to queue publishing for this organisation'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'A non-empty publishing idempotency key is required'
      using errcode = '22023';
  end if;
  if p_max_retries < 0 then
    raise exception 'Publishing max retries cannot be negative'
      using errcode = '22023';
  end if;
  -- The draft lock serialises competing immediate-publish requests. The
  -- active-job lookup deliberately happens after this lock.
  select drafts.* into v_draft
  from public.content_drafts as drafts
  where drafts.id = p_draft_id
    and drafts.organisation_id = p_organisation_id
  for update of drafts;

  if v_draft.id is null then
    raise exception 'Publishing draft was not found'
      using errcode = 'P0002';
  end if;

  select jobs.* into v_job
  from public.publishing_jobs as jobs
  where jobs.idempotency_key = p_idempotency_key;

  if v_job.id is not null then
    if v_job.organisation_id is distinct from p_organisation_id
       or v_job.draft_id is distinct from p_draft_id
       or v_job.platform is distinct from p_platform then
      raise exception 'Publishing idempotency key is already bound to another request'
        using errcode = '23505';
    end if;
    return next v_job;
    return;
  end if;

  select jobs.* into v_job
  from public.publishing_jobs as jobs
  where jobs.draft_id = p_draft_id
    and jobs.platform = p_platform
    and jobs.status in ('queued', 'processing', 'awaiting_confirmation')
  limit 1;

  if v_job.id is not null then
    return next v_job;
    return;
  end if;

  if v_draft.status not in ('approved', 'scheduled', 'failed') then
    raise exception 'Only approved, scheduled, or failed content can be published'
      using errcode = '22023';
  end if;
  if p_expected_draft_version is null
     or v_draft.version is distinct from p_expected_draft_version then
    raise exception 'Draft changed after publishing readiness was assessed'
      using errcode = '40001';
  end if;

  if nullif(btrim(p_resolved_account_id), '') is null then
    raise exception 'An active destination account is required for publishing'
      using errcode = '22023';
  end if;

  v_blotato_platform := case
    when p_platform = 'x' then 'twitter'
    else p_platform::text
  end;
  perform 1
  from public.blotato_accounts as accounts
  where accounts.blotato_account_id = p_resolved_account_id
    and accounts.organisation_id = p_organisation_id
    and accounts.platform = v_blotato_platform
    and accounts.active is true
    and accounts.provider_active is true
  for share of accounts;
  if not found then
    raise exception 'The selected publishing destination is unavailable for this organisation and platform'
      using errcode = '22023';
  end if;

  begin
    insert into public.publishing_jobs as jobs (
      organisation_id,
      draft_id,
      platform,
      trigger_type,
      scheduled_for,
      idempotency_key,
      requested_by,
      max_retries,
      dev_simulation_mode,
      resolved_account_id,
      execution_mode,
      is_ai_generated,
      is_your_brand,
      is_branded_content
    )
    values (
      p_organisation_id,
      p_draft_id,
      p_platform,
      'immediate',
      now(),
      p_idempotency_key,
      p_requested_by,
      p_max_retries,
      p_dev_simulation_mode,
      p_resolved_account_id,
      p_execution_mode,
      p_is_ai_generated,
      p_is_your_brand,
      p_is_branded_content
    )
    returning jobs.* into v_job;
    v_created := true;
  exception when unique_violation then
    select jobs.* into v_job
    from public.publishing_jobs as jobs
    where jobs.idempotency_key = p_idempotency_key
       or (
         jobs.draft_id = p_draft_id
         and jobs.platform = p_platform
         and jobs.status in ('queued', 'processing', 'awaiting_confirmation')
       )
    order by (jobs.idempotency_key = p_idempotency_key) desc
    limit 1;

    if v_job.id is null
       or v_job.organisation_id is distinct from p_organisation_id
       or v_job.draft_id is distinct from p_draft_id
       or v_job.platform is distinct from p_platform then
      raise;
    end if;
  end;

  if v_created then
    update public.content_drafts as drafts
    set status = 'publishing',
        updated_by = p_requested_by
    where drafts.id = p_draft_id
      and drafts.organisation_id = p_organisation_id;

    insert into public.audit_events as events (
      organisation_id,
      draft_id,
      actor_id,
      event_type,
      description,
      metadata
    )
    values (v_job.organisation_id,
      v_job.draft_id,
      p_requested_by,
      'publishing_job_queued',
      'Queued an immediate publish to ' || initcap(v_job.platform::text) || '.',
      jsonb_build_object(
        'jobId', v_job.id,
        'platform', v_job.platform,
        'triggerType', 'immediate'
      )
    );
  end if;

  return next v_job;
end;
$$;

revoke all on function public.enqueue_immediate_publishing_job(
  uuid, uuid, integer, public.publishing_platform, text, uuid, integer,
  public.publishing_simulation_mode, text, public.publishing_execution_mode,
  boolean, boolean, boolean
) from public, anon;
grant execute on function public.enqueue_immediate_publishing_job(
  uuid, uuid, integer, public.publishing_platform, text, uuid, integer,
  public.publishing_simulation_mode, text, public.publishing_execution_mode,
  boolean, boolean, boolean
) to authenticated, service_role;

create or replace function public.rotate_publishing_worker_generation(
  p_expected_generation_id text,
  p_new_generation_id text,
  p_capability_proof_sha256 text,
  p_valid_until timestamptz
)
returns setof public.publishing_worker_generations
language plpgsql
security invoker
as $$
declare
  v_active public.publishing_worker_generations;
  v_previous public.publishing_worker_generations;
  v_generation public.publishing_worker_generations;
begin
  if nullif(btrim(p_expected_generation_id), '') is null
     or nullif(btrim(p_new_generation_id), '') is null
     or p_expected_generation_id = p_new_generation_id then
    raise exception 'Expected and new generation IDs must be distinct and non-empty'
      using errcode = '22023';
  end if;
  if p_capability_proof_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Capability proof hash must be lowercase SHA-256 hex'
      using errcode = '22023';
  end if;
  if p_valid_until <= now() + interval '1 day'
     or p_valid_until > now() + interval '31 days' then
    raise exception 'Generation validity must be greater than one day and no more than 31 days'
      using errcode = '22023';
  end if;

  select generations.* into v_active
  from public.publishing_worker_generations as generations
  where generations.status = 'active'
  for update of generations;

  if v_active.generation_id is not null
     and v_active.generation_id is distinct from p_expected_generation_id then
    raise exception 'Active publishing generation changed; rotation aborted'
      using errcode = '40001';
  end if;

  select generations.* into v_previous
  from public.publishing_worker_generations as generations
  where generations.generation_id = p_expected_generation_id
  for update of generations;

  if v_previous.generation_id is null then
    raise exception 'Expected publishing generation was not found; rotation aborted'
      using errcode = 'P0002';
  end if;

  update public.publishing_worker_generations as generations
  set status = 'retired'
  where generations.generation_id = p_expected_generation_id;

  insert into public.publishing_worker_generations as generations (
    generation_id,
    live_publishing_capable,
    capability_proof_sha256,
    status,
    valid_from,
    valid_until
  )
  values (
    p_new_generation_id,
    true,
    p_capability_proof_sha256,
    'active',
    now(),
    p_valid_until
  )
  returning generations.* into v_generation;

  return next v_generation;
end;
$$;

create or replace function public.rollback_publishing_worker_generation(
  p_failed_generation_id text,
  p_previous_generation_id text
)
returns setof public.publishing_worker_generations
language plpgsql
security invoker
as $$
declare
  v_failed public.publishing_worker_generations;
  v_previous public.publishing_worker_generations;
begin
  select generations.* into v_failed
  from public.publishing_worker_generations as generations
  where generations.generation_id = p_failed_generation_id
  for update of generations;

  if v_failed.generation_id is null or v_failed.status <> 'active' then
    raise exception 'Failed generation is not the active generation; rollback aborted'
      using errcode = '40001';
  end if;

  select generations.* into v_previous
  from public.publishing_worker_generations as generations
  where generations.generation_id = p_previous_generation_id
  for update of generations;

  if v_previous.generation_id is null or v_previous.status <> 'retired' then
    raise exception 'Previous generation is not available for rollback'
      using errcode = '40001';
  end if;

  update public.publishing_worker_generations as generations
  set status = 'retired'
  where generations.generation_id = p_failed_generation_id;

  update public.publishing_worker_generations as generations
  set status = 'active'
  where generations.generation_id = p_previous_generation_id
  returning generations.* into v_previous;

  return next v_previous;
end;
$$;

revoke all on function public.rotate_publishing_worker_generation(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.rollback_publishing_worker_generation(text, text)
  from public, anon, authenticated;
grant execute on function public.rotate_publishing_worker_generation(text, text, text, timestamptz)
  to service_role;
grant execute on function public.rollback_publishing_worker_generation(text, text)
  to service_role;
