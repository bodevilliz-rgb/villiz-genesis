-- ---------------------------------------------------------------------------
-- Local test harness: emulates the parts of hosted Supabase that our migrations
-- depend on.
--
-- Hosted Supabase provisions `auth` and `storage` before any user migration
-- runs. A bare Postgres does not, so this file creates the minimum surface our
-- schema actually touches: three roles, `auth.users`, `auth.uid()`, and the two
-- `storage` tables our policies key on.
--
-- This is NOT a reimplementation of Supabase. It exists so that migrations,
-- triggers, functions and — critically — RLS policies can be executed and
-- proven locally, in CI, without Docker.
--
-- Anything added here must mirror the real platform's shape. If it drifts, the
-- tests stop meaning anything.
-- ---------------------------------------------------------------------------

-- Roles. PostgREST switches into these per request; our tests do the same with
-- SET LOCAL ROLE, which is what makes RLS assertions real rather than notional.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth authorization postgres;
create schema if not exists storage authorization postgres;
create schema if not exists extensions authorization postgres;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

-- auth.users — only the columns our trigger reads.
create table if not exists auth.users (
  id                uuid primary key default extensions.gen_random_uuid(),
  email             text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- The request-scoped identity. On hosted Supabase this reads the verified JWT;
-- here it reads the same GUC PostgREST sets, so test code and production code
-- take an identical path.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- storage — the two tables our bucket policies reference.
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default extensions.gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated, service_role;
