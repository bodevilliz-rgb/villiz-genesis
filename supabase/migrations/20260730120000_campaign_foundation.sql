-- ===========================================================================
-- Project Genesis — Sprint 3.2: Campaign Foundation
--
-- Campaigns are planning and organisational objects only. Nothing below
-- schedules a post, calls a social platform, or touches n8n/Blotato — that
-- boundary is enforced the same way Content Studio's was: by omission. No
-- column here references a schedule, a publish target, or a third-party
-- credential. `platforms` records which channels a campaign is *planned*
-- for, nothing more; it reuses the existing `public.social_platform` enum
-- (introduced in 0004 for the still-unbuilt publishing queue) rather than
-- inventing a second platform vocabulary — this is planning data describing
-- intent, not an integration, so reusing the enum does not pull publishing
-- responsibility into Genesis.
--
-- ARCHITECTURAL DECISIONS
--
-- 1. No version history for campaigns. MemBrain and Content Studio both
--    version because their body text is the product being iterated on and
--    audited. A campaign's fields are structured planning metadata edited in
--    place — nothing in this sprint's brief asks for a campaign history view,
--    and adding one speculatively would be exactly the kind of unrequested
--    abstraction this codebase deliberately avoids. `updated_at`/`updated_by`
--    is the audit trail here, same as `organisations`.
--
-- 2. Campaign status (planning/active/completed/archived) is a lifecycle,
--    not an approval workflow — there is no Content-Studio-style
--    Reviewer-approves-status step. A Reviewer's role on campaigns is
--    therefore identical to their role on MemBrain: read-only. This is why
--    campaigns_update below needs no union with a "can_approve" helper the
--    way content_drafts_update does — can_manage_org (lead-only, for
--    archiving) is already a subset of can_write_org (lead+contributor), so
--    granting can_write_org alone is sufficient at the RLS layer. The
--    lead-only archive rule is enforced in the application layer, exactly as
--    MemBrain's archive-is-lead-only rule already is.
--
-- 3. content_drafts gains a nullable campaign_id — a draft may optionally
--    belong to a campaign. `on delete set null` so a removed campaign never
--    cascades into deleting content. content_draft_versions gains the same
--    column (unconstrained, a point-in-time snapshot, matching how
--    category_id is already recorded there without its own FK) so a
--    campaign reassignment is itself a versioned, auditable change like any
--    other field on a draft.
-- ===========================================================================

create type public.campaign_status as enum ('planning', 'active', 'completed', 'archived');

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  description text,
  objective text,
  target_audience text,
  primary_cta text,
  start_date date,
  end_date date,
  status public.campaign_status not null default 'planning',
  platforms public.social_platform[] not null default '{}',
  success_metric text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint campaigns_name_length check (char_length(trim(name)) between 2 and 200),
  constraint campaigns_description_length check (description is null or char_length(description) <= 5000),
  constraint campaigns_dates_order check (start_date is null or end_date is null or end_date >= start_date)
);

create index campaigns_org_updated_idx on public.campaigns (organisation_id, updated_at desc);
create index campaigns_org_status_idx on public.campaigns (organisation_id, status);

drop trigger if exists campaigns_touch_updated_at on public.campaigns;
create trigger campaigns_touch_updated_at
  before update on public.campaigns
  for each row execute function app.touch_updated_at();

alter table public.campaigns enable row level security;

create policy campaigns_select on public.campaigns
  for select to authenticated using (app.is_org_member(organisation_id));

create policy campaigns_insert on public.campaigns
  for insert to authenticated with check (app.can_write_org(organisation_id));

-- can_manage_org (lead-only, gates archiving in the application layer) is a
-- subset of can_write_org (lead+contributor) — see decision note 2 above.
create policy campaigns_update on public.campaigns
  for update to authenticated
  using (app.can_write_org(organisation_id))
  with check (app.can_write_org(organisation_id));

-- ---------------------------------------------------------------------------
-- Optional campaign linkage on Content Studio drafts
-- ---------------------------------------------------------------------------
alter table public.content_drafts
  add column campaign_id uuid references public.campaigns (id) on delete set null;

create index content_drafts_org_campaign_idx on public.content_drafts (organisation_id, campaign_id);

alter table public.content_draft_versions
  add column campaign_id uuid;

-- Re-declared to include campaign_id in the append-only immutability check —
-- see decision note 3. Every other clause is unchanged from 0009's original.
create or replace function app.guard_content_draft_version_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Content draft version history cannot be deleted' using errcode = '42501';
  end if;

  if old.change_summary is not null then
    raise exception 'This version is already sealed' using errcode = '42501';
  end if;

  if new.draft_id is distinct from old.draft_id
     or new.version is distinct from old.version
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.category_id is distinct from old.category_id
     or new.campaign_id is distinct from old.campaign_id
     or new.content_type is distinct from old.content_type
     or new.status is distinct from old.status
     or new.changed_by is distinct from old.changed_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Content draft version history is append-only' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Re-declared so a campaign reassignment bumps the version like any other
-- meaningful field change.
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
     or new.status is distinct from old.status
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

-- Re-declared to snapshot campaign_id into the version row.
create or replace function app.content_draft_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.version = old.version then
    return new;
  end if;

  insert into public.content_draft_versions (
    draft_id, organisation_id, version, title, body,
    category_id, campaign_id, content_type, status, change_summary, changed_by
  )
  values (
    new.id, new.organisation_id, new.version, new.title, new.body,
    new.category_id, new.campaign_id, new.content_type, new.status,
    case when tg_op = 'INSERT' then 'Draft created' else null end,
    coalesce(new.updated_by, new.created_by)
  )
  on conflict (draft_id, version) do nothing;

  return new;
end;
$$;
