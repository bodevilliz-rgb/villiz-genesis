-- P0 follow-up: claim_publishing_job_for_confirmation must return SETOF, not
-- a single composite.
--
-- SYMPTOM: with the confirmation migrations applied, the Render worker
-- (worker-89-c4d93x) emitted `provider_confirmation_error / "rows is not
-- iterable"` every ~2 seconds — the poll cadence — even though production
-- had ZERO awaiting_confirmation jobs (verified: 8 published, 8 failed, 0
-- awaiting, 0 due).
--
-- PROVEN ROOT CAUSE: 20260810030100 declared this function
-- `returns public.publishing_jobs` (proretset = false), while the
-- already-proven sibling it was modelled on is
-- `returns setof public.publishing_jobs` (proretset = true). This is the
-- EXACT defect 20260801160000_publishing_claim_setof_fix.sql already
-- diagnosed and fixed for claim_next_publishing_job, quoted here because it
-- explains both observed failure modes precisely:
--
--   "a plpgsql function declared `returns public.publishing_jobs` that
--    executes `return null` does not reliably serialize as a genuine SQL
--    NULL once it crosses PostgREST/postgres-js — it can come back as a
--    composite object with every field set to null"
--
-- So on the empty queue this RPC returned an all-null composite OBJECT
-- rather than NULL. The repository's `(data ?? [])` therefore kept the
-- object (it is not nullish), and destructuring `const [row] = rows` threw
-- "rows is not iterable" on every tick. Had a job ever been claimable, the
-- single-row object would have thrown identically.
--
-- The fix is to adopt the identical, proven shape: `returns setof`, `return;`
-- for nothing-to-claim (a genuine empty array over the wire) and
-- `return next` for a claim. CREATE OR REPLACE cannot change a return type,
-- so the function is dropped and recreated.
--
-- Behaviour is otherwise byte-for-byte unchanged: same lease semantics, same
-- `for update skip locked` exclusivity, still never sets status/claimed_by
-- (a confirmation check is a read of an already-submitted post, never a new
-- publish).

drop function if exists public.claim_publishing_job_for_confirmation(text, integer);

create or replace function public.claim_publishing_job_for_confirmation(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.publishing_jobs
language plpgsql
as $$
declare
  v_job public.publishing_jobs;
begin
  select *
  into v_job
  from public.publishing_jobs
  where status = 'awaiting_confirmation'
    and next_status_check_at is not null
    and next_status_check_at <= now()
  order by next_status_check_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return;
  end if;

  update public.publishing_jobs
  set next_status_check_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;

comment on function public.claim_publishing_job_for_confirmation(text, integer) is
  'Atomically leases one due awaiting_confirmation job for a provider status check. Returns SETOF so "nothing to claim" is an unambiguous empty array (see 20260801160000 for why a single-composite return is unsafe here). Never sets processing, never touches claimed_by — a confirmation check is a read of an already-submitted post, never a new publish.';
