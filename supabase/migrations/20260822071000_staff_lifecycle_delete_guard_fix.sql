-- Preview validation exposed the auth.users -> profiles identity row itself in
-- the generic dependency scan. Exclude that identity row, while explicitly
-- requiring pending invitations to be revoked before deletion.
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
