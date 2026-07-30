-- Awo Chief of Staff — initial schema
-- Tables: projects, tasks, daily_briefs, decisions, executive_users
-- Safe to run on a fresh Supabase/Postgres database.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'in_progress',
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_status_idx on projects (status);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete set null,
  title text not null,
  description text,
  status text not null default 'pending',
  priority text not null default 'medium',
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_status_idx on tasks (status);
create index if not exists tasks_project_id_idx on tasks (project_id);

-- ---------------------------------------------------------------------------
-- daily_briefs
-- ---------------------------------------------------------------------------
create table if not exists daily_briefs (
  id uuid primary key default gen_random_uuid(),
  brief_date date not null unique,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- decisions
-- ---------------------------------------------------------------------------
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  context text,
  decision text not null,
  status text not null default 'proposed',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- executive_users
-- ---------------------------------------------------------------------------
create table if not exists executive_users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- seed data
-- ---------------------------------------------------------------------------
insert into projects (name, description, status, priority)
values
  ('Awo Chief of Staff', 'AI Chief of Staff and executive operating system.', 'in_progress', 1),
  ('Villiz Content System', 'Content production and publishing system.', 'in_progress', 2),
  ('Villiz World', 'Villiz Holdings flagship venture.', 'in_progress', 3)
on conflict do nothing;
