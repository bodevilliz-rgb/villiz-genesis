-- Preserve append-only draft history during normal operation while allowing
-- PostgreSQL's existing ON DELETE CASCADE to remove that history when the
-- owning, unpublished draft itself is deliberately deleted.
--
-- A direct DELETE against content_draft_versions enters this trigger at depth
-- 1 and remains forbidden. The FK cascade is invoked by the parent draft's
-- referential-action trigger and reaches this trigger at a nested depth.
create or replace function app.guard_content_draft_version_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;

    raise exception 'Content draft version history cannot be deleted' using errcode = '42501';
  end if;

  if old.change_summary is not null then
    raise exception 'This version is already sealed' using errcode = '42501';
  end if;

  if new.draft_id is distinct from old.draft_id
     or new.version is distinct from old.version
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.category_id is distinct from old.category_id
     or new.campaign_id is distinct from old.campaign_id
     or new.content_type is distinct from old.content_type
     or new.status is distinct from old.status
     or new.changed_by is distinct from old.changed_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Content draft version history is append-only' using errcode = '42501';
  end if;

  return new;
end;
$$;
