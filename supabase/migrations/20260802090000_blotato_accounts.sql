-- ===========================================================================
-- Project Genesis — Sprint 6B: Blotato real publishing integration
--
-- Purely additive. `blotato_accounts` records every social account Blotato
-- reports as connected to this platform's single Blotato workspace — the
-- API key configured via BLOTATO_API_KEY belongs to Villiz Pixels Studio as
-- a whole, not to any one client organisation, and Blotato itself has no
-- concept of a Villiz "organisation". This table is therefore deliberately
-- NOT organisation-scoped, unlike every other table in this schema.
--
-- Populated exclusively by testBlotatoConnection()
-- (core/application/use-cases/blotato.ts) whenever an operator clicks
-- "Test Connection" on the Publishing Settings page (/settings/publishing).
--
-- `platform` is a free-form text column, not the existing
-- `public.publishing_platform` enum — Blotato supports platforms (TikTok,
-- Pinterest, Threads, Bluesky, YouTube, ...) this app's publishing engine
-- does not yet drive, and this table records every account Blotato reports,
-- not just the four this app can currently publish through. Only rows whose
-- platform maps to linkedin/facebook/instagram/x (Blotato calls the last one
-- "twitter" — see mapBlotatoPlatform in core/domain/entities/blotato.ts) are
-- usable by BlotatoPublisherBase to resolve an accountId for a real publish.
-- ===========================================================================

create table public.blotato_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  blotato_account_id text not null,
  platform text not null,
  fullname text,
  username text,
  first_connected_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint blotato_accounts_blotato_account_id_unique unique (blotato_account_id)
);

create index blotato_accounts_platform_idx on public.blotato_accounts (platform);

drop trigger if exists blotato_accounts_touch_updated_at on public.blotato_accounts;
create trigger blotato_accounts_touch_updated_at
  before update on public.blotato_accounts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — platform-wide configuration data, not organisation data.
-- Any authenticated Villiz staff member may see which accounts are
-- connected (needed to understand what a publish can target), but only a
-- platform administrator's "Test Connection" action may write to it.
-- ---------------------------------------------------------------------------
alter table public.blotato_accounts enable row level security;

create policy blotato_accounts_select on public.blotato_accounts
  for select to authenticated using (true);

create policy blotato_accounts_insert on public.blotato_accounts
  for insert to authenticated with check (app.is_platform_admin());

create policy blotato_accounts_update on public.blotato_accounts
  for update to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

create policy blotato_accounts_delete on public.blotato_accounts
  for delete to authenticated using (app.is_platform_admin());
