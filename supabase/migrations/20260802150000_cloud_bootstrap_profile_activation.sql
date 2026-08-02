-- ===========================================================================
-- Project Genesis — Cloud bootstrap: scoped first-owner activation RPC
--
-- profiles_guard_self_escalation (20260728090100_identity.sql) correctly
-- blocks any UPDATE that changes role/is_active unless app.is_platform_admin()
-- is true. That function checks profiles WHERE id = auth.uid() — and
-- auth.uid() is always NULL for a service-role connection, since there is no
-- end-user JWT `sub` claim to read. This is by design: it stops a
-- compromised anon/authenticated session from self-promoting. But it also
-- means there is no way, through PostgREST at any key tier including
-- service_role, to activate the very first owner account on a brand-new
-- cloud project — scripts/cloud-bootstrap.ts hit exactly this wall (see the
-- "profiles_pkey"/"[object Object]" fixes immediately preceding this
-- migration). supabase/seed.sql works around the same problem locally with
-- `ALTER TABLE ... DISABLE TRIGGER ... ENABLE TRIGGER`, which is raw DDL
-- PostgREST has no equivalent for.
--
-- This function is that one, narrow escape hatch. It does exactly what the
-- guard trigger would otherwise block, but only:
--   1. when NO active owner/admin exists anywhere in the project yet (the
--      guard above proves this is a genuine first-bootstrap, not a
--      privilege-escalation attempt against an already-live project), and
--   2. for a caller holding the service_role key (EXECUTE is revoked from
--      anon and authenticated below — anon already has no USAGE on schema
--      public at all per 20260728090800_privileges.sql, but authenticated
--      is revoked explicitly since `alter default privileges` in that same
--      migration otherwise grants EXECUTE on every new public function to
--      authenticated automatically).
--
-- Once any active owner/admin profile exists, this function permanently
-- refuses to run for the lifetime of the project, closing the exact
-- privilege-escalation hole profiles_guard_self_escalation exists to
-- prevent. It only ever sets the four bootstrap-owned fields
-- (email/full_name/role/is_active) on a single row identified by primary
-- key — every other column is untouched.
-- ===========================================================================

create or replace function public.bootstrap_activate_profile(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role public.platform_role
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if exists (
    select 1 from public.profiles
    where is_active and role in ('owner', 'admin')
  ) then
    raise exception 'Bootstrap already complete: an active administrator already exists. bootstrap_activate_profile only operates on a project with zero active admins.'
      using errcode = '42501';
  end if;

  -- Mirrors supabase/seed.sql's own local bootstrap pattern. Safe
  -- specifically because the check above has already proven no active
  -- admin exists yet for this single-row update to escalate away from, and
  -- this is transactional DDL: if anything below raises, the disable is
  -- rolled back along with it.
  alter table public.profiles disable trigger profiles_guard_self_escalation;

  update public.profiles
  set email = p_email,
      full_name = p_full_name,
      role = p_role,
      is_active = true
  where id = p_user_id
  returning * into v_profile;

  alter table public.profiles enable trigger profiles_guard_self_escalation;

  if v_profile.id is null then
    raise exception 'No profile found for id %', p_user_id
      using errcode = 'P0002';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.bootstrap_activate_profile(uuid, text, text, public.platform_role) from public;
revoke all on function public.bootstrap_activate_profile(uuid, text, text, public.platform_role) from authenticated;
grant execute on function public.bootstrap_activate_profile(uuid, text, text, public.platform_role) to service_role;
