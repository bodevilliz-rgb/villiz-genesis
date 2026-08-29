-- Project Genesis — Media Safe Delete v1
--
-- Permanent deletion is intentionally limited to assets whose entire lifetime
-- has been observed by this migration and which have never acquired a known
-- Genesis dependency. Storage cleanup remains outside the database transaction,
-- so an immutable ledger makes post-commit cleanup retryable and idempotent.

alter table public.media_assets
  add column usage_tracking_started_at timestamptz,
  add column first_used_at timestamptz;

comment on column public.media_assets.usage_tracking_started_at is
  'Set for assets created after Media Safe Delete v1. NULL means Genesis cannot prove the asset was never used.';
comment on column public.media_assets.first_used_at is
  'Irreversible first-known-use marker. Detaching an asset never clears it.';

alter table public.media_assets
  alter column usage_tracking_started_at set default now();

create table public.media_deletion_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  former_asset_id uuid not null,
  file_name text not null,
  object_paths text[] not null,
  object_count integer not null check (object_count >= 1),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  cleanup_state text not null default 'pending' check (cleanup_state in ('pending', 'complete')),
  cleanup_attempt_count integer not null default 0 check (cleanup_attempt_count >= 0),
  last_error text,
  completed_at timestamptz,
  deletion_source text not null default 'single' check (deletion_source = 'single'),
  reference_check_outcome text not null default 'eligible' check (reference_check_outcome = 'eligible'),
  unique (organisation_id, former_asset_id)
);

create index media_deletion_requests_pending_idx
  on public.media_deletion_requests (organisation_id, requested_at)
  where cleanup_state = 'pending';

alter table public.media_deletion_requests enable row level security;

create policy media_deletion_requests_select on public.media_deletion_requests
  for select to authenticated
  using (app.can_manage_org(organisation_id));

-- Writes occur only through the security-definer functions below. Direct table
-- writes are deliberately unavailable to authenticated clients.

create or replace function app.media_path_belongs_to_org(p_path text, p_organisation_id uuid)
returns boolean
language sql
immutable
as $$
  select p_path is not null
    and p_path not like '%..%'
    and p_path like ('organisations/' || p_organisation_id::text || '/%');
$$;

create or replace function app.mark_media_asset_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid;
  v_organisation_id uuid;
begin
  v_asset_id := new.asset_id;
  case tg_table_name
    when 'content_draft_assets' then
      select organisation_id into v_organisation_id from public.content_drafts where id = new.draft_id;
    when 'campaign_assets' then
      select organisation_id into v_organisation_id from public.campaigns where id = new.campaign_id;
    when 'media_collection_assets' then
      select organisation_id into v_organisation_id from public.media_collections where id = new.collection_id;
    when 'brand_kit_assets' then
      select organisation_id into v_organisation_id from public.brand_kits where id = new.brand_kit_id;
    else
      raise exception 'Unsupported media reference source.' using errcode = '23514';
  end case;
  update public.media_assets
     set first_used_at = coalesce(first_used_at, now())
   where id = v_asset_id and organisation_id = v_organisation_id;
  if not found then
    raise exception 'Referenced media asset is unavailable or belongs to another organisation.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger content_draft_assets_mark_media_used
  before insert on public.content_draft_assets
  for each row execute function app.mark_media_asset_used();
create trigger campaign_assets_mark_media_used
  before insert on public.campaign_assets
  for each row execute function app.mark_media_asset_used();
create trigger media_collection_assets_mark_media_used
  before insert on public.media_collection_assets
  for each row execute function app.mark_media_asset_used();
create trigger brand_kit_assets_mark_media_used
  before insert on public.brand_kit_assets
  for each row execute function app.mark_media_asset_used();

-- Preserve all already-known use. Existing detached assets remain deliberately
-- unclassified because their pre-migration history cannot be proven.
update public.media_assets a
set first_used_at = now()
where exists (select 1 from public.content_draft_assets x where x.asset_id = a.id)
   or exists (select 1 from public.campaign_assets x where x.asset_id = a.id)
   or exists (select 1 from public.media_collection_assets x where x.asset_id = a.id)
   or exists (select 1 from public.brand_kit_assets x where x.asset_id = a.id)
   or exists (
     select 1
       from public.engagement_recommendations r,
            jsonb_array_elements(r.evidence) evidence
      where r.organisation_id = a.organisation_id
        and evidence.value ->> 'sourceType' = 'media_asset'
        and evidence.value ->> 'sourceId' = a.id::text
   );

