-- ---------------------------------------------------------------------------
-- Explicit table privileges.
--
-- Found by testing: nothing in migrations 0000–0700 granted a single table
-- privilege. The schema worked on hosted Supabase only because the platform
-- pre-configures default privileges on `public` at project creation. Every
-- query failed with "permission denied" against a database that had not been
-- through that bootstrap.
--
-- Depending on a platform default for the privilege layer is not acceptable in
-- a schema that is meant to be restorable, forkable and testable. Migrations
-- now grant what they need.
--
-- Two layers, doing different jobs:
--   GRANT decides whether a role may touch a table at all.
--   RLS   decides which rows it may touch.
-- Both are required. Neither substitutes for the other.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated, service_role;

-- `anon` is deliberately given nothing.
--
-- This is stricter than Supabase's default, which grants `anon` full table
-- privileges and relies on RLS alone to return zero rows. Genesis has no
-- unauthenticated surface — clients never log in and there is no public
-- content — so an unauthenticated request should be refused at the privilege
-- layer, before RLS is ever consulted. A policy mistake then costs nothing.
revoke all on all tables in schema public from anon;
revoke all on schema public from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Views are not covered by the blanket table grant on every Postgres version;
-- name it explicitly.
grant select on public.organisation_usage_snapshot to authenticated, service_role;

grant execute on all functions in schema public to authenticated, service_role;

-- Tables added by later migrations inherit these grants automatically, so a new
-- table cannot ship with a privilege gap that nobody notices.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- Two tables are read-only to staff regardless of role. Platform settings are
-- changed by an administrator through the dashboard, and version history is
-- append-only by trigger — but privileges should say so too, rather than
-- relying on the trigger as the only line of defence.
revoke insert, update, delete on public.platform_settings from authenticated;
revoke delete on public.membrain_entry_versions from authenticated;
