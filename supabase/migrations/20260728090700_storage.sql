-- ===========================================================================
-- Project Genesis — 0008 Storage
--
-- One private bucket for all client media. Isolation is by path prefix:
--   organisations/<organisation_id>/<asset_id>/<filename>
-- The first path segment after `organisations/` is validated against
-- membership on every operation, so an object can never be read by staff who
-- are not assigned to that client.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organisation-media',
  'organisation-media',
  false,
  524288000, -- 500 MB per object
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

create or replace function app.storage_org_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  if split_part(p_name, '/', 1) <> 'organisations' then
    return null;
  end if;
  return nullif(split_part(p_name, '/', 2), '')::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

drop policy if exists "organisation media read" on storage.objects;
create policy "organisation media read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'organisation-media'
    and app.is_org_member(app.storage_org_id(name))
  );

drop policy if exists "organisation media write" on storage.objects;
create policy "organisation media write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'organisation-media'
    and app.can_write_org(app.storage_org_id(name))
  );

drop policy if exists "organisation media update" on storage.objects;
create policy "organisation media update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'organisation-media'
    and app.can_write_org(app.storage_org_id(name))
  );

drop policy if exists "organisation media delete" on storage.objects;
create policy "organisation media delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'organisation-media'
    and app.can_manage_org(app.storage_org_id(name))
  );
