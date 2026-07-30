-- ===========================================================================
-- Project Genesis — 0004 Guardrails
--
-- Every organisation carries hard operational limits. Limits are meaningless
-- unless usage is measured from REAL data, so the counter tables are created
-- here even though they are populated by later sprints. The dashboard
-- therefore reports a true zero rather than an invented number.
--
--   social_accounts   -> Sprint 2 (Publishing)
--   media_assets      -> Sprint 2 (Media Library)
--   scheduled_posts   -> Sprint 3 (Publishing Queue)
--   ai_usage_events   -> written from Sprint 1 onward by MemBrain retrieval
-- ===========================================================================

create type public.social_platform as enum
  ('instagram', 'facebook', 'linkedin', 'x', 'tiktok', 'youtube', 'pinterest', 'threads');

create type public.connection_status as enum ('connected', 'expired', 'revoked');

create type public.post_status as enum
  ('idea', 'researching', 'drafting', 'in_review', 'approved', 'scheduled', 'published', 'failed', 'archived');

-- ---------------------------------------------------------------------------
-- Limits. One row per organisation, created automatically on onboarding.
-- ---------------------------------------------------------------------------
create table public.organisation_limits (
  organisation_id uuid primary key references public.organisations (id) on delete cascade,
  max_social_accounts integer not null default 6,
  max_posts_per_week integer not null default 25,
  max_storage_bytes bigint not null default 10737418240,      -- 10 GiB
  max_ai_tokens_per_month bigint not null default 2000000,    -- 2M tokens
  max_membrain_entries integer not null default 2000,
  updated_at timestamptz not null default now(),

  constraint organisation_limits_positive check (
    max_social_accounts >= 0
    and max_posts_per_week >= 0
    and max_storage_bytes >= 0
    and max_ai_tokens_per_month >= 0
    and max_membrain_entries >= 0
  )
);

drop trigger if exists organisation_limits_touch_updated_at on public.organisation_limits;
create trigger organisation_limits_touch_updated_at
  before update on public.organisation_limits
  for each row execute function app.touch_updated_at();

create or replace function app.provision_organisation_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organisation_limits (organisation_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists organisations_provision_limits on public.organisations;
create trigger organisations_provision_limits
  after insert on public.organisations
  for each row execute function app.provision_organisation_limits();

-- ---------------------------------------------------------------------------
-- Measured resources
-- ---------------------------------------------------------------------------
create table public.social_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  platform public.social_platform not null,
  handle text not null,
  display_name text,
  external_account_id text,
  status public.connection_status not null default 'connected',
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, platform, handle)
);

create index social_accounts_org_idx on public.social_accounts (organisation_id);

create table public.media_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  width integer,
  height integer,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint media_assets_size_positive check (size_bytes >= 0)
);

create index media_assets_org_idx on public.media_assets (organisation_id);

create table public.scheduled_posts (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  social_account_id uuid references public.social_accounts (id) on delete set null,
  status public.post_status not null default 'idea',
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scheduled_posts_org_window_idx
  on public.scheduled_posts (organisation_id, scheduled_for);

create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  feature text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  occurred_at timestamptz not null default now(),
  constraint ai_usage_tokens_positive check (input_tokens >= 0 and output_tokens >= 0)
);

create index ai_usage_events_org_time_idx
  on public.ai_usage_events (organisation_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- RLS for measured resources
-- ---------------------------------------------------------------------------
alter table public.organisation_limits enable row level security;
alter table public.social_accounts enable row level security;
alter table public.media_assets enable row level security;
alter table public.scheduled_posts enable row level security;
alter table public.ai_usage_events enable row level security;

create policy organisation_limits_select on public.organisation_limits
  for select to authenticated using (app.is_org_member(organisation_id));
create policy organisation_limits_write on public.organisation_limits
  for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy social_accounts_select on public.social_accounts
  for select to authenticated using (app.is_org_member(organisation_id));
create policy social_accounts_write on public.social_accounts
  for all to authenticated
  using (app.can_manage_org(organisation_id)) with check (app.can_manage_org(organisation_id));

create policy media_assets_select on public.media_assets
  for select to authenticated using (app.is_org_member(organisation_id));
create policy media_assets_write on public.media_assets
  for all to authenticated
  using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));

create policy scheduled_posts_select on public.scheduled_posts
  for select to authenticated using (app.is_org_member(organisation_id));
create policy scheduled_posts_write on public.scheduled_posts
  for all to authenticated
  using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));

create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated using (app.is_org_member(organisation_id));
create policy ai_usage_events_insert on public.ai_usage_events
  for insert to authenticated with check (app.is_org_member(organisation_id));
