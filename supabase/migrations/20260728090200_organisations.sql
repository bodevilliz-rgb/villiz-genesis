-- ===========================================================================
-- Project Genesis — 0003 Organisations
--
-- An Organisation is a Villiz CLIENT ACCOUNT, not a tenant that logs in.
-- It is the isolation boundary for every other entity in the platform.
--
-- Access model:
--   platform owner/admin -> every organisation (agency leadership)
--   assigned staff       -> only organisations they are a member of
-- ===========================================================================

create type public.organisation_status as enum ('prospect', 'active', 'paused', 'offboarded');
create type public.organisation_role as enum ('lead', 'contributor', 'reviewer');

create table public.organisations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  legal_name text,
  industry text,
  website_url text,
  status public.organisation_status not null default 'prospect',
  brand_colour text,
  primary_contact_name text,
  primary_contact_email text,
  notes text,
  onboarded_at date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organisations_name_length check (char_length(trim(name)) between 2 and 120),
  constraint organisations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organisations_contact_email_format check (
    primary_contact_email is null or primary_contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  constraint organisations_brand_colour_format check (
    brand_colour is null or brand_colour ~ '^#[0-9a-fA-F]{6}$'
  )
);

create index organisations_status_idx on public.organisations (status);
create index organisations_name_trgm_idx on public.organisations using gin (name extensions.gin_trgm_ops);

drop trigger if exists organisations_touch_updated_at on public.organisations;
create trigger organisations_touch_updated_at
  before update on public.organisations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Staff assignment
-- ---------------------------------------------------------------------------
create table public.organisation_members (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.organisation_role not null default 'contributor',
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organisation_id, profile_id)
);

create index organisation_members_profile_idx on public.organisation_members (profile_id);

-- ---------------------------------------------------------------------------
-- Authorisation helpers (SECURITY DEFINER: breaks RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function app.is_org_member(p_organisation_id uuid)
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
      and p.is_active
  );
$$;

create or replace function app.can_manage_org(p_organisation_id uuid)
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
      and m.role = 'lead'
      and p.is_active
  );
$$;

create or replace function app.can_write_org(p_organisation_id uuid)
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
      and m.role in ('lead', 'contributor')
      and p.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;

create policy organisations_select on public.organisations
  for select to authenticated
  using (app.is_org_member(id));

-- Only platform admins onboard a new client. This is a commercial decision,
-- not a technical one: client onboarding is an agency leadership action.
create policy organisations_insert on public.organisations
  for insert to authenticated
  with check (app.is_platform_admin());

create policy organisations_update on public.organisations
  for update to authenticated
  using (app.can_manage_org(id))
  with check (app.can_manage_org(id));

create policy organisations_delete on public.organisations
  for delete to authenticated
  using (app.is_platform_admin());

create policy organisation_members_select on public.organisation_members
  for select to authenticated
  using (app.is_org_member(organisation_id));

create policy organisation_members_write on public.organisation_members
  for all to authenticated
  using (app.can_manage_org(organisation_id))
  with check (app.can_manage_org(organisation_id));

-- ---------------------------------------------------------------------------
-- The creating admin is automatically the account lead. Without this, an admin
-- could create an organisation and immediately lose write access to it.
-- ---------------------------------------------------------------------------
create or replace function app.assign_creator_as_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.organisation_members (organisation_id, profile_id, role, assigned_by)
    values (new.id, new.created_by, 'lead', new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists organisations_assign_creator on public.organisations;
create trigger organisations_assign_creator
  after insert on public.organisations
  for each row execute function app.assign_creator_as_lead();
