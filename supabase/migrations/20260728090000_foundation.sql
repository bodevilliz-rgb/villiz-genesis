-- ===========================================================================
-- Project Genesis — 0001 Foundation
--
-- Establishes extensions, the private `app` helper schema, and shared triggers.
--
-- DESIGN NOTE: all authorisation helpers live in a private `app` schema rather
-- than `public`. They are SECURITY DEFINER so that they can read membership
-- tables without themselves being filtered by RLS — this is what prevents
-- infinite policy recursion (a policy on organisation_members that queries
-- organisation_members). `search_path` is pinned to '' on every definer
-- function to eliminate search-path hijacking.
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;
create extension if not exists "unaccent" with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at without trusting the client
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Slug generation. Used for organisation short codes and tag slugs.
-- ---------------------------------------------------------------------------
create or replace function app.slugify(p_input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      lower(extensions.unaccent(coalesce(p_input, ''))),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;
