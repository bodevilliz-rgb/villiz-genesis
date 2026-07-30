-- ===========================================================================
-- Project Genesis — 0002 Identity
--
-- Villiz staff are the ONLY identities in this system. Clients never receive
-- credentials. Two layers enforce that:
--   1. Application layer rejects sign-in for non-allowlisted email domains.
--   2. Database layer refuses to activate a profile for a non-allowlisted
--      domain, so a leaked anon key still cannot mint a working account.
-- ===========================================================================

create type public.platform_role as enum ('owner', 'admin', 'member');

-- Platform-wide configuration, single row enforced by a check constraint.
create table public.platform_settings (
  id boolean primary key default true,
  allowed_email_domains text[] not null default array['villiz.com'],
  updated_at timestamptz not null default now(),
  constraint platform_settings_singleton check (id)
);

insert into public.platform_settings (id) values (true) on conflict do nothing;

-- Villiz staff profile, 1:1 with auth.users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  job_title text,
  role public.platform_role not null default 'member',
  is_active boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role) where is_active;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Provisioning: create a profile whenever an auth user is created.
-- Activation is granted only to allowlisted domains. Everyone else lands as an
-- inactive profile that cannot read a single row anywhere in the platform.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := lower(split_part(new.email, '@', 2));
  v_allowed text[];
  v_is_first boolean;
begin
  select allowed_email_domains into v_allowed from public.platform_settings where id;
  select count(*) = 0 into v_is_first from public.profiles;

  insert into public.profiles (id, email, full_name, avatar_url, role, is_active)
  values (
    new.id,
    lower(new.email),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    case when v_is_first then 'owner'::public.platform_role else 'member'::public.platform_role end,
    v_domain = any (v_allowed)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Authorisation helpers
-- ---------------------------------------------------------------------------
create or replace function app.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.platform_settings enable row level security;

-- Staff directory is visible to active staff: they collaborate on the same
-- client accounts and need to see who owns what.
create policy profiles_select_active_staff on public.profiles
  for select to authenticated
  using (app.is_active_staff());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

create policy platform_settings_read on public.platform_settings
  for select to authenticated
  using (app.is_active_staff());

create policy platform_settings_admin_write on public.platform_settings
  for all to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- Privilege escalation guard: a member must not be able to promote themselves
-- to admin via the self-update policy.
create or replace function app.guard_profile_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_platform_admin() then
    return new;
  end if;

  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    raise exception 'Only platform administrators can change role or activation state'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_self_escalation on public.profiles;
create trigger profiles_guard_self_escalation
  before update on public.profiles
  for each row execute function app.guard_profile_self_escalation();
