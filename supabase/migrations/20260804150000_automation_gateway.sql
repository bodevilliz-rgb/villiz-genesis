-- Sprint 9: secure, read-only automation gateway for n8n and Awo.
-- Genesis remains the source of truth. External automation can observe a
-- compact event stream and operational snapshot, but cannot approve reviews,
-- edit drafts, retry jobs, or publish content through this gateway.

create table public.automation_events (
  id uuid primary key default extensions.gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  organisation_id uuid references public.organisations (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  claim_consumer text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  lease_token uuid,
  constraint automation_events_payload_object check (jsonb_typeof(payload) = 'object')
);

create index automation_events_delivery_idx
  on public.automation_events (available_at, occurred_at)
  where delivered_at is null;

alter table public.automation_events enable row level security;
revoke all on public.automation_events from anon, authenticated;
grant all on public.automation_events to service_role;

create or replace function public.claim_automation_events(
  p_consumer text,
  p_limit integer default 25,
  p_lease_seconds integer default 60
)
returns table (
  event_id uuid,
  event_type text,
  aggregate_type text,
  aggregate_id uuid,
  organisation_id uuid,
  payload jsonb,
  occurred_at timestamptz,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(trim(p_consumer)) < 3 then
    raise exception 'consumer must contain at least 3 characters';
  end if;

  return query
  with candidates as (
    select e.id
    from public.automation_events e
    where e.delivered_at is null
      and e.available_at <= now()
      and (e.claim_expires_at is null or e.claim_expires_at <= now())
    order by e.occurred_at, e.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ), claimed as (
    update public.automation_events e
    set claim_consumer = trim(p_consumer),
        claimed_at = now(),
        claim_expires_at = now() + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds, 60), 600))),
        lease_token = extensions.gen_random_uuid()
    from candidates c
    where e.id = c.id
    returning e.*
  )
  select c.id, c.event_type, c.aggregate_type, c.aggregate_id,
         c.organisation_id, c.payload, c.occurred_at, c.lease_token
  from claimed c
  order by c.occurred_at, c.id;
end;
$$;

create or replace function public.ack_automation_event(
  p_event_id uuid,
  p_consumer text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.automation_events
  set delivered_at = now(),
      claim_expires_at = null
  where id = p_event_id
    and delivered_at is null
    and claim_consumer = trim(p_consumer)
    and lease_token = p_lease_token
    and claim_expires_at > now();

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.automation_status_snapshot()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'organisations', jsonb_build_object(
      'active', (select count(*) from public.organisations where status = 'active')
    ),
    'reviews', jsonb_build_object(
      'needsReview', (select count(*) from public.content_drafts where status in ('needs_review', 'in_review')),
      'changesRequested', (select count(*) from public.content_drafts where status = 'changes_requested')
    ),
    'publishing', jsonb_build_object(
      'queued', (select count(*) from public.publishing_jobs where status = 'queued'),
      'processing', (select count(*) from public.publishing_jobs where status = 'processing'),
      'failed', (select count(*) from public.publishing_jobs where status = 'failed'),
      'publishedToday', (select count(*) from public.publishing_jobs where status = 'published' and completed_at >= current_date)
    ),
    'failedJobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jobId', f.id,
        'organisationId', f.organisation_id,
        'draftId', f.draft_id,
        'platform', f.platform,
        'completedAt', f.completed_at
      ) order by f.completed_at desc nulls last)
      from (
        select id, organisation_id, draft_id, platform, completed_at
        from public.publishing_jobs
        where status = 'failed'
        order by completed_at desc nulls last
        limit 5
      ) f
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.claim_automation_events(text, integer, integer) from public, anon, authenticated;
revoke all on function public.ack_automation_event(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.automation_status_snapshot() from public, anon, authenticated;
grant execute on function public.claim_automation_events(text, integer, integer) to service_role;
grant execute on function public.ack_automation_event(uuid, text, uuid) to service_role;
grant execute on function public.automation_status_snapshot() to service_role;

create or replace function app.emit_review_automation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.automation_events (
    event_type, aggregate_type, aggregate_id, organisation_id, payload, occurred_at
  ) values (
    'review.' || new.action::text,
    'content_draft',
    new.draft_id,
    new.organisation_id,
    jsonb_build_object(
      'reviewId', new.id,
      'draftId', new.draft_id,
      'action', new.action,
      'previousStatus', new.previous_status,
      'newStatus', new.new_status,
      'assignedReviewerId', new.assigned_reviewer_id
    ),
    new.created_at
  );
  return new;
end;
$$;

create trigger content_draft_reviews_emit_automation_event
  after insert on public.content_draft_reviews
  for each row execute function app.emit_review_automation_event();

create or replace function app.emit_publishing_automation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.automation_events (
      event_type, aggregate_type, aggregate_id, organisation_id, payload, occurred_at
    ) values (
      'publishing.' || new.status::text,
      'publishing_job',
      new.id,
      new.organisation_id,
      jsonb_build_object(
        'jobId', new.id,
        'draftId', new.draft_id,
        'platform', new.platform,
        'status', new.status,
        'triggerType', new.trigger_type,
        'retryCount', new.retry_count
      ),
      now()
    );
  end if;
  return new;
end;
$$;

create trigger publishing_jobs_emit_automation_event
  after insert or update of status on public.publishing_jobs
  for each row execute function app.emit_publishing_automation_event();
