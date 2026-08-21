-- Atomically activate the identity and replace its complete organisation
-- access set from one pending, identity-bound staff invitation.
create or replace function public.admin_prepare_staff_invitation(
  p_actor_id uuid,
  p_invitation_id uuid,
  p_profile_id uuid
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.staff_invitations;
  v_profile public.profiles;
  v_access jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_active and role in ('owner', 'admin')
  ) then
    raise exception 'Only an active platform administrator can prepare staff access'
      using errcode = '42501';
  end if;

  select * into v_invitation
  from public.staff_invitations
  where id = p_invitation_id and status = 'pending'
  for update;
  if v_invitation.id is null then
    raise exception 'Pending staff invitation not found' using errcode = 'P0002';
  end if;

  select * into v_profile from public.profiles where id = p_profile_id for update;
  if v_profile.id is null or lower(v_profile.email) <> v_invitation.email then
    raise exception 'Invitation identity does not match the authenticated profile'
      using errcode = '42501';
  end if;

  for v_access in select value from jsonb_array_elements(v_invitation.organisation_access)
  loop
    if not exists (
      select 1 from public.organisations
      where id = (v_access ->> 'organisationId')::uuid
    ) or (v_access ->> 'role') not in ('lead', 'contributor', 'reviewer') then
      raise exception 'Invitation contains invalid organisation access'
        using errcode = '22023';
    end if;
  end loop;

  alter table public.profiles disable trigger profiles_guard_self_escalation;
  update public.profiles
  set full_name = v_invitation.full_name,
      role = v_invitation.platform_role,
      is_active = true
  where id = p_profile_id
  returning * into v_profile;
  alter table public.profiles enable trigger profiles_guard_self_escalation;

  delete from public.organisation_members where profile_id = p_profile_id;
  insert into public.organisation_members (organisation_id, profile_id, role, assigned_by)
  select
    (value ->> 'organisationId')::uuid,
    p_profile_id,
    (value ->> 'role')::public.organisation_role,
    p_actor_id
  from jsonb_array_elements(v_invitation.organisation_access);

  return v_profile;
end;
$$;

revoke all on function public.admin_prepare_staff_invitation(uuid, uuid, uuid) from public;
revoke all on function public.admin_prepare_staff_invitation(uuid, uuid, uuid) from anon;
revoke all on function public.admin_prepare_staff_invitation(uuid, uuid, uuid) from authenticated;
grant execute on function public.admin_prepare_staff_invitation(uuid, uuid, uuid) to service_role;
