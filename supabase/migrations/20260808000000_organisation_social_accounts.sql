-- Sprint 10B — Multi-client social account routing.
--
-- Two additive changes:
--
-- 1. blotato_accounts.active (boolean, default true)
--    False once an operator removes a channel from an org. Rows with active=false are
--    never selected by the publisher and never returned by listActiveForOrganisation.
--    The row is kept (not deleted) so history is preserved and re-assignment is possible.
--
-- 2. publishing_jobs.resolved_account_id (text, nullable)
--    Destination lock: set at scheduling time to the exact blotato_account_id the worker
--    should publish through. Prevents silent re-routing if channel mappings change between
--    schedule and execution. Null for jobs scheduled before this column was added.

ALTER TABLE public.blotato_accounts
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE public.publishing_jobs
  ADD COLUMN IF NOT EXISTS resolved_account_id text;

-- Hot-path index: publisher resolution reads (organisation_id, platform) with active=true.
CREATE INDEX IF NOT EXISTS idx_blotato_accounts_org_platform_active
  ON public.blotato_accounts (organisation_id, platform)
  WHERE active = true AND organisation_id IS NOT NULL;

-- Diagnostic index: list all active channels for an org (Connected Channels panel).
CREATE INDEX IF NOT EXISTS idx_blotato_accounts_org_active
  ON public.blotato_accounts (organisation_id)
  WHERE active = true AND organisation_id IS NOT NULL;
