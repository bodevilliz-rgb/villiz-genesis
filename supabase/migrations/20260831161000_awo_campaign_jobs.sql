-- Background queue for campaign-wide Awo optimisation.
-- The web app only enqueues work; the long-lived cloud worker claims and executes it.

create table if not exists public.awo_campaign_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','cancelled')),
  total_posts integer not null default 0 check (total_posts >= 0),
  completed_posts integer not null default 0 check (completed_posts >= 0),
  failed_posts integer not null default 0 check (failed_posts >= 0),
  last_error text,
  worker_id text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists awo_campaign_jobs_one_active_per_campaign
  on public.awo_campaign_jobs(campaign_id)
  where status in ('queued','processing');

create index if not exists awo_campaign_jobs_claim_idx
  on public.awo_campaign_jobs(status, created_at)
  where status = 'queued';

create index if not exists awo_campaign_jobs_campaign_idx
  on public.awo_campaign_jobs(campaign_id, created_at desc);

drop trigger if exists awo_campaign_jobs_touch_updated_at on public.awo_campaign_jobs;
create trigger awo_campaign_jobs_touch_updated_at
  before update on public.awo_campaign_jobs
  for each row execute function app.touch_updated_at();

alter table public.awo_campaign_jobs enable row level security;

create policy awo_campaign_jobs_select
  on public.awo_campaign_jobs
  for select to authenticated
  using (app.is_org_member(organisation_id));

create policy awo_campaign_jobs_insert
  on public.awo_campaign_jobs
  for insert to authenticated
  with check (app.can_write_org(organisation_id) and requested_by = auth.uid());

-- Workers use the service role and therefore bypass RLS. Human users never update
-- job progress directly; the worker owns queued -> processing -> terminal states.

create or replace function public.claim_next_awo_campaign_job(p_worker_id text)
returns setof public.awo_campaign_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.awo_campaign_jobs
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.awo_campaign_jobs
  set status = 'processing',
      worker_id = p_worker_id,
      locked_at = now(),
      started_at = coalesce(started_at, now()),
      last_error = null,
      updated_at = now()
  where id = v_id
  returning *;
end;
$$;

revoke all on function public.claim_next_awo_campaign_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_awo_campaign_job(text) to service_role;

create or replace function public.recover_stale_awo_campaign_jobs(p_stale_seconds integer default 900)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.awo_campaign_jobs
  set status = 'queued',
      worker_id = null,
      locked_at = null,
      last_error = 'Recovered after worker interruption.',
      updated_at = now()
  where status = 'processing'
    and locked_at < now() - make_interval(secs => greatest(p_stale_seconds, 60));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.recover_stale_awo_campaign_jobs(integer) from public, anon, authenticated;
grant execute on function public.recover_stale_awo_campaign_jobs(integer) to service_role;
