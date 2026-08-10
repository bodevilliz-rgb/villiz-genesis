-- Sprint 9: AI Content Intelligence
-- Uses Genesis organisation-based tenancy.

create table if not exists public.ai_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete cascade,

  name text not null,
  slug text not null,
  description text,

  prompt_type text not null check (
    prompt_type in (
      'caption_generation',
      'campaign_generation',
      'platform_repurpose',
      'brand_validation',
      'hashtag_generation',
      'visual_direction'
    )
  ),

  system_prompt text not null,
  user_prompt_template text not null,

  model text not null default 'gpt-4o-mini',
  temperature numeric(3,2) not null default 0.70
    check (temperature >= 0 and temperature <= 2),
  max_tokens integer not null default 1500
    check (max_tokens > 0),

  version integer not null default 1
    check (version > 0),
  is_active boolean not null default true,
  is_system_default boolean not null default false,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    not is_system_default
    or organisation_id is null
  )
);

create unique index if not exists ai_prompt_templates_org_slug_version_uidx
  on public.ai_prompt_templates (organisation_id, slug, version)
  where organisation_id is not null;

create unique index if not exists ai_prompt_templates_system_slug_version_uidx
  on public.ai_prompt_templates (slug, version)
  where organisation_id is null;

create index if not exists ai_prompt_templates_org_type_active_idx
  on public.ai_prompt_templates (
    organisation_id,
    prompt_type,
    is_active,
    version desc
  );

create table if not exists public.ai_generation_runs (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null
    references public.organisations (id) on delete cascade,

  prompt_template_id uuid
    references public.ai_prompt_templates (id) on delete set null,

  draft_id uuid
    references public.content_drafts (id) on delete set null,

  campaign_id uuid
    references public.campaigns (id) on delete set null,

  prompt_type text not null check (
    prompt_type in (
      'caption_generation',
      'campaign_generation',
      'platform_repurpose',
      'brand_validation',
      'hashtag_generation',
      'visual_direction'
    )
  ),

  provider text,
  model text not null,

  input_data jsonb not null default '{}'::jsonb,
  output_data jsonb,
  validation_result jsonb,

  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'failed')
  ),

  error_message text,

  input_tokens integer check (
    input_tokens is null or input_tokens >= 0
  ),
  output_tokens integer check (
    output_tokens is null or output_tokens >= 0
  ),
  estimated_cost numeric(12,6) check (
    estimated_cost is null or estimated_cost >= 0
  ),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_generation_runs_org_created_idx
  on public.ai_generation_runs (organisation_id, created_at desc);

create index if not exists ai_generation_runs_draft_idx
  on public.ai_generation_runs (draft_id)
  where draft_id is not null;

create index if not exists ai_generation_runs_campaign_idx
  on public.ai_generation_runs (campaign_id)
  where campaign_id is not null;

create index if not exists ai_generation_runs_status_idx
  on public.ai_generation_runs (status, created_at desc);

create or replace function public.set_ai_prompt_template_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ai_prompt_template_updated_at
  on public.ai_prompt_templates;

create trigger set_ai_prompt_template_updated_at
before update on public.ai_prompt_templates
for each row
execute function public.set_ai_prompt_template_updated_at();

alter table public.ai_prompt_templates enable row level security;
alter table public.ai_generation_runs enable row level security;

drop policy if exists "AI prompts readable by organisation members"
  on public.ai_prompt_templates;

create policy "AI prompts readable by organisation members"
on public.ai_prompt_templates
for select
to authenticated
using (
  organisation_id is null
  or app.is_org_member(organisation_id)
);

drop policy if exists "AI prompts writable by organisation editors"
  on public.ai_prompt_templates;

create policy "AI prompts writable by organisation editors"
on public.ai_prompt_templates
for all
to authenticated
using (
  organisation_id is not null
  and app.can_write_org(organisation_id)
)
with check (
  organisation_id is not null
  and app.can_write_org(organisation_id)
);

drop policy if exists "AI runs readable by organisation members"
  on public.ai_generation_runs;

create policy "AI runs readable by organisation members"
on public.ai_generation_runs
for select
to authenticated
using (app.is_org_member(organisation_id));

drop policy if exists "AI runs insertable by organisation editors"
  on public.ai_generation_runs;

create policy "AI runs insertable by organisation editors"
on public.ai_generation_runs
for insert
to authenticated
with check (
  app.can_write_org(organisation_id)
  and created_by = auth.uid()
);

drop policy if exists "AI runs updateable by organisation editors"
  on public.ai_generation_runs;

create policy "AI runs updateable by organisation editors"
on public.ai_generation_runs
for update
to authenticated
using (app.can_write_org(organisation_id))
with check (app.can_write_org(organisation_id));
