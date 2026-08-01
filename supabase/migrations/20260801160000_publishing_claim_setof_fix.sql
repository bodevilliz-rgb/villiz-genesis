-- ===========================================================================
-- Sprint 6A — fix: claim_next_publishing_job must return zero rows, not a
-- row of nulls, when there is no due job.
--
-- Found while smoke-testing the worker against an empty queue: a plpgsql
-- function declared `returns public.publishing_jobs` that executes
-- `return null` does not reliably serialize as a genuine SQL NULL once it
-- crosses PostgREST/postgres-js — it can come back as a composite object
-- with every field set to null, which is truthy in JavaScript. The worker's
-- `if (!data) return null;` guard then failed to recognise "nothing to
-- claim," treated the all-null row as a real job, and looped attempting to
-- create a publishing_attempts row with a null job_id/organisation_id/
-- draft_id (a uuid column), erroring on every poll tick.
--
-- The fix is the same shape already used successfully for
-- recover_stale_publishing_jobs: declare the function `returns setof
-- public.publishing_jobs` and simply return zero rows when nothing is
-- claimable. `.rpc()` then yields a genuine empty array, which is
-- unambiguous. The repository (supabase-publishing-repository.ts) reads
-- `data?.[0] ?? null` from the array instead of treating `data` itself as
-- the single row.
-- ===========================================================================

drop function if exists public.claim_next_publishing_job(text);

create or replace function public.claim_next_publishing_job(p_worker_id text)
returns setof public.publishing_jobs
language plpgsql
as $$
declare
  v_job public.publishing_jobs;
begin
  select *
  into v_job
  from public.publishing_jobs
  where status = 'queued'
    and scheduled_for <= now()
  order by scheduled_for asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return;
  end if;

  update public.publishing_jobs
  set status = 'processing',
      claimed_by = p_worker_id,
      claimed_at = now()
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;