create or replace function app.mark_recommendation_media_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evidence jsonb;
  v_asset_id uuid;
begin
  for v_evidence in select value from jsonb_array_elements(new.evidence)
  loop
    if v_evidence ->> 'sourceType' = 'media_asset' then
      begin
        v_asset_id := (v_evidence ->> 'sourceId')::uuid;
      exception when invalid_text_representation then
        raise exception 'Recommendation contains an invalid media reference.' using errcode = '23514';
      end;
      update public.media_assets
         set first_used_at = coalesce(first_used_at, now())
       where id = v_asset_id and organisation_id = new.organisation_id;
      if not found then
        raise exception 'Recommendation media reference is unavailable or belongs to another organisation.' using errcode = '23503';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create trigger engagement_recommendations_mark_media_used
  before insert or update of evidence on public.engagement_recommendations
  for each row execute function app.mark_recommendation_media_used();

create or replace function public.get_media_deletion_status(
  p_organisation_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets%rowtype;
  v_role public.organisation_role;
  v_content_count integer := 0;
  v_campaign_count integer := 0;
  v_collection_count integer := 0;
  v_brand_kit_count integer := 0;
  v_publishing_count integer := 0;
  v_intelligence_count integer := 0;
  v_invalid_path_count integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_paths text[];
  v_total_bytes bigint := 0;
begin
  if not app.is_org_member(p_organisation_id) then
    return jsonb_build_object('eligibility', 'BLOCKED', 'reasons', jsonb_build_array(
      jsonb_build_object('code', 'INSUFFICIENT_PERMISSION', 'count', 1)
    ));
  end if;

  select * into v_asset
    from public.media_assets
   where id = p_asset_id and organisation_id = p_organisation_id;

  if not found then
    return jsonb_build_object('eligibility', 'BLOCKED', 'reasons', jsonb_build_array(
      jsonb_build_object('code', 'UNKNOWN_DEPENDENCY', 'count', 1)
    ));
  end if;

  if not app.is_platform_admin() then
    select m.role into v_role
      from public.organisation_members m
      join public.profiles p on p.id = m.profile_id
     where m.organisation_id = p_organisation_id
       and m.profile_id = (select auth.uid())
       and p.is_active;
    if v_role is distinct from 'lead'::public.organisation_role then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'INSUFFICIENT_PERMISSION', 'count', 1));
    end if;
  end if;

  select count(*) into v_content_count from public.content_draft_assets where asset_id = p_asset_id;
  select count(*) into v_campaign_count from public.campaign_assets where asset_id = p_asset_id;
  select count(*) into v_collection_count from public.media_collection_assets where asset_id = p_asset_id;
  select count(*) into v_brand_kit_count from public.brand_kit_assets where asset_id = p_asset_id;
  select count(*) into v_publishing_count
    from public.publishing_jobs j
    join public.content_draft_assets a on a.draft_id = j.draft_id
   where a.asset_id = p_asset_id
     and j.organisation_id = p_organisation_id
     and j.status in ('queued', 'processing', 'awaiting_confirmation', 'failed');
  select count(*) into v_intelligence_count
    from public.engagement_recommendations r,
         jsonb_array_elements(r.evidence) evidence
   where r.organisation_id = p_organisation_id
     and evidence.value ->> 'sourceType' = 'media_asset'
     and evidence.value ->> 'sourceId' = p_asset_id::text;

  if v_content_count > 0 then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'USED_BY_CONTENT', 'count', v_content_count)); end if;
  if v_campaign_count > 0 then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'USED_BY_CAMPAIGN', 'count', v_campaign_count)); end if;
  if v_collection_count > 0 then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'USED_BY_COLLECTION', 'count', v_collection_count)); end if;
  if v_brand_kit_count > 0 then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'USED_BY_BRAND_KIT', 'count', v_brand_kit_count)); end if;
  if v_publishing_count > 0 then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'PUBLISHING_DEPENDENCY', 'count', v_publishing_count)); end if;
  if v_intelligence_count > 0 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'HISTORICAL_INTELLIGENCE_REFERENCE', 'count', v_intelligence_count));
  end if;
  if v_asset.first_used_at is not null then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'HISTORICAL_USE', 'count', 1));
  end if;
  if v_asset.usage_tracking_started_at is null then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'UNKNOWN_DEPENDENCY', 'count', 1));
  end if;

  select array_agg(path order by path), count(*) filter (where not app.media_path_belongs_to_org(path, p_organisation_id))
    into v_paths, v_invalid_path_count
    from (
      select v_asset.storage_path as path
      union
      select v_asset.thumbnail_path where v_asset.thumbnail_path is not null
      union
      select storage_path from public.media_asset_versions where asset_id = p_asset_id
    ) inventory;

  select v_asset.size_bytes + coalesce(sum(size_bytes), 0)
    into v_total_bytes
    from public.media_asset_versions where asset_id = p_asset_id;

  if v_paths is null or cardinality(v_paths) = 0 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'INCOMPLETE_PATH_INVENTORY', 'count', 1));
  end if;
  if v_invalid_path_count > 0 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'INVALID_STORAGE_OWNERSHIP', 'count', v_invalid_path_count));
  end if;

  return jsonb_build_object(
    'eligibility', case when jsonb_array_length(v_reasons) = 0 then 'ELIGIBLE' else 'BLOCKED' end,
    'reasons', v_reasons,
    'fileName', v_asset.file_name,
    'totalBytes', v_total_bytes,
    'objectCount', cardinality(v_paths)
  );
