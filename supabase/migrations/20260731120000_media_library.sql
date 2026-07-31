-- ===========================================================================
-- Project Genesis — 0023 Media Library & Brand Kits
-- ===========================================================================

-- 1. EXTEND MEDIA ASSETS
alter table public.media_assets
  add column title text,
  add column thumbnail_path text,
  add column category text,
  add column description text,
  add column alt_text text,
  add column tags text[] default '{}',
  add column brand text,
  add column duration integer, -- in seconds if applicable
  add column copyright_owner text,
  add column usage_rights text,
  add column expires_at timestamptz,
  add column is_ai_generated boolean not null default false,
  add column is_archived boolean not null default false,
  add column updated_at timestamptz not null default now();

-- 2. MEDIA ASSET VERSIONS
create table public.media_asset_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  width integer,
  height integer,
  replaced_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index media_asset_versions_asset_idx on public.media_asset_versions (asset_id);

-- 3. MEDIA COLLECTIONS
create table public.media_collections (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index media_collections_org_idx on public.media_collections (organisation_id);

-- 4. MEDIA COLLECTION ASSETS
create table public.media_collection_assets (
  collection_id uuid not null references public.media_collections (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (collection_id, asset_id)
);

-- 5. BRAND KITS
create table public.brand_kits (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  colors jsonb default '[]',
  typography jsonb default '[]',
  tone_notes text,
  usage_guidance text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index brand_kits_org_idx on public.brand_kits (organisation_id);

-- 6. BRAND KIT ASSETS
create table public.brand_kit_assets (
  brand_kit_id uuid not null references public.brand_kits (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  role text, -- e.g. logo, template, icon
  created_at timestamptz not null default now(),
  primary key (brand_kit_id, asset_id)
);

-- 7. CAMPAIGN ASSETS (Replacing JSON column)
create table public.campaign_assets (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete restrict,
  attached_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, asset_id)
);

-- 8. CONTENT DRAFT ASSETS
create table public.content_draft_assets (
  draft_id uuid not null references public.content_drafts (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete restrict,
  attached_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (draft_id, asset_id)
);

-- ---------------------------------------------------------------------------
-- RLS Policies
-- ---------------------------------------------------------------------------
alter table public.media_asset_versions enable row level security;
alter table public.media_collections enable row level security;
alter table public.media_collection_assets enable row level security;
alter table public.brand_kits enable row level security;
alter table public.brand_kit_assets enable row level security;
alter table public.campaign_assets enable row level security;
alter table public.content_draft_assets enable row level security;

-- media_asset_versions
create policy media_asset_versions_select on public.media_asset_versions
  for select to authenticated using (
    exists (select 1 from public.media_assets a where a.id = asset_id and app.is_org_member(a.organisation_id))
  );

create policy media_asset_versions_write on public.media_asset_versions
  for all to authenticated using (
    exists (select 1 from public.media_assets a where a.id = asset_id and app.can_write_org(a.organisation_id))
  ) with check (
    exists (select 1 from public.media_assets a where a.id = asset_id and app.can_write_org(a.organisation_id))
  );

-- media_collections
create policy media_collections_select on public.media_collections
  for select to authenticated using (app.is_org_member(organisation_id));

create policy media_collections_write on public.media_collections
  for all to authenticated using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));

-- media_collection_assets
create policy media_collection_assets_select on public.media_collection_assets
  for select to authenticated using (
    exists (select 1 from public.media_collections c where c.id = collection_id and app.is_org_member(c.organisation_id))
  );

create policy media_collection_assets_write on public.media_collection_assets
  for all to authenticated using (
    exists (select 1 from public.media_collections c where c.id = collection_id and app.can_write_org(c.organisation_id))
  ) with check (
    exists (select 1 from public.media_collections c where c.id = collection_id and app.can_write_org(c.organisation_id))
  );

-- brand_kits
create policy brand_kits_select on public.brand_kits
  for select to authenticated using (app.is_org_member(organisation_id));

create policy brand_kits_write on public.brand_kits
  for all to authenticated using (app.can_manage_org(organisation_id)) with check (app.can_manage_org(organisation_id));

-- brand_kit_assets
create policy brand_kit_assets_select on public.brand_kit_assets
  for select to authenticated using (
    exists (select 1 from public.brand_kits b where b.id = brand_kit_id and app.is_org_member(b.organisation_id))
  );

create policy brand_kit_assets_write on public.brand_kit_assets
  for all to authenticated using (
    exists (select 1 from public.brand_kits b where b.id = brand_kit_id and app.can_manage_org(b.organisation_id))
  ) with check (
    exists (select 1 from public.brand_kits b where b.id = brand_kit_id and app.can_manage_org(b.organisation_id))
  );

-- campaign_assets
create policy campaign_assets_select on public.campaign_assets
  for select to authenticated using (
    exists (select 1 from public.campaigns c where c.id = campaign_id and app.is_org_member(c.organisation_id))
  );

create policy campaign_assets_write on public.campaign_assets
  for all to authenticated using (
    exists (select 1 from public.campaigns c where c.id = campaign_id and app.can_write_org(c.organisation_id))
  ) with check (
    exists (select 1 from public.campaigns c where c.id = campaign_id and app.can_write_org(c.organisation_id))
  );

-- content_draft_assets
create policy content_draft_assets_select on public.content_draft_assets
  for select to authenticated using (
    exists (select 1 from public.content_drafts d where d.id = draft_id and app.is_org_member(d.organisation_id))
  );

create policy content_draft_assets_write on public.content_draft_assets
  for all to authenticated using (
    exists (select 1 from public.content_drafts d where d.id = draft_id and app.can_write_org(d.organisation_id))
  ) with check (
    exists (select 1 from public.content_drafts d where d.id = draft_id and app.can_write_org(d.organisation_id))
  );

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------
drop trigger if exists set_media_assets_updated_at on public.media_assets;
create trigger set_media_assets_updated_at
  before update on public.media_assets
  for each row execute function app.touch_updated_at();

drop trigger if exists set_media_collections_updated_at on public.media_collections;
create trigger set_media_collections_updated_at
  before update on public.media_collections
  for each row execute function app.touch_updated_at();

drop trigger if exists set_brand_kits_updated_at on public.brand_kits;
create trigger set_brand_kits_updated_at
  before update on public.brand_kits
  for each row execute function app.touch_updated_at();
