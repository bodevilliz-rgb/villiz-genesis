-- P0 fix: persist execution mode (simulation/live) on publishing_jobs.
--
-- PRODUCTION INCIDENT (2026-08-10): publishing_jobs.cbedd43d-f855-440f-
-- baf0-ac2bed49c4fa, a TikTok immediate job, was reviewed and confirmed by
-- the operator with Pre-Publish Review displaying "Mode: Simulation" (that
-- badge is rendered from Vercel's own BLOTATO_LIVE_PUBLISHING_ENABLED at
-- the time). The job was claimed by the Render background worker
-- (worker-88-rbb9k6), whose own process environment had live publishing
-- enabled — completely independently of Vercel's setting. The worker
-- executed a REAL Blotato submission (postSubmissionId
-- 053cabac-1d0a-4694-a35b-aeb36c2503bb), which timed out waiting for a
-- terminal status.
--
-- ROOT CAUSE: live-vs-simulation has never been anything but a value each
-- executing process (a Vercel serverless function, or the standalone
-- Render worker) derives independently from its OWN
-- BLOTATO_LIVE_PUBLISHING_ENABLED env var, for every platform, since this
-- mechanism was introduced in Sprint 6B. Nothing has ever persisted what
-- the operator actually reviewed and confirmed, so two independently-
-- configured deployment environments could (and did) silently disagree.
--
-- FIX: execution_mode is captured ONCE from the same value Pre-Publish
-- Review's own Mode badge renders from, at the exact moment the operator
-- confirms Publish Now / Schedule — the same capture-once pattern already
-- used for resolved_account_id/is_ai_generated. Every worker (Render and
-- the Vercel API route) must derive publisher behaviour from this column
-- via resolveEffectiveLivePublishing() (core/domain/entities/publishing.ts)
-- — never again from its own process environment alone. A "simulation" job
-- can never be upgraded to live regardless of what any process's own
-- environment says; a "live" job still additionally requires that
-- process's own global flag, preserving the existing, unchanged kill-
-- switch behaviour (BLOTATO_LIVE_PUBLISHING_ENABLED=false already means
-- "simulate, full stop" for every platform).
--
-- DEFAULT 'simulation' is deliberate and is the ONE case in this feature's
-- migrations where a database default is correct rather than a compliance
-- fabrication risk: it is the fail-safe direction, not a truth claim about
-- content, and it is exactly what closes the incident — any row ever
-- inserted without an explicit value can only ever simulate, never
-- silently go live.
create type public.publishing_execution_mode as enum ('simulation', 'live');

alter table public.publishing_jobs
  add column if not exists execution_mode public.publishing_execution_mode not null default 'simulation';

comment on column public.publishing_jobs.execution_mode is
  'Operator-reviewed execution mode captured once from Pre-Publish Review''s own Mode badge at job creation. The only value any worker may consult to decide whether a publish reaches the real provider (see resolveEffectiveLivePublishing) — never a process''s own BLOTATO_LIVE_PUBLISHING_ENABLED alone. Defaults to simulation, the fail-safe direction.';
