-- ---------------------------------------------------------------------------
-- Fix: blotato_preserve_organisation_id trigger conflicts with explicit
-- channel removal.
--
-- The original trigger (20260807130000_blotato_rls_hardening.sql) preserved
-- organisation_id whenever old.organisation_id IS NOT NULL and
-- new.organisation_id IS NULL — intended to protect against Test Connection
-- upserts clearing Genesis ownership.
--
-- Problem: removeFromOrganisation deliberately sets
--   { active: false, organisation_id: null }
-- to free the account for cross-org re-assignment. The trigger blocked this,
-- leaving organisation_id set even after removal — making it impossible for a
-- platform admin to reassign the account to a different organisation without
-- direct DB access.
--
-- Fix: only preserve organisation_id when new.active IS TRUE (or the active
-- column is not being changed and retains its existing true value). A row
-- being deactivated (new.active = false) is an explicit admin removal; the
-- null-clear is intentional and must be allowed through.
--
-- Security invariant maintained:
--   Test Connection upserts do NOT include `active` in their SET clause, so
--   new.active in the trigger reflects the existing row value (true for any
--   account that is still live). The guard still fires and preserves
--   organisation_id for all sync operations.
--
-- Cross-org reassignment flow after this fix:
--   1. removeFromOrganisation(accId)   → active=false, organisation_id=null
--   2. assignToOrganisation(accId, newOrg) → active=true, organisation_id=newOrg
-- ---------------------------------------------------------------------------

create or replace function app.blotato_preserve_organisation_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only preserve an existing org assignment when the row is staying active.
  -- A deactivation (new.active = false) is an explicit admin removal — allow
  -- the organisation_id to be cleared so the account can be re-assigned later.
  if old.organisation_id is not null
     and new.organisation_id is null
     and new.active is distinct from false
  then
    new.organisation_id := old.organisation_id;
  end if;
  return new;
end;
$$;

-- The trigger definition itself does not change — only the function body above.
-- Recreating it here for explicitness and to guarantee the trigger is wired
-- to the updated function body on every migration run.
drop trigger if exists blotato_preserve_organisation_id_trigger on public.blotato_accounts;
create trigger blotato_preserve_organisation_id_trigger
  before update on public.blotato_accounts
  for each row execute function app.blotato_preserve_organisation_id();
