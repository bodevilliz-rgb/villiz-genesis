-- ===========================================================================
-- Sprint 6A — dev-only mock-publisher simulation control
--
-- The mission requires controlled, non-random publish outcomes for testing
-- (always_succeed / fail_next_attempt / always_fail) that must be
-- "impossible to enable accidentally in production." Storing the override on
-- the job row itself (rather than in-process memory) is deliberate: the
-- Next.js web process and the `npm run worker:publishing` background worker
-- are two separate OS processes with no shared memory, so an operator
-- setting this from the Publishing Queue UI (running in the web process)
-- would otherwise be invisible to the worker that actually resolves the
-- mock publisher. Every application-layer read of this column is additionally
-- gated on NODE_ENV !== "production" (see
-- src/infrastructure/publishers/simulation-mode.ts) — a stale or
-- maliciously-set value in this column has zero effect in production
-- regardless of what it contains.
-- ===========================================================================

create type public.publishing_simulation_mode as enum ('always_succeed', 'fail_next_attempt', 'always_fail');

alter table public.publishing_jobs
  add column if not exists dev_simulation_mode public.publishing_simulation_mode;

comment on column public.publishing_jobs.dev_simulation_mode is
  'Non-production-only override for this job''s mock publisher outcome. Application code must ignore this column whenever NODE_ENV=production. "fail_next_attempt" is consumed (reset to null) after the attempt it affects.';
