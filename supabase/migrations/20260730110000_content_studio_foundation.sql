-- ===========================================================================
-- Project Genesis — Sprint 3: Content Studio Foundation
--
-- Content Studio is where Villiz staff prepare client content. It ends at
-- Approved Drafts — nothing here schedules, publishes, or talks to a social
-- platform, n8n, or Blotato. That boundary is enforced by omission: no
-- column, table, or function below references a platform, a schedule, or a
-- publish target. Publishing lives entirely downstream, in a later sprint,
-- against tables like `scheduled_posts` (already reserved in 0004) that this
-- migration does not touch.
--
-- ARCHITECTURAL DECISIONS
--
-- 1. Draft status (draft / needs_review / approved) is its own enum,
--    intentionally NOT `public.post_status` (0004's 9-value enum for the
--    future publishing queue). Reusing that enum would blur the boundary
--    this sprint is required to preserve: Content Studio's workflow ends at
--    "approved"; `scheduled`/`published`/`failed` describe a different,
--    later stage owned by a different table.
--
-- 2. Version history reuses MemBrain's exact append-only-trigger pattern
--    (0005) rather than a shared/generic mechanism, because no generic
--    version-history trigger exists yet — MemBrain was the only table that
--    needed one before this. Introducing a shared abstraction for two
--    call sites is speculative; the two trigger sets are intentionally
--    parallel, not shared, matching this codebase's existing practice of not
--    building abstractions ahead of a third use.
--
-- 3. AI generation is NOT performed here or anywhere in this codebase. No LLM
--    provider is wired into Genesis or Awo — every existing engine (Priority,
--    Recommendation, Chairman Score) is explicitly rule-based, never
--    generative. `content_generation_requests` is a structured handoff
--    record: Content Studio assembles a creative brief plus a MemBrain
--    context pack and persists it, marking the draft `ready_for_awo`. Actual
--    generation is Awo's responsibility in a future sprint; this table is
--    the durable, inspectable contract between the two systems.
-- ===========================================================================

create type public.content_draft_status as enum ('draft', 'needs_review', 'approved');
create type public.content_draft_type as enum
  ('social_post', 'email', 'blog_article', 'ad_copy', 'video_script', 'other');
create type public.content_draft_awo_status as enum ('not_requested', 'ready_for_awo');

-- ---------------------------------------------------------------------------
-- Authorisation helper — Reviewers cannot write content (see app.can_write_org)
-- but exist specifically to approve it, per their role description in the
-- application layer. This is the RLS-level counterpart of that rule.
-- ---------------------------------------------------------------------------
create or replace function app.can_approve_org(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_platform_admin() or exists (
    select 1
    from public.organisation_members m
    join public.profiles p on p.id = m.profile_id
    where m.organisation_id = p_organisation_id
      and m.profile_id = (select auth.uid())
      and m.role in ('lead', 'reviewer')
      and p.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------------
create table public.content_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  category_id uuid references public.membrain_categories (id) on delete set null,
  title text not null,
  content_type public.content_draft_type not null default 'social_post',
  summary text,
  body text not null default '',
  status public.content_draft_status not null default 'draft',
  awo_status public.content_draft_awo_status not null default 'not_requested',
  version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint content_drafts_title_length check (char_length(trim(title)) between 3 and 200),
  constraint content_drafts_summary_length check (summary is null or char_length(summary) <= 500)
);

create index content_drafts_org_updated_idx on public.content_drafts (organisation_id, updated_at desc);
create index content_drafts_org_status_idx on public.content_drafts (organisation_id, status);
create index content_drafts_org_category_idx on public.content_drafts (organisation_id, category_id);

drop trigger if exists content_drafts_touch_updated_at on public.content_drafts;
create trigger content_drafts_touch_updated_at
  before update on public.content_drafts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Immutable version history — identical shape to MemBrain's (0005)
-- ---------------------------------------------------------------------------
create table public.content_draft_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  draft_id uuid not null references public.content_drafts (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  category_id uuid,
  content_type public.content_draft_type not null,
  status public.content_draft_status not null,
  change_summary text,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (draft_id, version)
);

create index content_draft_versions_draft_idx
  on public.content_draft_versions (draft_id, version desc);

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

drop trigger if exists content_draft_versions_append_only on public.content_draft_versions;
create trigger content_draft_versions_append_only
  before update or delete on public.content_draft_versions
  for each row execute function app.guard_content_draft_version_history();

create or replace function app.content_draft_bump_version()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.category_id is distinct from old.category_id
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

drop trigger if exists content_drafts_bump_version on public.content_drafts;
create trigger content_drafts_bump_version
  before update on public.content_drafts
  for each row execute function app.content_draft_bump_version();

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
    category_id, content_type, status, change_summary, changed_by
  )
  values (
    new.id, new.organisation_id, new.version, new.title, new.body,
    new.category_id, new.content_type, new.status,
    case when tg_op = 'INSERT' then 'Draft created' else null end,
    coalesce(new.updated_by, new.created_by)
  )
  on conflict (draft_id, version) do nothing;

  return new;
