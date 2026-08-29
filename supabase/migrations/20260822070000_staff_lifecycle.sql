-- Complete the staff lifecycle behind service-role-only, actor-authorised RPCs.
create or replace function public.admin_manage_staff_access(
  p_actor_id uuid, p_profile_id uuid, p_role public.platform_role,
  p_is_active boolean, p_access jsonb
) returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_access jsonb;
begin
  if not exists (select 1 from public.profiles where id=p_actor_id and is_active and role in ('owner','admin')) then raise exception 'Only an active platform administrator can manage staff' using errcode='42501'; end if;
  if p_actor_id=p_profile_id then raise exception 'Administrators cannot change their own lifecycle or access' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if v_profile.id is null then raise exception 'Staff profile not found' using errcode='P0002'; end if;
  if v_profile.role='owner' then raise exception 'The platform owner cannot be managed here' using errcode='42501'; end if;
  for v_access in select value from jsonb_array_elements(p_access) loop
    if not exists(select 1 from public.organisations where id=(v_access->>'organisationId')::uuid)
       or (v_access->>'role') not in ('lead','contributor','reviewer') then raise exception 'Invalid organisation access' using errcode='22023'; end if;
  end loop;
  alter table public.profiles disable trigger profiles_guard_self_escalation;
  update public.profiles set role=p_role,is_active=p_is_active where id=p_profile_id returning * into v_profile;
  alter table public.profiles enable trigger profiles_guard_self_escalation;
  delete from public.organisation_members where profile_id=p_profile_id;
  if p_is_active then
    insert into public.organisation_members(organisation_id,profile_id,role,assigned_by)
    select (value->>'organisationId')::uuid,p_profile_id,(value->>'role')::public.organisation_role,p_actor_id from jsonb_array_elements(p_access);
  end if;
  return v_profile;
end $$;

create or replace function public.admin_update_pending_staff_invitation(
  p_actor_id uuid, p_invitation_id uuid, p_role public.platform_role, p_access jsonb
) returns public.staff_invitations language plpgsql security definer set search_path = '' as $$
declare v_invitation public.staff_invitations; v_profile_id uuid; v_access jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and is_active and role in ('owner','admin')) then raise exception 'Only an active platform administrator can manage invitations' using errcode='42501'; end if;
  select * into v_invitation from public.staff_invitations where id=p_invitation_id and status='pending' for update;
  if v_invitation.id is null then raise exception 'Pending invitation not found' using errcode='P0002'; end if;
  for v_access in select value from jsonb_array_elements(p_access) loop
    if not exists(select 1 from public.organisations where id=(v_access->>'organisationId')::uuid)
       or (v_access->>'role') not in ('lead','contributor','reviewer') then raise exception 'Invalid organisation access' using errcode='22023'; end if;
  end loop;
  update public.staff_invitations set platform_role=p_role,organisation_access=p_access where id=p_invitation_id returning * into v_invitation;
  select id into v_profile_id from public.profiles where email=v_invitation.email;
  if v_profile_id is not null then perform public.admin_prepare_staff_invitation(p_actor_id,p_invitation_id,v_profile_id); end if;
  return v_invitation;
end $$;

create or replace function public.admin_reactivate_staff(
  p_actor_id uuid, p_profile_id uuid, p_role public.platform_role, p_access jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_invitation_id uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and is_active and role in ('owner','admin')) then raise exception 'Only an active platform administrator can reactivate staff' using errcode='42501'; end if;
  if p_actor_id=p_profile_id then raise exception 'Administrators cannot reactivate themselves' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=p_profile_id and not is_active for update;
  if v_profile.id is null or v_profile.role='owner' then raise exception 'Inactive staff profile not found' using errcode='P0002'; end if;
  if exists(select 1 from public.staff_invitations where email=v_profile.email and status='pending') then raise exception 'A pending invitation already exists' using errcode='23505'; end if;
  insert into public.staff_invitations(email,full_name,platform_role,organisation_access,status,invited_by)
  values(v_profile.email,coalesce(v_profile.full_name,'Staff member'),p_role,p_access,'pending',p_actor_id) returning id into v_invitation_id;
  perform public.admin_prepare_staff_invitation(p_actor_id,v_invitation_id,p_profile_id);
  return v_invitation_id;
end $$;

create or replace function public.admin_staff_deletion_status(p_actor_id uuid,p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_ref record; v_count bigint; v_total bigint:=0; v_dependencies jsonb:='[]'::jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and is_active and role in ('owner','admin')) then raise exception 'Only an active platform administrator can inspect staff deletion' using errcode='42501'; end if;
  if p_actor_id=p_profile_id then raise exception 'Administrators cannot delete themselves' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=p_profile_id;
  if v_profile.id is null then raise exception 'Staff profile not found' using errcode='P0002'; end if;
  if v_profile.is_active or v_profile.role='owner' then return jsonb_build_object('allowed',false,'dependencyCount',0,'reason','Deactivate this staff member before permanent deletion.'); end if;
  if exists(select 1 from public.staff_invitations where email=v_profile.email and status='pending') then return jsonb_build_object('allowed',false,'dependencyCount',0,'reason','Revoke the pending invitation before permanent deletion.'); end if;
  for v_ref in
    select n.nspname schema_name,c.relname table_name,a.attname column_name
    from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_namespace n on n.oid=c.relnamespace
    join unnest(fk.conkey) with ordinality k(attnum,ord) on true join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
    where fk.contype='f' and n.nspname='public' and fk.confrelid in ('public.profiles'::regclass,'auth.users'::regclass)
      and not (c.relname='profiles' and a.attname='id') and not (c.relname='organisation_members' and a.attname='profile_id') and not (c.relname='notifications' and a.attname='profile_id')
  loop
    execute format('select count(*) from %I.%I where %I=$1',v_ref.schema_name,v_ref.table_name,v_ref.column_name) into v_count using p_profile_id;
    if v_count>0 then v_total:=v_total+v_count; v_dependencies:=v_dependencies||jsonb_build_array(v_ref.table_name); end if;
  end loop;
  if exists(select 1 from public.content_drafts where p_profile_id=any(coalesce(reviewer_ids,'{}'::uuid[]))) then v_total:=v_total+1; v_dependencies:=v_dependencies||'"content_drafts"'::jsonb; end if;
  return jsonb_build_object('allowed',v_total=0,'dependencyCount',v_total,'dependencies',v_dependencies,'reason',case when v_total=0 then null else 'Historical or business records must retain this staff identity. Deactivate access instead.' end);
end $$;

revoke all on function public.admin_manage_staff_access(uuid,uuid,public.platform_role,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.admin_update_pending_staff_invitation(uuid,uuid,public.platform_role,jsonb) from public,anon,authenticated;
revoke all on function public.admin_reactivate_staff(uuid,uuid,public.platform_role,jsonb) from public,anon,authenticated;
revoke all on function public.admin_staff_deletion_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_manage_staff_access(uuid,uuid,public.platform_role,boolean,jsonb) to service_role;
grant execute on function public.admin_update_pending_staff_invitation(uuid,uuid,public.platform_role,jsonb) to service_role;
grant execute on function public.admin_reactivate_staff(uuid,uuid,public.platform_role,jsonb) to service_role;
grant execute on function public.admin_staff_deletion_status(uuid,uuid) to service_role;