exception when others then
  return jsonb_build_object('eligibility', 'BLOCKED', 'reasons', jsonb_build_array(
    jsonb_build_object('code', 'UNKNOWN_DEPENDENCY', 'count', 1)
  ));
end;
$$;

create or replace function public.request_media_safe_delete(
  p_organisation_id uuid,
  p_asset_id uuid,
  p_idempotency_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets%rowtype;
  v_existing public.media_deletion_requests%rowtype;
  v_status jsonb;
  v_paths text[];
  v_total_bytes bigint;
begin
  if not app.can_manage_org(p_organisation_id) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reasons', jsonb_build_array(
      jsonb_build_object('code', 'INSUFFICIENT_PERMISSION', 'count', 1)
    ));
  end if;

  select * into v_existing from public.media_deletion_requests
   where organisation_id = p_organisation_id and former_asset_id = p_asset_id;
  if found then
    return jsonb_build_object('outcome', 'ACCEPTED', 'requestId', v_existing.id,
      'cleanupState', v_existing.cleanup_state, 'totalBytes', v_existing.total_bytes);
  end if;

  select * into v_asset from public.media_assets
   where id = p_asset_id and organisation_id = p_organisation_id
   for update;
  if not found then
    -- A concurrent request may have completed while this transaction waited on
    -- the asset row lock. Re-read the durable unique ledger before deciding.
    select * into v_existing from public.media_deletion_requests
     where organisation_id = p_organisation_id and former_asset_id = p_asset_id;
    if found then
      return jsonb_build_object('outcome', 'ACCEPTED', 'requestId', v_existing.id,
        'cleanupState', v_existing.cleanup_state, 'totalBytes', v_existing.total_bytes);
    end if;
    return jsonb_build_object('outcome', 'BLOCKED', 'reasons', jsonb_build_array(
      jsonb_build_object('code', 'UNKNOWN_DEPENDENCY', 'count', 1)
    ));
  end if;

  v_status := public.get_media_deletion_status(p_organisation_id, p_asset_id);
  if v_status ->> 'eligibility' <> 'ELIGIBLE' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reasons', v_status -> 'reasons');
  end if;

  select array_agg(path order by path) into v_paths from (
    select v_asset.storage_path as path
    union
    select v_asset.thumbnail_path where v_asset.thumbnail_path is not null
    union
    select storage_path from public.media_asset_versions where asset_id = p_asset_id
  ) inventory;
  select v_asset.size_bytes + coalesce(sum(size_bytes), 0) into v_total_bytes
    from public.media_asset_versions where asset_id = p_asset_id;

  insert into public.media_deletion_requests (
    id, organisation_id, former_asset_id, file_name, object_paths, object_count,
    total_bytes, requested_by
  ) values (
    p_idempotency_id, p_organisation_id, p_asset_id, v_asset.file_name, v_paths,
    cardinality(v_paths), v_total_bytes, (select auth.uid())
  ) returning * into v_existing;

  insert into public.audit_events (
    organisation_id, draft_id, actor_id, event_type, description, metadata
  ) values (
    p_organisation_id, null, (select auth.uid()), 'media_permanent_deletion_requested',
    'Permanent deletion requested for unused media "' || v_asset.file_name || '".',
    jsonb_build_object('formerAssetId', p_asset_id, 'fileName', v_asset.file_name,
      'pathIdentifiers', v_paths, 'objectCount', cardinality(v_paths),
      'totalBytes', v_total_bytes, 'deletionSource', 'single',
      'referenceCheckOutcome', 'eligible', 'cleanupStatus', 'pending')
  );

  delete from public.media_assets where id = p_asset_id and organisation_id = p_organisation_id;
  if not found then raise exception 'Media asset changed during deletion.'; end if;

  return jsonb_build_object('outcome', 'ACCEPTED', 'requestId', v_existing.id,
    'cleanupState', 'pending', 'totalBytes', v_total_bytes);
