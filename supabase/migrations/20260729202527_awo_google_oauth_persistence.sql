-- Awo — persistent Google OAuth connections
-- Tables: google_oauth_tokens, google_accounts
-- Safe to run on a database that already has 0001_init.sql and
-- 0002_knowledge_memory.sql.
--
-- Purpose: today, connected Google accounts and their OAuth tokens live in
-- process memory only (InMemoryTokenStore / InMemoryGoogleAccountRegistry
-- in packages/google-auth) — every restart wipes them, requiring
-- /connectgoogle to be run again. These two tables let a Supabase-backed
-- implementation of the same TokenStore / GoogleAccountRegistry interfaces
-- survive restarts instead.
--
-- Ownership model: Awo is a single-executive system today (see
-- KNOWN_LIMITATIONS.md — the `executive_users` table exists but is unused).
-- `account_key` (e.g. "primary", "villiz-pixels") is therefore the only
-- ownership/identity column here, matching how TokenStore/GoogleAccountRegistry
-- are already keyed throughout packages/google-auth — there is no
-- per-executive foreign key to attach until multi-user support exists.
--
-- Security: `google_oauth_tokens.encrypted_access_token` /
-- `encrypted_refresh_token` NEVER hold plaintext — the application layer
-- (EncryptedTokenStore, packages/google-auth) encrypts with AES-256-GCM
-- before a row is ever written here, and decrypts only after reading one
-- back. The encryption key itself (GOOGLE_TOKEN_ENCRYPTION_KEY) lives only
-- in deployment environment variables — it is never stored in this
-- database, logged, or sent to Telegram.
--
-- Access model: like every other table in this schema, no RLS policies are
-- defined here, and this migration issues no GRANT statements — Supabase's
-- default privileges do not expose new tables to the `anon`/`authenticated`
-- roles. Awo's own database access always uses the Supabase *service role*
-- key (SUPABASE_SERVICE_ROLE_KEY), which bypasses RLS entirely regardless
-- of whether RLS is enabled on a table. That means RLS is not a meaningful
-- access boundary for this application's own queries either way — the real
-- boundary is that the service role key itself must never be exposed
-- client-side or logged. Deployment expectation: only the server process
-- holds SUPABASE_SERVICE_ROLE_KEY; no client (Telegram, browser, mobile)
-- ever receives it or talks to Supabase directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- google_oauth_tokens
-- ---------------------------------------------------------------------------
create table if not exists google_oauth_tokens (
  account_key text primary key,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  -- Epoch milliseconds (matches StoredTokens.expiryDate), not a timestamptz —
  -- this mirrors exactly what google-auth-library's Credentials.expiry_date
  -- already is, so no conversion happens on the way in or out.
  expiry_date bigint,
  scope text not null,
  token_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- google_accounts
-- ---------------------------------------------------------------------------
create table if not exists google_accounts (
  account_key text primary key,
  display_name text not null,
  email_address text,
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'needs_reauthorization', 'error')),
  connected_at timestamptz,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_accounts_email_address_idx on google_accounts (email_address);
