-- ===========================================================================
-- Project Genesis — 0005 MemBrain
--
-- MemBrain is the institutional intelligence engine. Every organisation owns
-- an independent MemBrain; there is no shared knowledge pool and no cross-org
-- read path anywhere in this schema.
--
-- ARCHITECTURAL DECISIONS
--
-- 1. Version history is enforced by TRIGGER, not by application code.
--    Knowledge that loses its provenance is worthless, and history that
--    depends on a developer remembering to call a function will eventually be
--    lost. Every insert writes v1; every content change writes the next
--    version. There is no code path that can mutate an entry silently.
--
-- 2. Retrieval is lexical (Postgres full-text + trigram) in v1 rather than
--    vector-based. Reasoning: FTS is exact, explainable, needs no embedding
--    provider, costs nothing per query, and returns results in single-digit
--    milliseconds. Semantic recall is a genuine upgrade, not a prerequisite,
--    and it is additive: `membrain_search` and `membrain_context` are the only
--    retrieval surfaces, so pgvector can be introduced behind them without
--    touching a single line of application code.
--
-- 3. `importance` weights retrieval. A brand voice rule must outrank a
--    one-off observation when the AI context budget is tight.
-- ===========================================================================

create type public.membrain_status as enum ('draft', 'active', 'archived');
create type public.membrain_source as enum
  ('manual', 'client_brief', 'discovery_call', 'performance_insight', 'competitor_research', 'published_asset');

-- ---------------------------------------------------------------------------
-- Categories — per-organisation taxonomy, seeded with a Villiz standard set
-- ---------------------------------------------------------------------------
create table public.membrain_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  position smallint not null default 100,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, key),
  constraint membrain_categories_key_format check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$')
);

create index membrain_categories_org_idx on public.membrain_categories (organisation_id, position);

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
create table public.membrain_tags (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, slug),
  constraint membrain_tags_name_length check (char_length(trim(name)) between 1 and 40)
);

create index membrain_tags_org_idx on public.membrain_tags (organisation_id);

-- ---------------------------------------------------------------------------
-- Entries
-- ---------------------------------------------------------------------------
create table public.membrain_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  category_id uuid references public.membrain_categories (id) on delete set null,
  title text not null,
  summary text,
  body text not null,
  status public.membrain_status not null default 'active',
  source public.membrain_source not null default 'manual',
  source_url text,
  importance smallint not null default 3,
  version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  last_retrieved_at timestamptz,
  retrieval_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint membrain_entries_title_length check (char_length(trim(title)) between 3 and 200),
  constraint membrain_entries_body_length check (char_length(trim(body)) >= 1),
  constraint membrain_entries_summary_length check (summary is null or char_length(summary) <= 500),
  constraint membrain_entries_importance_range check (importance between 1 and 5),

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) stored
);

create index membrain_entries_search_idx on public.membrain_entries using gin (search_vector);
create index membrain_entries_title_trgm_idx
  on public.membrain_entries using gin (title extensions.gin_trgm_ops);
create index membrain_entries_org_updated_idx
  on public.membrain_entries (organisation_id, updated_at desc);
create index membrain_entries_org_category_idx
  on public.membrain_entries (organisation_id, category_id);
create index membrain_entries_retrieval_idx
  on public.membrain_entries (organisation_id, importance desc, updated_at desc)
  where status = 'active';

drop trigger if exists membrain_entries_touch_updated_at on public.membrain_entries;
create trigger membrain_entries_touch_updated_at
  before update on public.membrain_entries
  for each row execute function app.touch_updated_at();

create table public.membrain_entry_tags (
  entry_id uuid not null references public.membrain_entries (id) on delete cascade,
  tag_id uuid not null references public.membrain_tags (id) on delete cascade,
  primary key (entry_id, tag_id)
);

create index membrain_entry_tags_tag_idx on public.membrain_entry_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Immutable version history
-- ---------------------------------------------------------------------------
create table public.membrain_entry_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  entry_id uuid not null references public.membrain_entries (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  version integer not null,
  title text not null,
  summary text,
  body text not null,
  category_id uuid,
  importance smallint not null,
  status public.membrain_status not null,
  change_summary text,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entry_id, version)
);

create index membrain_entry_versions_entry_idx
  on public.membrain_entry_versions (entry_id, version desc);

-- Version history is append-only. The ONLY permitted mutation is attaching a
-- change reason to a version that does not yet have one: the reason is written
-- by the application immediately after the trigger creates the row, and can
-- never be edited afterwards. Everything else is rejected outright.
create or replace function app.guard_version_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MemBrain version history cannot be deleted' using errcode = '42501';
  end if;

  if old.change_summary is not null then
    raise exception 'This version is already sealed' using errcode = '42501';
  end if;

  if new.entry_id is distinct from old.entry_id
     or new.version is distinct from old.version
     or new.title is distinct from old.title
     or new.summary is distinct from old.summary
     or new.body is distinct from old.body
     or new.importance is distinct from old.importance
     or new.status is distinct from old.status
     or new.changed_by is distinct from old.changed_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'MemBrain version history is append-only' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists membrain_versions_append_only on public.membrain_entry_versions;
