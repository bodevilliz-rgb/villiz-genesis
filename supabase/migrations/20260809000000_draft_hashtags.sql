-- Draft hashtags: first-class field on content_drafts and content_draft_versions.
--
-- Hashtags are stored as normalized tokens (no leading #) in a text array.
-- They are combined with the draft body only at the publishing boundary via
-- composePublishedText() — the stored body column is never modified.
--
-- Both tables receive the column so that version snapshots include hashtags,
-- and restoring a version also restores the hashtag set that existed at that
-- point in time.
--
-- The existing trigger that writes version rows on content_drafts updates will
-- copy the hashtags column automatically once it is present on both tables.

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS hashtags text[] NOT NULL DEFAULT '{}';

ALTER TABLE content_draft_versions
  ADD COLUMN IF NOT EXISTS hashtags text[] NOT NULL DEFAULT '{}';

-- Re-create content_draft_bump_version so a hashtag-only change increments
-- the version counter. The original function (20260801120000_review_extensions)
-- did not know about this column.
create or replace function app.content_draft_bump_version()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.category_id is distinct from old.category_id
     or new.campaign_id is distinct from old.campaign_id
     or new.content_type is distinct from old.content_type
     or new.status is distinct from old.status
     or new.priority is distinct from old.priority
     or new.review_deadline is distinct from old.review_deadline
     or new.hashtags is distinct from old.hashtags
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

-- Re-create content_draft_record_version so version snapshots include the
-- hashtags that were stored at the time of the save.
create or replace function app.content_draft_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.version = old.version then
    return new;
  end if;

  insert into public.content_draft_versions (
    draft_id, organisation_id, version, title, body, hashtags,
    category_id, content_type, status, change_summary, changed_by
  )
  values (
    new.id, new.organisation_id, new.version, new.title, new.body, new.hashtags,
    new.category_id, new.content_type, new.status,
    case when tg_op = 'INSERT' then 'Draft created' else null end,
    coalesce(new.updated_by, new.created_by)
  )
  on conflict (draft_id, version) do nothing;

  return new;
end;
$$;
