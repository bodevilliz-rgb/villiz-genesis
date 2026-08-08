-- ===========================================================================
-- Project Genesis — Blotato provider account lifecycle
--
-- PROBLEM
-- The `active` column is overloaded: it was set to false both when an
-- operator removes a Genesis-to-org mapping (removeFromOrganisation) and
-- when a provider account is no longer returned by Blotato. These are
-- distinct events with different semantics:
--
--   Genesis mapping removed   → account should remain available for
--                               reassignment to another org IF the provider
--                               still reports it.
--
--   Provider account gone     → account should not be offered for
--                               assignment until the provider reports it
--                               again.
--
-- With a single `active` flag, removeFromOrganisation(accId) sets
-- active=false and the account silently disappears from the Available list
-- even though Blotato still knows about it — the confirmed production
-- symptom for @villizpixelsuk (organisation_id=NULL, active=false,
-- provider still returning the account in Test Connection).
--
-- FIX
-- Add provider_active boolean NOT NULL DEFAULT false.
--
-- `active`         — Genesis mapping status. True when the account is
--                    assigned to an org and available for publishing.
--                    Set false by removeFromOrganisation; set back to true
--                    by assignToOrganisation.
--
-- `provider_active` — Provider availability. True when Blotato's
--                     listAccounts returned this account in the last sync.
--                     Set true by upsertAccounts for every returned account.
--                     Set false by upsertAccounts for accounts NOT returned
--                     in the current batch (sweep after each sync).
--
-- Available-for-assignment filter: organisation_id IS NULL AND provider_active = true
-- (active is irrelevant for unassigned accounts — it records a prior mapping's
-- state, not the account's current provider availability)
--
-- Publishing eligibility filter:   organisation_id = org AND active = true
--                                  AND provider_active = true
--
-- DEFAULT false (fail-closed): all historical rows begin provider-unverified.
-- The first Test Connection after this migration runs will set provider_active=true
-- for every account Blotato currently returns, and sweep any that are no longer
-- present. Until that first sync completes:
--   - Unassigned historical accounts are NOT offered for new assignment.
--   - Assigned historical accounts are NOT eligible for publishing.
-- This is intentional: we have no evidence the provider currently reports them.
-- ===========================================================================

ALTER TABLE public.blotato_accounts
  ADD COLUMN IF NOT EXISTS provider_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.blotato_accounts.provider_active IS
  'True when this account was returned by the provider (Blotato) in the most '
  'recent listAccounts sync. Distinct from active, which tracks whether the '
  'Genesis-to-org mapping is live. provider_active=false means the provider has '
  'not yet verified this account in the current deployment; such rows are excluded '
  'from assignment and from publishing, but are preserved for history and recover '
  'automatically when the provider reports the account again in a future sync. '
  'DEFAULT false: all historical rows begin provider-unverified; the first Test '
  'Connection after migration activates whichever accounts Blotato returns.';

-- Index for the available-for-assignment query (unassigned + provider active).
CREATE INDEX IF NOT EXISTS idx_blotato_accounts_unassigned_provider_active
  ON public.blotato_accounts (provider_active)
  WHERE organisation_id IS NULL AND provider_active = true;
