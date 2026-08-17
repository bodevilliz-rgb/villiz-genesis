-- Awo Market Intelligence v1: three client-owned, organisation-scoped tables.
-- Reusable definitions remain version-controlled; no database template CMS.

create type public.market_cultural_voice as enum ('neutral', 'conversational', 'light_naija');
create type public.market_pattern_category as enum ('hook', 'format', 'emotional_angle', 'educational_angle', 'transformation', 'proof', 'offer_positioning', 'cta', 'audience_question', 'discovery_language', 'local_language', 'occasion_language', 'caption_length');

create table public.market_intelligence_profiles (
  organisation_id uuid primary key references public.organisations (id) on delete cascade,
  business_objectives text[] not null default '{}',
  target_geographies text[] not null default '{}',
  service_areas text[] not null default '{}',
  audience_context text,
  cultural_context text,
  promotional_focus text,
  cultural_voice_level public.market_cultural_voice not null default 'neutral',
  conversion_actions text[] not null default '{}',
  platform_strategy jsonb not null default '{}'::jsonb,
  hashtag_strategy jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_profile_business_objectives check (business_objectives <@ array['visibility','enquiries','bookings','sales','authority','community_growth']::text[]),
  constraint market_profile_voice_context check (cultural_voice_level <> 'light_naija' or nullif(trim(cultural_context), '') is not null),
  constraint market_profile_platform_strategy check (jsonb_typeof(platform_strategy) = 'object'),
  constraint market_profile_hashtag_strategy check (jsonb_typeof(hashtag_strategy) = 'object')
);
create trigger market_intelligence_profiles_touch before update on public.market_intelligence_profiles for each row execute function app.touch_updated_at();

create table public.market_intelligence_references (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  identifier text not null,
  platform text not null,
  market text,
  vertical text,
  relevance_note text not null,
  source_url text,
  is_active boolean not null default true,
  reviewed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint market_reference_identifier_length check (char_length(trim(identifier)) between 1 and 160),
  constraint market_reference_relevance_length check (char_length(trim(relevance_note)) between 1 and 1000),
  unique (organisation_id, platform, identifier)
);
create index market_references_org_active_idx on public.market_intelligence_references (organisation_id, is_active);
create trigger market_intelligence_references_touch before update on public.market_intelligence_references for each row execute function app.touch_updated_at();

create table public.market_intelligence_patterns (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  observation text not null,
  category public.market_pattern_category not null,
  platform text,
  market text,
  vertical text,
  provenance text not null,
  source_url text,
  confidence smallint not null default 50,
  observed_at timestamptz,
  reviewed_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint market_pattern_observation_length check (char_length(trim(observation)) between 20 and 1000),
  constraint market_pattern_provenance_length check (char_length(trim(provenance)) between 3 and 500),
  constraint market_pattern_confidence check (confidence between 0 and 100),
  -- Store abstractions, never caption archives.
  constraint market_pattern_anti_archive check (char_length(observation) <= 1000 and observation !~* '(full caption|verbatim caption|copy this caption)')
);
create index market_patterns_org_active_platform_idx on public.market_intelligence_patterns (organisation_id, is_active, platform);
create trigger market_intelligence_patterns_touch before update on public.market_intelligence_patterns for each row execute function app.touch_updated_at();

alter table public.market_intelligence_profiles enable row level security;
alter table public.market_intelligence_references enable row level security;
alter table public.market_intelligence_patterns enable row level security;

create policy market_profiles_select on public.market_intelligence_profiles for select to authenticated using (app.is_org_member(organisation_id));
create policy market_profiles_insert on public.market_intelligence_profiles for insert to authenticated with check (app.can_write_org(organisation_id) and created_by = (select auth.uid()));
create policy market_profiles_update on public.market_intelligence_profiles for update to authenticated using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));
create policy market_profiles_delete on public.market_intelligence_profiles for delete to authenticated using (app.can_write_org(organisation_id));
create policy market_references_select on public.market_intelligence_references for select to authenticated using (app.is_org_member(organisation_id));
create policy market_references_insert on public.market_intelligence_references for insert to authenticated with check (app.can_write_org(organisation_id) and created_by = (select auth.uid()));
create policy market_references_update on public.market_intelligence_references for update to authenticated using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));
create policy market_references_delete on public.market_intelligence_references for delete to authenticated using (app.can_write_org(organisation_id));
create policy market_patterns_select on public.market_intelligence_patterns for select to authenticated using (app.is_org_member(organisation_id));
create policy market_patterns_insert on public.market_intelligence_patterns for insert to authenticated with check (app.can_write_org(organisation_id) and created_by = (select auth.uid()));
create policy market_patterns_update on public.market_intelligence_patterns for update to authenticated using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));
create policy market_patterns_delete on public.market_intelligence_patterns for delete to authenticated using (app.can_write_org(organisation_id));

-- Strategy labels enrich existing immutable recommendation snapshots; metrics stay authoritative elsewhere.
alter table public.engagement_recommendations add column strategy_metadata jsonb not null default '{}'::jsonb;
alter table public.engagement_recommendations add constraint engagement_strategy_metadata_object check (jsonb_typeof(strategy_metadata) = 'object');
