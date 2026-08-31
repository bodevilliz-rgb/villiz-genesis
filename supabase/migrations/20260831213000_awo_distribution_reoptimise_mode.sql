-- Allow a deliberate full-campaign distribution re-optimisation without abusing
-- incomplete-post retry semantics. Existing jobs default to unfinished-only mode.

alter table public.awo_campaign_jobs
  add column if not exists mode text not null default 'unfinished'
  check (mode in ('unfinished','distribution_reoptimise'));

comment on column public.awo_campaign_jobs.mode is
  'unfinished retries only empty drafts; distribution_reoptimise deliberately regenerates all campaign drafts and returns them to review';
