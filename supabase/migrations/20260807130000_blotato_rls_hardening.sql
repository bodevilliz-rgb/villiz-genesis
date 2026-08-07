-- ===========================================================================
-- Project Genesis — Sprint 10A.1: Blotato accounts RLS hardening
--
-- EXISTING RLS STATE (from 20260802090000_blotato_accounts.sql)
-- RLS is ENABLED on blotato_accounts with four policies:
--   blotato_accounts_select: FOR SELECT USING (true)
--     → any authenticated user sees ALL rows (no org filter)
--   blotato_accounts_insert: FOR INSERT WITH CHECK (app.is_platform_admin())
--   blotato_accounts_update: FOR UPDATE USING/WITH CHECK (app.is_platform_admin())
--   blotato_accounts_delete: FOR DELETE USING (app.is_platform_admin())
--
-- PROBLEM
-- The original design intentionally made blotato_accounts platform-wide
-- because Blotato has one workspace per Villiz. At that point the table had
-- no organisation_id and there was only one client, so USING (true) was safe.
-- After Sprint 10A adds organisation_id (20260807120000), a regular staff
-- member assigned to org A can now read org B's Blotato account rows via the
-- authenticated Supabase client — even though the application layer enforces
-- the org filter in findMostRecentForPlatform, the database itself applies no
-- per-row access control.
--
-- FIX 1 — Organisation-scoped SELECT
-- Replace the unrestricted USING (true) with:
--   platform admins: see every row (NULL-org legacy + all org-scoped)
--   regular staff:   see only rows for organisations they are assigned to
--   NULL-org rows:   not visible to non-admins (require admin backfill)
--
-- This matches the pattern used by content_drafts, campaigns, membrain, etc.
--
-- FIX 2 — Preserve existing organisation_id on upsert
-- testBlotatoConnection currently calls upsertAccounts(summaries, null).
-- Without protection, a Supabase ON CONFLICT DO UPDATE can overwrite a
-- previously assigned organisation_id back to NULL. This is a silent data
-- loss scenario.
--
-- A BEFORE UPDATE trigger preserves any non-null organisation_id when an
-- incoming UPDATE/upsert supplies NULL. This is the authoritative enforcement
-- — it lives in the database, not in application code, so it is immune to
-- future code changes that might forget this contract.
--
-- SERVICE-ROLE / WORKER ACCESS
-- The publishing worker uses createAdminClient() (service-role key) which
-- bypasses RLS entirely — this behaviour is unchanged and is correct. The
-- worker must be able to read accounts for any organisation it publishes for.
--
-- MANUAL BACKFILL (no change from 20260807120000)
-- The SELECT policy change means non-admin staff can no longer read NULL-org
-- rows. This is correct: NULL-org rows are not yet assigned and cannot drive
-- a publish. An operator must run the backfill below BEFORE the settings UI
-- shows accounts to regular staff.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- FIX 1: Replace the unrestricted SELECT policy with org-scoped visibility
-- ---------------------------------------------------------------------------

drop policy if exists blotato_accounts_select on public.blotato_accounts;

create policy blotato_accounts_select on public.blotato_accounts
  for select to authenticated using (
    -- Platform admins see every row — NULL-org legacy and all org-scoped rows.
    -- Required for the admin Settings > Publishing UI and for audit.
    app.is_platform_admin()
    or
    -- Regular staff see only rows assigned to organisations they belong to.
    -- Rows with organisation_id IS NULL are not visible to non-admins; they
    -- require an operator backfill before becoming usable.
    (
      organisation_id is not null
      and app.is_org_member(organisation_id)
    )
  );

-- ---------------------------------------------------------------------------
-- FIX 2: Preserve organisation_id across Test Connection upserts
--
-- testBlotatoConnection has no org context and correctly passes null as
-- organisationId. Without this trigger, the resulting ON CONFLICT DO UPDATE
-- would overwrite an already-assigned organisation_id back to NULL.
--
-- The trigger preserves the existing value whenever:
--   OLD.organisation_id IS NOT NULL   (a prior assignment exists)
--   AND NEW.organisation_id IS NULL   (the incoming update supplies null)
--
-- An explicit null-to-non-null assignment (an operator manually assigning an
-- org via SQL or a future org-aware UI) still works — only null-clears are
-- blocked, not explicit assignments.
-- ---------------------------------------------------------------------------

create or replace function app.blotato_preserve_organisation_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.organisation_id is not null and new.organisation_id is null then
    new.organisation_id := old.organisation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists blotato_preserve_organisation_id_trigger on public.blotato_accounts;
create trigger blotato_preserve_organisation_id_trigger
  before update on public.blotato_accounts
  for each row execute function app.blotato_preserve_organisation_id();
