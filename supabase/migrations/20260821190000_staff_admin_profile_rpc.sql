-- Narrow service-role bridge for the staff administration server action.
-- The actor is re-authorised inside the database; authenticated/anon callers
-- cannot execute this function and the self-escalation trigger remains intact.
create or replace function public.admin_set_staff_profile(
  p_actor_id uuid,
  p_profile_id uuid,
  p_full_name text,
  p_role public.platform_role,
  p_is_active boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_current public.profiles;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_active and role in ('owner', 'admin')
  ) then
    raise exception 'Only an active platform administrator can manage staff'
      using errcode = '42501';
  end if;

  select * into v_current from public.profiles where id = p_profile_id for update;
  if v_current.id is null then
    raise exception 'Staff profile not found' using errcode = 'P0002';
  end if;

  if v_current.is_active and v_current.role in ('owner', 'admin')
     and (not p_is_active or p_role = 'member')
     and (select count(*) from public.profiles where is_active and role in ('owner', 'admin')) = 1 then
    raise exception 'Genesis must retain at least one active platform administrator'
      using errcode = '23514';
  end if;

  alter table public.profiles disable trigger profiles_guard_self_escalation;
  update public.profiles
  set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      role = p_role,
      is_active = p_is_active
  where id = p_profile_id
  returning * into v_profile;
  alter table public.profiles enable trigger profiles_guard_self_escalation;

  return v_profile;
end;
$$;

revoke all on function public.admin_set_staff_profile(uuid, uuid, text, public.platform_role, boolean) from public;
revoke all on function public.admin_set_staff_profile(uuid, uuid, text, public.platform_role, boolean) from anon;
revoke all on function public.admin_set_staff_profile(uuid, uuid, text, public.platform_role, boolean) from authenticated;
grant execute on function public.admin_set_staff_profile(uuid, uuid, text, public.platform_role, boolean) to service_role;
