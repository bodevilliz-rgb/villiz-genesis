-- Awo Sprint 3 — Executive Memory & Knowledge Engine
-- Tables: meetings, knowledge, playbooks, conversation_summaries, decision_reviews
-- Plus ranked full-text search functions for the tables covered by
-- MemoryAdapter (meetings, conversation_summaries) and KnowledgeAdapter
-- (knowledge). Safe to run on a database that already has 0001_init.sql.
--
-- Migration-safety note: this file contains no `drop`, `truncate`,
-- `delete`, or unconditional `insert` — nothing in it can destroy or
-- overwrite existing rows. Every `create table`/`create index` uses
-- `if not exists`, and the three search functions use
-- `create or replace function` (replacing a function definition never
-- touches table data). Re-running this file against a database that
-- already has these objects is a no-op, not an error.
--
-- That said, "safe to re-run" only guarantees *schema completeness* when
-- applied via a tracked migration system (Supabase CLI migration history,
-- or equivalent) that applies each migration file once, in order. The
-- `if not exists` guards mean that if a table already exists here in some
-- other, divergent shape (e.g. hand-edited outside the migration system,
-- or a version of this table introduced out of order), this migration
-- will silently skip creating/fixing it rather than reconciling the
-- difference — non-destructive, but not a substitute for applying
-- migrations through the tracked system in sequence.
--
-- Search design note: search is implemented today with native PostgreSQL
-- full-text search (tsvector + GIN index + ts_rank_cd), exposed through a
-- SQL function per table so the app gets ranked results via a single RPC
-- call. `MemoryAdapter`/`KnowledgeAdapter` (packages/database) depend only
-- on "search(query, limit) -> ranked results" — swapping this for a vector
-- index (e.g. pgvector + an embeddings column) later means replacing the
-- body of these functions and the Postgres adapter implementations, not
-- the adapter interface or anything above it.

create extension if not exists pgcrypto;

-- Postgres's built-in `array_to_string(text[], text)` is not recognized as
-- IMMUTABLE by the generated-column validator on this Postgres build, even
-- though its behavior is fully deterministic (concatenating array elements
-- with a fixed separator depends on nothing that can change) — this causes
-- `ERROR: 42P17: generation expression is not immutable` wherever it's used
-- inside a `generated always as (...) stored` column below. This thin
-- wrapper, explicitly declared IMMUTABLE, is the standard, well-documented
-- workaround: verified empirically against this project before adopting it.
create or replace function immutable_array_to_string(arr text[], sep text)
returns text
language sql
immutable
as $$ select array_to_string(arr, sep); $$;

-- ---------------------------------------------------------------------------
-- meetings
-- ---------------------------------------------------------------------------
-- Structured meeting notes, not raw transcripts — "summary" and
-- "action_items" are the durable record; nothing here stores a full
-- chat/meeting transcript.
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  tags text[] not null default '{}',
  source text not null default 'manual',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  occurred_at timestamptz not null,
  attendees text[] not null default '{}',
  action_items text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(immutable_array_to_string(tags, ' '), '')
    )
  ) stored
);

create index if not exists meetings_search_vector_idx on meetings using gin (search_vector);
create index if not exists meetings_occurred_at_idx on meetings (occurred_at);

create or replace function search_meetings(search_query text, result_limit int default 10)
returns table (
  id uuid, title text, summary text, tags text[], source text, confidence real,
  occurred_at timestamptz, attendees text[], action_items text[],
  created_at timestamptz, updated_at timestamptz, rank real
)
language sql stable as $$
  select m.id, m.title, m.summary, m.tags, m.source, m.confidence,
         m.occurred_at, m.attendees, m.action_items, m.created_at, m.updated_at,
         ts_rank_cd(m.search_vector, websearch_to_tsquery('english', search_query)) as rank
  from meetings m
  where m.search_vector @@ websearch_to_tsquery('english', search_query)
  order by rank desc
  limit result_limit;
