create table if not exists public.campaign_schedule_slots (
  id uuid primary key default extensions.gen_random_uuid(),
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

drop trigger if exists campaign_schedule_slots_touch_updated_at on public.campaign_schedule_slots;
create trigger campaign_schedule_slots_touch_updated_at
  before update on public.campaign_schedule_slots
  for each row execute function app.touch_updated_at();

alter table public.campaign_schedule_slots enable row level security;

create policy campaign_schedule_slots_select on public.campaign_schedule_slots
  for select to authenticated
  using (app.is_org_member(organisation_id));

create policy campaign_schedule_slots_write on public.campaign_schedule_slots
  for all to authenticated
  using (app.can_write_org(organisation_id))
  with check (app.can_write_org(organisation_id));