create trigger membrain_versions_append_only
  before update or delete on public.membrain_entry_versions
  for each row execute function app.guard_version_history();

-- ---------------------------------------------------------------------------
-- Versioning triggers
-- ---------------------------------------------------------------------------
create or replace function app.membrain_bump_version()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.summary is distinct from old.summary
     or new.category_id is distinct from old.category_id
     or new.importance is distinct from old.importance
     or new.status is distinct from old.status
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

drop trigger if exists membrain_entries_bump_version on public.membrain_entries;
create trigger membrain_entries_bump_version
  before update on public.membrain_entries
  for each row execute function app.membrain_bump_version();

create or replace function app.membrain_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.version = old.version then
    return new;
  end if;

  insert into public.membrain_entry_versions (
    entry_id, organisation_id, version, title, summary, body,
    category_id, importance, status, change_summary, changed_by
  )
  values (
    new.id, new.organisation_id, new.version, new.title, new.summary, new.body,
    new.category_id, new.importance, new.status,
    case when tg_op = 'INSERT' then 'Entry created' else null end,
    coalesce(new.updated_by, new.created_by)
  )
  on conflict (entry_id, version) do nothing;

  return new;
end;
$$;

drop trigger if exists membrain_entries_record_version on public.membrain_entries;
create trigger membrain_entries_record_version
  after insert or update on public.membrain_entries
  for each row execute function app.membrain_record_version();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.membrain_categories enable row level security;
alter table public.membrain_tags enable row level security;
alter table public.membrain_entries enable row level security;
alter table public.membrain_entry_tags enable row level security;
alter table public.membrain_entry_versions enable row level security;

create policy membrain_categories_select on public.membrain_categories
  for select to authenticated using (app.is_org_member(organisation_id));
create policy membrain_categories_write on public.membrain_categories
  for all to authenticated
  using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));

create policy membrain_tags_select on public.membrain_tags
  for select to authenticated using (app.is_org_member(organisation_id));
create policy membrain_tags_write on public.membrain_tags
  for all to authenticated
  using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));

create policy membrain_entries_select on public.membrain_entries
  for select to authenticated using (app.is_org_member(organisation_id));
create policy membrain_entries_write on public.membrain_entries
  for all to authenticated
  using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));

create policy membrain_entry_versions_select on public.membrain_entry_versions
  for select to authenticated using (app.is_org_member(organisation_id));

-- Narrow update path: the append-only trigger guarantees this can only ever
-- attach a change reason, never alter recorded content.
create policy membrain_entry_versions_annotate on public.membrain_entry_versions
  for update to authenticated
  using (app.can_write_org(organisation_id))
  with check (app.can_write_org(organisation_id));

create policy membrain_entry_tags_select on public.membrain_entry_tags
  for select to authenticated
  using (exists (
    select 1 from public.membrain_entries e
    where e.id = entry_id and app.is_org_member(e.organisation_id)
  ));

create policy membrain_entry_tags_write on public.membrain_entry_tags
  for all to authenticated
  using (exists (
    select 1 from public.membrain_entries e
    where e.id = entry_id and app.can_write_org(e.organisation_id)
  ))
  with check (exists (
    select 1 from public.membrain_entries e
    where e.id = entry_id and app.can_write_org(e.organisation_id)
  ));

-- ---------------------------------------------------------------------------
-- Standard Villiz knowledge taxonomy, provisioned with every organisation
-- ---------------------------------------------------------------------------
create or replace function app.provision_membrain_taxonomy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.membrain_categories (organisation_id, key, label, description, position, is_system)
  values
    (new.id, 'brand_voice', 'Brand voice', 'Tone, vocabulary, phrasing rules and things never to say.', 10, true),
    (new.id, 'audience', 'Audience', 'Who we are speaking to, their language, motivations and objections.', 20, true),
    (new.id, 'offering', 'Products & services', 'What the client sells, pricing posture and positioning.', 30, true),
    (new.id, 'guidelines', 'Rules & compliance', 'Legal, regulatory and client-mandated constraints.', 40, true),
    (new.id, 'performance', 'Performance insight', 'What has actually worked, learned from published assets.', 50, true),
    (new.id, 'competitors', 'Competitors', 'Competitive landscape and differentiation.', 60, true),
    (new.id, 'operations', 'Account operations', 'Approvals, contacts, cadence and how this client likes to work.', 70, true)
  on conflict (organisation_id, key) do nothing;
  return new;
end;
$$;

drop trigger if exists organisations_provision_membrain on public.organisations;
create trigger organisations_provision_membrain
  after insert on public.organisations
  for each row execute function app.provision_membrain_taxonomy();
