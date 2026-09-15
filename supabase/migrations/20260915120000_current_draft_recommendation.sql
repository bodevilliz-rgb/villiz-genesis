-- Keep every recommendation and approval decision bound to one authoritative
-- content_drafts.version. Material recommendation context changes advance that
-- version, and a concurrent edit makes an in-flight recommendation insert fail.

create or replace function app.content_draft_bump_version()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.category_id is distinct from old.category_id
     or new.campaign_id is distinct from old.campaign_id
     or new.content_type is distinct from old.content_type
     or new.priority is distinct from old.priority
     or new.review_deadline is distinct from old.review_deadline
     or new.hashtags is distinct from old.hashtags
     or new.version is distinct from old.version
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

create or replace function app.bump_content_draft_recommendation_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid := case when tg_op = 'DELETE' then old.draft_id else new.draft_id end;
begin
  update public.content_drafts
  set version = version + 1,
      status = case
        when status in ('approved', 'scheduled', 'failed') then 'needs_review'
        else status
      end
  where id = v_draft_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists content_draft_assets_bump_version on public.content_draft_assets;
create trigger content_draft_assets_bump_version
  after insert or delete on public.content_draft_assets
  for each row execute function app.bump_content_draft_recommendation_version();

create or replace function app.media_asset_context_bump_draft_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.width is distinct from old.width
     or new.height is distinct from old.height
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.alt_text is distinct from old.alt_text
     or new.tags is distinct from old.tags
     or new.duration is distinct from old.duration
     or new.copyright_owner is distinct from old.copyright_owner
     or new.usage_rights is distinct from old.usage_rights
     or new.expires_at is distinct from old.expires_at
     or new.is_ai_generated is distinct from old.is_ai_generated
     or new.is_archived is distinct from old.is_archived
  then
    update public.content_drafts as draft
    set version = draft.version + 1,
        status = case
          when draft.status in ('approved', 'scheduled', 'failed') then 'needs_review'
          else draft.status
        end
    from public.content_draft_assets as link
    where link.asset_id = new.id
      and draft.id = link.draft_id;
  end if;
  return new;
end;
$$;

drop trigger if exists media_asset_context_bump_draft_versions on public.media_assets;
create trigger media_asset_context_bump_draft_versions
  after update on public.media_assets
  for each row execute function app.media_asset_context_bump_draft_versions();

create or replace function app.campaign_objective_bump_draft_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.objective is distinct from old.objective
     or new.platforms is distinct from old.platforms
  then
    update public.content_drafts
    set version = version + 1,
        status = case
          when status in ('approved', 'scheduled', 'failed') then 'needs_review'
          else status
        end
    where campaign_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_objective_bump_draft_versions on public.campaigns;
create trigger campaign_objective_bump_draft_versions
  after update of objective, platforms on public.campaigns
  for each row execute function app.campaign_objective_bump_draft_versions();

create or replace function app.engagement_recommendation_current_version_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current_version integer;
begin
  select version into v_current_version
  from public.content_drafts
  where id = new.draft_id
    and organisation_id = new.organisation_id
  for update;

  if not found then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if new.draft_version <> v_current_version then
    raise exception 'Draft changed while the recommendation was generated. Generate it again for the current version'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists engagement_recommendation_current_version_guard on public.engagement_recommendations;
create trigger engagement_recommendation_current_version_guard
  before insert on public.engagement_recommendations
  for each row execute function app.engagement_recommendation_current_version_guard();

create index if not exists engagement_recommendations_draft_version_latest_idx
  on public.engagement_recommendations (organisation_id, draft_id, draft_version, created_at desc, id desc);

-- A scheduled job approved against the previous version must not remain queued
-- after any material version change. Processing jobs are intentionally left to
-- the worker's existing recovery path rather than being rewritten mid-attempt.
create or replace function app.cancel_outdated_draft_publishing_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.publishing_jobs
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  where draft_id = new.id
    and status = 'queued';
  return new;
end;
$$;

drop trigger if exists content_draft_version_cancel_outdated_publishing_jobs on public.content_drafts;
create trigger content_draft_version_cancel_outdated_publishing_jobs
  after update of version on public.content_drafts
  for each row
  when (new.version is distinct from old.version)
  execute function app.cancel_outdated_draft_publishing_jobs();

-- Expand the five-argument primitive so the recommendation assessment and
-- approval status transition can share one row lock and one expected version.
--
-- Deploy order is expand then application: this migration keeps the exact
-- legacy signature while adding the canonical six-argument form. Old instances
-- and an application rollback therefore remain compatible while a rolling
-- deployment starts sending p_expected_version. The legacy path deliberately
-- delegates with NULL, preserving its historical no-version-check behaviour;
-- it can be contracted only after every deployed application uses six args.
drop function if exists public.perform_content_draft_review(
  uuid,
  public.content_draft_review_action,
  public.content_draft_status,
  uuid,
  text
);

create function public.perform_content_draft_review(
  p_draft_id uuid,
  p_action public.content_draft_review_action,
  p_new_status public.content_draft_status,
  p_assigned_reviewer_id uuid,
  p_comment text,
  p_expected_version integer
)
returns void
language plpgsql
as $$
declare
  v_organisation_id uuid;
  v_previous_status public.content_draft_status;
  v_current_version integer;
  v_updated_rows int;
begin
  select organisation_id, status, version
    into v_organisation_id, v_previous_status, v_current_version
  from public.content_drafts
  where id = p_draft_id
  for update;

  if v_organisation_id is null then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and v_current_version <> p_expected_version then
    raise exception 'Draft changed while approval was being recorded. Review the current version and try again'
      using errcode = '40001';
  end if;

  update public.content_drafts
  set status = coalesce(p_new_status, status),
      assigned_reviewer_id = case
        when p_action in ('assigned', 'reassigned') then p_assigned_reviewer_id
        else assigned_reviewer_id
      end,
      last_review_action = p_action,
      last_review_at = now(),
      updated_by = (select auth.uid())
  where id = p_draft_id;

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows = 0 then
    raise exception 'You do not have permission to update this draft' using errcode = '42501';
  end if;

  insert into public.content_draft_reviews (
    draft_id, organisation_id, action, actor_id, assigned_reviewer_id,
    previous_status, new_status, comment
  ) values (
    p_draft_id, v_organisation_id, p_action, (select auth.uid()), p_assigned_reviewer_id,
    v_previous_status, coalesce(p_new_status, v_previous_status), p_comment
  );
end;
$$;

-- Exact legacy overload: no DEFAULT parameters, so PostgREST can resolve five
-- and six named arguments without ambiguity. Like the original function and
-- the canonical overload above, this remains SECURITY INVOKER, inherits the
-- caller's search_path, and receives the existing default EXECUTE grants.
create function public.perform_content_draft_review(
  p_draft_id uuid,
  p_action public.content_draft_review_action,
  p_new_status public.content_draft_status,
  p_assigned_reviewer_id uuid,
  p_comment text
)
returns void
language plpgsql
as $$
begin
  perform public.perform_content_draft_review(
    p_draft_id,
    p_action,
    p_new_status,
    p_assigned_reviewer_id,
    p_comment,
    null::integer
  );
end;
$$;
