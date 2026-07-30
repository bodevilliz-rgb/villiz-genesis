-- Awo — enable Row Level Security on every table
-- Deny-all by default: RLS is enabled with zero policies on every table
-- below, which means the anon and authenticated roles (used by Supabase
-- client libraries) get precisely zero access — no SELECT, INSERT, UPDATE,
-- or DELETE — until a policy is explicitly added for a specific table and
-- role. This migration adds no policies, since Awo's server-side code
-- never uses the anon/authenticated roles anywhere (see
-- packages/database/src/client.ts's createSupabaseClient, which only ever
-- accepts a service-role key) — there is nothing for a policy to grant
-- access to yet.
--
-- The Supabase *service role* key (SUPABASE_SERVICE_ROLE_KEY) bypasses RLS
-- entirely, regardless of whether it's enabled or what policies exist —
-- this is standard Postgres/Supabase behavior, not something this
-- migration configures. Awo's own database access exclusively uses this
-- key, so enabling RLS here has zero functional impact on the running
-- application; it only closes the anon-key exposure gap that Supabase's
-- own advisory tooling flagged as critical, most pressingly for
-- google_oauth_tokens/google_accounts (Google OAuth credentials,
-- encrypted at rest) added in 0003_google_oauth_persistence.sql.
--
-- Safe to re-run: `enable row level security` is idempotent — re-enabling
-- an already-enabled table is a no-op, not an error.

alter table projects enable row level security;
alter table tasks enable row level security;
alter table daily_briefs enable row level security;
alter table decisions enable row level security;
alter table executive_users enable row level security;
alter table meetings enable row level security;
alter table knowledge enable row level security;
alter table playbooks enable row level security;
alter table conversation_summaries enable row level security;
alter table decision_reviews enable row level security;
alter table google_oauth_tokens enable row level security;
alter table google_accounts enable row level security;
