-- ---------------------------------------------------------------------------
-- Onboarding date as a database rule.
--
-- Found by testing: `onboarded_at` was stamped in the TypeScript repository, in
-- the create path only. Two consequences, both wrong:
--
--   1. An organisation created as `prospect` and later promoted to `active` —
--      the normal commercial path — never recorded an onboarding date at all.
--   2. Any write that did not go through that one function (a dashboard fix, a
--      restore, a future automation) silently skipped it.
--
-- The date a client came on board is a fact about the client, not a side effect
-- of one code path, so it belongs in the database.
-- ---------------------------------------------------------------------------

create or replace function app.stamp_onboarded_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Stamp the first time the record is active, and never again. Re-activating
  -- a paused client must not rewrite the original onboarding date.
  if new.status = 'active' and new.onboarded_at is null then
    new.onboarded_at := current_date;
  end if;

  return new;
end;
$$;

comment on function app.stamp_onboarded_at() is
  'Records the date an organisation first became active. Idempotent by design.';

drop trigger if exists organisations_stamp_onboarded_at on public.organisations;
create trigger organisations_stamp_onboarded_at
  before insert or update of status on public.organisations
  for each row
  execute function app.stamp_onboarded_at();
