-- One aggregate row crosses the API boundary. Invoker security preserves media RLS.
create or replace function public.get_media_library_stats(p_organisation_id uuid)
returns table(total_assets bigint, image_count bigint, video_count bigint, total_storage_bytes bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*), count(*) filter (where mime_type like 'image/%'),
    count(*) filter (where mime_type like 'video/%'), coalesce(sum(size_bytes), 0)::bigint
  from public.media_assets where organisation_id = p_organisation_id;
$$;
revoke all on function public.get_media_library_stats(uuid) from public, anon;
grant execute on function public.get_media_library_stats(uuid) to authenticated, service_role;
