-- ===========================================================================
-- Project Genesis — Sprint 10A: Organisation-scoped Blotato accounts
--
-- PROBLEM
-- blotato_accounts had no organisation_id column. findMostRecentForPlatform
-- returned the most-recently-verified account platform-wide, meaning a
-- second client's Instagram account could appear when resolving org A's
-- publish. This migration closes that gap permanently.
--
-- APPROACH
-- 1. Add organisation_id (nullable) with a FK to organisations.
-- 2. Leave existing rows with organisation_id = NULL — they cannot be
--    auto-assigned without knowing which client they belong to.
-- 3. Publishing account resolution (findMostRecentForPlatform) now requires
--    a matching organisation_id and NEVER falls back to null-org rows.
--    Null-org rows are visible in the admin settings UI (they've always been
--    there) but blocked from driving a real publish until an operator
--    backfills organisation_id.
--
-- MANUAL BACKFILL REQUIRED BEFORE LIVE PUBLISHING
-- Any blotato_account row with organisation_id IS NULL cannot be used by
-- the publishing worker. An operator must run:
--
--   UPDATE public.blotato_accounts
--     SET organisation_id = '<target-org-uuid>'
--   WHERE organisation_id IS NULL
--     AND platform = '<blotato-platform-string>';
--
-- OR re-run "Test Connection" once the publishing settings page is updated
-- to pass the org context through (planned for Sprint 10B).
--
-- SAFETY: This migration is purely additive. No existing row is deleted or
-- updated. The publishing engine was in simulation mode during this sprint,
-- so no live publish was ever relying on findMostRecentForPlatform.
-- ===========================================================================

-- Add organisation_id, nullable so existing rows survive without backfill.
alter table public.blotato_accounts
  add column if not exists organisation_id uuid
    references public.organisations (id)
    on delete set null;

-- Index for the org-scoped account lookup in BlotatoPublisherBase.
create index if not exists blotato_accounts_org_platform_idx
  on public.blotato_accounts (organisation_id, platform);

-- ---------------------------------------------------------------------------
-- RLS — no change to read policy (all authenticated users may read, needed
-- for the admin settings UI). Write policies stay platform-admin only.
-- No row-level filtering on organisation_id for reads — the settings page
-- shows every stored account regardless of org, which is correct for an
-- operator auditing what accounts exist.
--
-- Publishing account resolution is enforced in application code
-- (findMostRecentForPlatform filters by organisation_id, never falls back).
-- ---------------------------------------------------------------------------
