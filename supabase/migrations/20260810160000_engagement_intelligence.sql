-- Sprint 10: AWO Engagement Intelligence.
--
-- Recommendations are immutable snapshots tied to the exact draft version and
-- MemBrain evidence used at generation time. They are advisory only: inserting
-- one cannot edit, approve, schedule or publish a draft.

create type public.engagement_data_basis as enum ('brand_only', 'performance_informed');

-- A composite foreign key prevents a caller from attaching a recommendation
-- to a draft belonging to another organisation.
create unique index if not exists content_drafts_id_organisation_unique
  on public.content_drafts (id, organisation_id);

create table public.engagement_recommendations (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid not null,
  draft_version integer not null check (draft_version > 0),
  platform public.social_platform not null,
  objective text,
  data_basis public.engagement_data_basis not null default 'brand_only',
  recommended_caption text not null,
  alternative_captions text[] not null default '{}',
  hook text not null,
  cta text not null,
  hashtag_groups jsonb not null default '{"brand":[],"local":[],"service":[],"audience":[]}'::jsonb,
  rationale text not null,
  predicted_strengths text[] not null default '{}',
  limitations text[] not null default '{}',
  confidence smallint not null,
  evidence jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint engagement_recommendations_draft_org_fkey
    foreign key (draft_id, organisation_id)
    references public.content_drafts (id, organisation_id)
    on delete cascade,
  constraint engagement_recommendations_objective_length
    check (objective is null or char_length(trim(objective)) between 1 and 300),
  constraint engagement_recommendations_caption_length
    check (char_length(trim(recommended_caption)) between 1 and 5000),
  constraint engagement_recommendations_alternative_count
    check (cardinality(alternative_captions) between 1 and 2),
  constraint engagement_recommendations_hook_length
    check (char_length(trim(hook)) between 1 and 500),
  constraint engagement_recommendations_cta_length
    check (char_length(trim(cta)) between 1 and 500),
  constraint engagement_recommendations_rationale_length
    check (char_length(trim(rationale)) between 1 and 2000),
  constraint engagement_recommendations_strength_count
    check (cardinality(predicted_strengths) between 1 and 5),
  constraint engagement_recommendations_limitation_count
    check (cardinality(limitations) between 1 and 5),
  constraint engagement_recommendations_confidence_range
    check (confidence between 0 and 100),
  constraint engagement_recommendations_hashtag_groups_object
    check (jsonb_typeof(hashtag_groups) = 'object'),
  constraint engagement_recommendations_evidence_array
    check (jsonb_typeof(evidence) = 'array')
);

create index engagement_recommendations_draft_latest_idx
  on public.engagement_recommendations (organisation_id, draft_id, created_at desc, id desc);

alter table public.engagement_recommendations enable row level security;

create policy engagement_recommendations_select on public.engagement_recommendations
  for select to authenticated
  using (app.is_org_member(organisation_id));

create policy engagement_recommendations_insert on public.engagement_recommendations
  for insert to authenticated
  with check (
    app.can_write_org(organisation_id)
    and created_by = (select auth.uid())
  );

-- The generated recommendation is an audit snapshot. Human feedback will be
-- recorded as a separate append-only outcome event in the learning-loop sprint.
revoke update, delete on public.engagement_recommendations from authenticated;

create or replace function app.emit_engagement_recommendation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.automation_events (
    event_type, aggregate_type, aggregate_id, organisation_id, payload, occurred_at
  ) values (
    'engagement.recommendation_generated',
    'engagement_recommendation',
    new.id,
    new.organisation_id,
    jsonb_build_object(
      'recommendationId', new.id,
      'draftId', new.draft_id,
      'draftVersion', new.draft_version,
      'platform', new.platform,
      'dataBasis', new.data_basis,
      'confidence', new.confidence
    ),
    new.created_at
  );
  return new;
end;
$$;

create trigger engagement_recommendations_emit_automation_event
  after insert on public.engagement_recommendations
  for each row execute function app.emit_engagement_recommendation_event();