exception when unique_violation then
  select * into v_existing from public.media_deletion_requests
   where organisation_id = p_organisation_id and former_asset_id = p_asset_id;
  return jsonb_build_object('outcome', 'ACCEPTED', 'requestId', v_existing.id,
    'cleanupState', v_existing.cleanup_state, 'totalBytes', v_existing.total_bytes);
end;
$$;

create or replace function public.record_media_cleanup_result(
  p_organisation_id uuid,
  p_request_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.media_deletion_requests%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Not authorised.' using errcode = '42501'; end if;
  select * into v_request from public.media_deletion_requests
   where id = p_request_id and organisation_id = p_organisation_id
   for update;
  if not found then raise exception 'Cleanup request not found.' using errcode = 'P0002'; end if;
  if v_request.cleanup_state = 'complete' then
    return jsonb_build_object('requestId', v_request.id, 'cleanupState', v_request.cleanup_state,
      'totalBytes', v_request.total_bytes, 'attemptCount', v_request.cleanup_attempt_count);
  end if;
  update public.media_deletion_requests
     set cleanup_attempt_count = cleanup_attempt_count + 1,
         cleanup_state = case when p_succeeded then 'complete' else 'pending' end,
         last_error = case when p_succeeded then null else left(coalesce(p_error, 'Storage cleanup failed.'), 1000) end,
         completed_at = case when p_succeeded then now() else null end
   where id = p_request_id and organisation_id = p_organisation_id
   returning * into v_request;
  if p_succeeded then
    insert into public.audit_events (organisation_id, draft_id, actor_id, event_type, description, metadata)
    values (p_organisation_id, null, v_request.requested_by, 'media_storage_cleanup_completed',
      'Storage cleanup completed for permanently deleted media "' || v_request.file_name || '".',
      jsonb_build_object('formerAssetId', v_request.former_asset_id, 'requestId', v_request.id,
        'objectCount', v_request.object_count, 'totalBytes', v_request.total_bytes,
        'cleanupStatus', 'complete'));
  end if;
  return jsonb_build_object('requestId', v_request.id, 'cleanupState', v_request.cleanup_state,
    'totalBytes', v_request.total_bytes, 'attemptCount', v_request.cleanup_attempt_count);
end;
$$;

-- Align DB deletion authority with the existing Storage DELETE policy.
drop policy if exists media_assets_write on public.media_assets;
create policy media_assets_insert on public.media_assets
  for insert to authenticated with check (app.can_write_org(organisation_id));
create policy media_assets_update on public.media_assets
  for update to authenticated using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));
create policy media_assets_delete on public.media_assets
  for delete to authenticated using (app.can_manage_org(organisation_id));

revoke all on function public.get_media_deletion_status(uuid, uuid) from public;
revoke all on function public.request_media_safe_delete(uuid, uuid, uuid) from public;
revoke all on function public.record_media_cleanup_result(uuid, uuid, boolean, text) from public;
revoke all on function public.record_media_cleanup_result(uuid, uuid, boolean, text) from anon, authenticated;
grant execute on function public.get_media_deletion_status(uuid, uuid) to authenticated;
grant execute on function public.request_media_safe_delete(uuid, uuid, uuid) to authenticated;
grant execute on function public.record_media_cleanup_result(uuid, uuid, boolean, text) to service_role;

revoke all on public.media_deletion_requests from anon, authenticated;
grant select on public.media_deletion_requests to authenticated;
