-- ===========================================================================
-- Project Genesis — Sprint 4: Review Extensions, Auditing, and Notifications
-- ===========================================================================

-- 1. Add 'awaiting_client' to content_draft_status enum if not exists
alter type public.content_draft_status add value if not exists 'awaiting_client';

-- 2. Add columns to public.content_drafts
alter table public.content_drafts
  add column if not exists priority text not null default 'medium' constraint content_drafts_priority_check check (priority in ('low', 'medium', 'high')),
  add column if not exists review_deadline timestamptz;

-- 3. Add columns to public.content_draft_versions
alter table public.content_draft_versions
  add column if not exists priority text not null default 'medium',
  add column if not exists review_deadline timestamptz;

-- 4. Re-declare version-bumping function to capture priority and review_deadline changes
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
     or new.priority is distinct from old.priority
     or new.review_deadline is distinct from old.review_deadline
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

-- 5. Re-declare version-recording function to snapshot priority and review_deadline
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
    category_id, campaign_id, content_type, status, priority, review_deadline, change_summary, changed_by
  )
  values (
    new.id, new.organisation_id, new.version, new.title, new.body,
    new.category_id, new.campaign_id, new.content_type, new.status, new.priority, new.review_deadline,
    case when tg_op = 'INSERT' then 'Draft created' else null end,
    coalesce(new.updated_by, new.created_by)
  )
  on conflict (draft_id, version) do nothing;

  return new;
end;
$$;

-- 6. Create public.audit_events table
create table if not exists public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid references public.content_drafts (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_draft_idx on public.audit_events (draft_id, created_at desc);
create index if not exists audit_events_org_idx on public.audit_events (organisation_id, created_at desc);

-- 7. Enable RLS on audit_events
alter table public.audit_events enable row level security;

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated using (app.is_org_member(organisation_id));

drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events
  for insert to authenticated with check (true);

-- 8. Create public.notifications table
create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_idx on public.notifications (profile_id, created_at desc);

-- 9. Enable RLS on notifications
alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated with check (true);
