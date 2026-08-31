-- Campaign form Sprint 2 persistence fields.
-- The application already reads/writes these columns; keep this migration
-- additive and idempotent so existing campaign data and other flows are untouched.

alter table public.campaigns
  add column if not exists client text,
  add column if not exists brand text,
  add column if not exists campaign_type text,
  add column if not exists owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists team_members uuid[] not null default '{}'::uuid[],
  add column if not exists color_label text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists priority text,
  add column if not exists notes text,
  add column if not exists assets jsonb not null default '[]'::jsonb;

alter table public.campaigns
  drop constraint if exists campaigns_priority_check;

alter table public.campaigns
  add constraint campaigns_priority_check
  check (priority is null or priority in ('low', 'medium', 'high'));

create index if not exists campaigns_owner_id_idx on public.campaigns(owner_id);
create index if not exists campaigns_tags_gin_idx on public.campaigns using gin(tags);
