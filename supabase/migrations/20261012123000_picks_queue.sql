-- GENv2-P1 — staged Picks Queue, native receipts, and status synchronisation.

create table public.picks_queue_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  source_key text not null,
  asset_id uuid references public.media_assets(id) on delete restrict,
  source_kind text not null check (source_kind in ('organisation_media', 'drive_reference')),
  source_ref text not null,
  item_label text not null,
  caption_options jsonb not null default '[]'::jsonb check (jsonb_typeof(caption_options) = 'array' and jsonb_array_length(caption_options) <= 3),
  platform public.publishing_platform not null default 'instagram',
  slot_time timestamptz,
  status text not null default 'staged' check (status in ('staged', 'queued', 'scheduled', 'publishing', 'published', 'verified')),
  draft_id uuid references public.content_drafts(id) on delete restrict,
  job_id uuid references public.publishing_jobs(id) on delete restrict,
  receipt_id text,
  public_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, source_key)
);

create index picks_queue_items_org_status_idx on public.picks_queue_items(organisation_id, status, created_at desc);
create unique index picks_queue_items_job_unique on public.picks_queue_items(job_id) where job_id is not null;

create trigger picks_queue_items_touch_updated_at
  before update on public.picks_queue_items
  for each row execute function app.touch_updated_at();

alter table public.picks_queue_items enable row level security;
create policy picks_queue_items_select on public.picks_queue_items for select using (app.is_org_member(organisation_id));
create policy picks_queue_items_insert on public.picks_queue_items for insert with check (app.can_write_org(organisation_id));
create policy picks_queue_items_update on public.picks_queue_items for update using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));
revoke all on public.picks_queue_items from anon;
grant select, insert, update on public.picks_queue_items to authenticated;
grant all on public.picks_queue_items to service_role;

create or replace function app.stage_media_in_picks_queue()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.category = 'posting-request' and new.is_archived = false then
    insert into public.picks_queue_items (
      organisation_id, source_key, asset_id, source_kind, source_ref, item_label, metadata
    ) values (
      new.organisation_id, 'asset:' || new.id::text, new.id, 'organisation_media',
      new.storage_path, coalesce(nullif(new.title, ''), new.file_name),
      jsonb_build_object('stagingDescription', new.description)
    ) on conflict (organisation_id, source_key) do update
      set asset_id = excluded.asset_id,
          source_ref = excluded.source_ref,
          item_label = excluded.item_label,
          metadata = public.picks_queue_items.metadata || excluded.metadata;
  end if;
  return new;
end;
$$;

create trigger media_assets_stage_picks_queue
  after insert or update of category, is_archived, title, storage_path on public.media_assets
  for each row execute function app.stage_media_in_picks_queue();

-- Backfill already-staged assets without changing their provenance rows.
insert into public.picks_queue_items (
  organisation_id, source_key, asset_id, source_kind, source_ref, item_label, metadata
)
select organisation_id, 'asset:' || id::text, id, 'organisation_media', storage_path,
       coalesce(nullif(title, ''), file_name), jsonb_build_object('stagingDescription', description)
from public.media_assets
where category = 'posting-request' and is_archived = false
on conflict (organisation_id, source_key) do nothing;

