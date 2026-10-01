-- Keep database deletion authority aligned with the application rule:
-- every non-published lifecycle state is deletable, while scheduled work,
-- active publishing, and published evidence remain protected.
drop policy if exists content_drafts_delete_unpublished on public.content_drafts;

create policy content_drafts_delete_unpublished
  on public.content_drafts
  for delete
  to authenticated
  using (
    status not in ('scheduled', 'publishing', 'published')
    and app.can_write_org(organisation_id)
  );

-- Review history stays immutable when addressed directly. Its existing FK is
-- ON DELETE CASCADE, however, so a deliberate parent-draft deletion must be
-- allowed to remove the now-orphaned history in the same transaction.
create or replace function app.guard_content_draft_reviews_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception 'Review history cannot be modified or deleted' using errcode = '42501';
end;
$$;
