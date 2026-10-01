-- Remove content from operator-facing workspaces without destroying the
-- publishing receipts, attempts, reviews, and analytics required for audit
-- and duplicate-submission prevention.
alter table public.content_drafts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

alter table public.content_drafts
  drop constraint if exists content_drafts_soft_delete_pair;

alter table public.content_drafts
  add constraint content_drafts_soft_delete_pair
  check ((deleted_at is null) = (deleted_by is null));

create index if not exists content_drafts_active_org_updated_idx
  on public.content_drafts (organisation_id, updated_at desc)
  where deleted_at is null;

create or replace function app.guard_content_draft_soft_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null and
     (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
  then
    raise exception 'Removed content cannot be restored or reassigned directly' using errcode = '42501';
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    if old.status in ('scheduled', 'publishing', 'published') then
      raise exception 'Scheduled, publishing, and published content cannot be removed' using errcode = '23514';
    end if;
    if not app.can_write_org(old.organisation_id) then
      raise exception 'Content removal requires write access' using errcode = '42501';
    end if;
    new.deleted_at := now();
    new.deleted_by := (select auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists content_drafts_guard_soft_delete on public.content_drafts;
create trigger content_drafts_guard_soft_delete
  before update of deleted_at, deleted_by on public.content_drafts
  for each row execute function app.guard_content_draft_soft_delete();

-- Deletion is now deliberately logical. This prevents any future code path
-- from cascading away provider receipts or immutable review evidence.
drop policy if exists content_drafts_delete_unpublished on public.content_drafts;

