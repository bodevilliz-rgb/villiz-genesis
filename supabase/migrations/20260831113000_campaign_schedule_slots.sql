create table if not exists public.campaign_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  asset_id uuid references public.media_assets(id) on delete set null,
  week_number integer not null check (week_number between 1 and 104),
  platform text not null check (platform in ('instagram','facebook','linkedin','x','tiktok','youtube','pinterest','threads')),
  scheduled_date date not null,
  scheduled_time time not null,
  timezone text not null default 'Europe/London',
  status text not null default 'planned' check (status in ('planned','ready','scheduled','published','failed','cancelled')),
  draft_id uuid references public.content_drafts(id) on delete set null,
  publishing_job_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, week_number, platform)
);

create index if not exists campaign_schedule_slots_campaign_idx
  on public.campaign_schedule_slots(campaign_id, scheduled_date, scheduled_time);
create index if not exists campaign_schedule_slots_org_idx
  on public.campaign_schedule_slots(organisation_id, scheduled_date);

alter table public.campaign_schedule_slots enable row level security;

create policy "campaign schedule members can read"
on public.campaign_schedule_slots for select
to authenticated
using (
  exists (
    select 1 from public.organisation_members om
    where om.organisation_id = campaign_schedule_slots.organisation_id
      and om.profile_id = auth.uid()
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_platform_admin = true
  )
);