$$;

-- ---------------------------------------------------------------------------
-- knowledge
-- ---------------------------------------------------------------------------
create table if not exists knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  content text not null,
  tags text[] not null default '{}',
  source text not null default 'manual',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content, '') || ' ' || coalesce(immutable_array_to_string(tags, ' '), '')
    )
  ) stored
);

create index if not exists knowledge_search_vector_idx on knowledge using gin (search_vector);

create or replace function search_knowledge(search_query text, result_limit int default 10)
returns table (
  id uuid, title text, summary text, content text, tags text[], source text, confidence real,
  created_at timestamptz, updated_at timestamptz, rank real
)
language sql stable as $$
  select k.id, k.title, k.summary, k.content, k.tags, k.source, k.confidence,
         k.created_at, k.updated_at,
         ts_rank_cd(k.search_vector, websearch_to_tsquery('english', search_query)) as rank
  from knowledge k
  where k.search_vector @@ websearch_to_tsquery('english', search_query)
  order by rank desc
  limit result_limit;
$$;

-- ---------------------------------------------------------------------------
-- playbooks
-- ---------------------------------------------------------------------------
-- Versioned: `slug` groups every version of "the same" playbook, `version`
-- increments per slug. The latest version per slug is the current one;
-- older rows are kept as history. A new version always starts as 'draft'
-- so it must be re-approved even if the previous version was approved.
create table if not exists playbooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  summary text not null,
  content text not null,
  tags text[] not null default '{}',
  source text not null default 'manual',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  version integer not null default 1,
  approval_status text not null default 'draft'
    check (approval_status in ('draft', 'pending_review', 'approved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, version)
);

create index if not exists playbooks_slug_idx on playbooks (slug);

-- ---------------------------------------------------------------------------
-- conversation_summaries
-- ---------------------------------------------------------------------------
-- Structured summaries of past conversations (e.g. with Awo over
-- Telegram) — key points and participants, not the raw message log.
create table if not exists conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  tags text[] not null default '{}',
  source text not null default 'telegram',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  conversation_date timestamptz not null,
  participants text[] not null default '{}',
  key_points text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(immutable_array_to_string(tags, ' '), '') || ' ' || coalesce(immutable_array_to_string(key_points, ' '), '')
    )
  ) stored
);

create index if not exists conversation_summaries_search_vector_idx on conversation_summaries using gin (search_vector);

create or replace function search_conversation_summaries(search_query text, result_limit int default 10)
returns table (
  id uuid, title text, summary text, tags text[], source text, confidence real,
  conversation_date timestamptz, participants text[], key_points text[],
  created_at timestamptz, updated_at timestamptz, rank real
)
language sql stable as $$
  select c.id, c.title, c.summary, c.tags, c.source, c.confidence,
         c.conversation_date, c.participants, c.key_points, c.created_at, c.updated_at,
         ts_rank_cd(c.search_vector, websearch_to_tsquery('english', search_query)) as rank
  from conversation_summaries c
  where c.search_vector @@ websearch_to_tsquery('english', search_query)
  order by rank desc
  limit result_limit;
$$;

-- ---------------------------------------------------------------------------
-- decision_reviews
-- ---------------------------------------------------------------------------
-- The Decision Engine's structured record: a question with options
-- considered, a recommendation, the eventual decision, and a review date
-- to revisit it. Distinct from the lightweight `decisions` table (Sprint
-- 1/2), which continues to back the /today "Decision Required" section
-- unchanged.
create table if not exists decision_reviews (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  tags text[] not null default '{}',
  source text not null default 'manual',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  question text not null,
  options text[] not null default '{}',
  recommendation text,
  decision text,
  review_date date,
  status text not null default 'open'
    check (status in ('open', 'decided', 'needs_review', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decision_reviews_status_idx on decision_reviews (status);
create index if not exists decision_reviews_review_date_idx on decision_reviews (review_date);