end;
$$;

drop trigger if exists content_drafts_record_version on public.content_drafts;
create trigger content_drafts_record_version
  after insert or update on public.content_drafts
  for each row execute function app.content_draft_record_version();

-- ---------------------------------------------------------------------------
-- Generation requests — the structured handoff to Awo (see decision note 3
-- above). Never mutated after creation: it is a record of what was asked for
-- and with what context, at the moment it was asked.
-- ---------------------------------------------------------------------------
create table public.content_generation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  draft_id uuid not null references public.content_drafts (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  brief text not null,
  target_audience text,
  tone text,
  content_pillar_category_id uuid references public.membrain_categories (id) on delete set null,
  membrain_context_prompt text not null,
  membrain_context_entry_count integer not null default 0,
  membrain_context_estimated_tokens integer not null default 0,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),

  constraint content_generation_requests_brief_length check (char_length(trim(brief)) between 3 and 4000)
);

create index content_generation_requests_draft_idx
  on public.content_generation_requests (draft_id, requested_at desc);

-- Marking a draft ready-for-Awo is a side effect of the request existing, not
-- a separate step a caller can forget. Runs as SECURITY DEFINER so it is not
-- gated by the caller's write policy on content_drafts a second time.
create or replace function app.content_generation_request_mark_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.content_drafts
  set awo_status = 'ready_for_awo'
  where id = new.draft_id
    and awo_status is distinct from 'ready_for_awo';
  return new;
end;
$$;

drop trigger if exists content_generation_requests_mark_ready on public.content_generation_requests;
create trigger content_generation_requests_mark_ready
  after insert on public.content_generation_requests
  for each row execute function app.content_generation_request_mark_ready();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Write access to content_drafts is deliberately the union of can_write_org
-- (lead/contributor — content edits) and can_approve_org (lead/reviewer —
-- status approval). RLS cannot distinguish "which columns changed" from a
-- single UPDATE statement, so it grants the union at the row level; the
-- precise rule (a Contributor may edit but not approve, a Reviewer may
-- approve but not edit) is enforced in the application layer, exactly as
-- MemBrain's archive-is-lead-only rule is (see membrain use-cases).
-- ---------------------------------------------------------------------------
alter table public.content_drafts enable row level security;
alter table public.content_draft_versions enable row level security;
alter table public.content_generation_requests enable row level security;

create policy content_drafts_select on public.content_drafts
  for select to authenticated using (app.is_org_member(organisation_id));

create policy content_drafts_insert on public.content_drafts
  for insert to authenticated with check (app.can_write_org(organisation_id));

create policy content_drafts_update on public.content_drafts
  for update to authenticated
  using (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id))
  with check (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id));

create policy content_draft_versions_select on public.content_draft_versions
  for select to authenticated using (app.is_org_member(organisation_id));

-- Narrow update path: the append-only trigger guarantees this can only ever
-- attach a change reason, never alter recorded content.
create policy content_draft_versions_annotate on public.content_draft_versions
  for update to authenticated
  using (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id))
  with check (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id));

create policy content_generation_requests_select on public.content_generation_requests
  for select to authenticated using (app.is_org_member(organisation_id));

-- Only those who can write content submit generation requests — a Reviewer
-- reads and approves but does not originate creative briefs.
create policy content_generation_requests_insert on public.content_generation_requests
  for insert to authenticated with check (app.can_write_org(organisation_id));