create or replace function public.prepare_pick_for_publishing(
  p_organisation_id uuid,
  p_pick_id uuid,
  p_caption text,
  p_platform public.publishing_platform,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pick public.picks_queue_items%rowtype;
  v_draft_id uuid;
begin
  if auth.uid() is distinct from p_actor_id or not app.can_write_org(p_organisation_id) then
    raise exception 'Not authorised to approve this pick.' using errcode = '42501';
  end if;
  if nullif(btrim(p_caption), '') is null then
    raise exception 'Choose a caption before publishing.' using errcode = '23514';
  end if;

  select * into v_pick from public.picks_queue_items
   where id = p_pick_id and organisation_id = p_organisation_id
   for update;
  if v_pick.id is null then raise exception 'Pick not found.' using errcode = 'P0002'; end if;
  if v_pick.asset_id is null then
    raise exception 'This Drive reference has not been staged into organisation-media yet.' using errcode = '23514';
  end if;
  if v_pick.status in ('published', 'verified') then
    raise exception 'This pick already has a receipt.' using errcode = '23514';
  end if;
  if v_pick.draft_id is not null then return v_pick.draft_id; end if;

  insert into public.content_drafts (
    organisation_id, title, content_type, summary, body, status, created_by, updated_by, priority
  ) values (
    p_organisation_id, left(v_pick.item_label, 200), 'social_post',
    'Approved from Genesis Picks Queue', p_caption, 'approved', p_actor_id, p_actor_id, 'medium'
  ) returning id into v_draft_id;

  insert into public.content_draft_assets(draft_id, asset_id, attached_by)
  values (v_draft_id, v_pick.asset_id, p_actor_id)
  on conflict do nothing;

  update public.picks_queue_items
     set draft_id = v_draft_id, platform = p_platform, caption_options =
       case when jsonb_array_length(caption_options) = 0 then jsonb_build_array(p_caption) else caption_options end
   where id = p_pick_id;
  insert into public.audit_events(organisation_id, draft_id, actor_id, event_type, description, metadata)
  values (p_organisation_id, v_draft_id, p_actor_id, 'pick_owner_approved',
          'Owner chose a Picks Queue caption and approved it for governed publishing.',
          jsonb_build_object('pickId', p_pick_id, 'platform', p_platform));
  return v_draft_id;
end;
$$;

grant execute on function public.prepare_pick_for_publishing(uuid, uuid, text, public.publishing_platform, uuid) to authenticated;

create or replace function public.record_native_publishing_receipt(
  p_organisation_id uuid,
  p_pick_id uuid,
  p_platform public.publishing_platform,
  p_public_url text,
  p_receipt_id text,
  p_actor_id uuid
)
returns public.publishing_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pick public.picks_queue_items%rowtype;
  v_job public.publishing_jobs%rowtype;
begin
  if auth.uid() is distinct from p_actor_id or not app.can_write_org(p_organisation_id) then
    raise exception 'Not authorised to verify this pick.' using errcode = '42501';
  end if;
  if p_public_url !~ '^https://' or nullif(btrim(p_receipt_id), '') is null then
    raise exception 'A verified HTTPS receipt is required.' using errcode = '23514';
  end if;

  select * into v_pick from public.picks_queue_items
   where id = p_pick_id and organisation_id = p_organisation_id
   for update;
  if v_pick.id is null or v_pick.draft_id is null then
    raise exception 'Prepare the pick before recording a native receipt.' using errcode = '23514';
  end if;
  if v_pick.job_id is not null then
    select * into v_job from public.publishing_jobs where id = v_pick.job_id;
    return v_job;
  end if;

  insert into public.publishing_jobs (
    organisation_id, draft_id, platform, trigger_type, scheduled_for, status,
    idempotency_key, requested_by, completed_at, max_retries, execution_mode
  ) values (
    p_organisation_id, v_pick.draft_id, p_platform, 'immediate', now(), 'published',
    'native:' || p_receipt_id, p_actor_id, now(), 0, 'live'
  ) returning * into v_job;

  insert into public.publishing_attempts (
    job_id, organisation_id, draft_id, platform, attempt_number, status,
    started_at, completed_at, duration_ms, external_post_id, external_url, provider_metadata
  ) values (
    v_job.id, p_organisation_id, v_pick.draft_id, p_platform, 1, 'completed',
    now(), now(), 0, p_receipt_id, p_public_url,
    jsonb_build_object('nativeVerified', true, 'verifiedLive', true, 'receiptId', p_receipt_id)
  );

  update public.content_drafts set status = 'published', updated_by = p_actor_id where id = v_pick.draft_id;
  update public.picks_queue_items
     set status = 'verified', job_id = v_job.id, receipt_id = p_receipt_id, public_url = p_public_url
   where id = p_pick_id;
  insert into public.audit_events(organisation_id, draft_id, actor_id, event_type, description, metadata)
  values (p_organisation_id, v_pick.draft_id, p_actor_id, 'native_post_verified',
          'A native platform post was read live and its public receipt was recorded.',
          jsonb_build_object('jobId', v_job.id, 'receiptId', p_receipt_id, 'publicUrl', p_public_url));
  return v_job;
end;
$$;

grant execute on function public.record_native_publishing_receipt(uuid, uuid, public.publishing_platform, text, text, uuid) to authenticated;

-- Config gating happens in the Genesis server process. This idempotent RPC
-- only emits the contract consumed by the external call_alerts.py lane.
create unique index automation_events_mervic_publish_job_unique
  on public.automation_events(aggregate_id)
  where event_type = 'alerts.mervic_publish';

create or replace function public.enqueue_mervic_publish_alert(
  p_organisation_id uuid,
  p_job_id uuid,
  p_public_url text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_event_id uuid;
begin
  if auth.role() <> 'service_role' and not app.can_write_org(p_organisation_id) then
    raise exception 'Not authorised to enqueue this alert.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.publishing_jobs j
    join public.publishing_attempts a on a.job_id = j.id
    join public.organisations o on o.id = j.organisation_id
    where j.id = p_job_id and j.organisation_id = p_organisation_id
      and j.status = 'published' and a.status = 'completed'
      and a.external_url = p_public_url and o.name ~* '\\mMervic\\M'
  ) then
    raise exception 'A completed Mervic publishing receipt is required.' using errcode = '23514';
  end if;

  insert into public.automation_events (
    event_type, aggregate_type, aggregate_id, organisation_id, payload
  ) values (
    'alerts.mervic_publish', 'publishing_job', p_job_id, p_organisation_id,
    jsonb_build_object('contract', 'call_alerts.py', 'publicUrl', p_public_url)
  ) on conflict do nothing returning id into v_event_id;
  if v_event_id is null then
    select id into v_event_id from public.automation_events
     where event_type = 'alerts.mervic_publish' and aggregate_id = p_job_id;
  end if;
  return v_event_id;
end;
$$;

revoke all on function public.enqueue_mervic_publish_alert(uuid, uuid, text) from public, anon;
grant execute on function public.enqueue_mervic_publish_alert(uuid, uuid, text) to authenticated, service_role;

create or replace function app.sync_pick_from_publishing_job()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.picks_queue_items
     set status = case
       when new.status = 'queued' and new.trigger_type = 'scheduled' then 'scheduled'
       when new.status = 'queued' then 'queued'
       when new.status in ('processing', 'awaiting_confirmation') then 'publishing'
       when new.status = 'published' then 'published'
       else status end,
       receipt_id = case when new.status = 'published' then (
         select external_post_id from public.publishing_attempts where job_id = new.id order by attempt_number desc limit 1
       ) else receipt_id end,
       public_url = case when new.status = 'published' then (
         select external_url from public.publishing_attempts where job_id = new.id order by attempt_number desc limit 1
       ) else public_url end
   where job_id = new.id;
  return new;
end;
$$;

create trigger publishing_jobs_sync_pick
  after insert or update of status on public.publishing_jobs
  for each row execute function app.sync_pick_from_publishing_job();
