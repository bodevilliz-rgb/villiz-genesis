-- Sprint 11: engagement learning loop.
-- Feedback and provider metrics are append-only observations. They never edit,
-- approve, schedule, or publish content and never assert causal lift.

create type public.engagement_objective_type as enum ('awareness', 'engagement', 'enquiries', 'bookings');
create type public.engagement_feedback_action as enum ('selected', 'dismissed');
create type public.engagement_variant as enum ('recommended', 'alternative_1', 'alternative_2', 'custom');

alter table public.engagement_recommendations
  add column objective_type public.engagement_objective_type not null default 'engagement',
  add column creative_guidance jsonb not null default '{"mediaBasis":"none","visualHook":"Use a clear subject-led opening frame.","formatRecommendation":"Choose the format that best supports the message.","shareTrigger":"Make the value easy to pass to someone relevant.","saveTrigger":"Include a useful takeaway worth revisiting.","accessibilityNote":"Add accurate alt text or captions before publishing."}'::jsonb,
  add column performance_confidence smallint,
  add column performance_summary jsonb not null default '{"sampleSize":0,"minimumSampleSize":10,"directionalScore":null,"label":"insufficient_data","championVariant":null,"challengerVariant":null,"variantScores":{}}'::jsonb,
  add constraint engagement_recommendations_performance_confidence_range
    check (performance_confidence is null or performance_confidence between 0 and 85),
  add constraint engagement_recommendations_creative_guidance_object
    check (jsonb_typeof(creative_guidance) = 'object'),
  add constraint engagement_recommendations_performance_summary_object
    check (jsonb_typeof(performance_summary) = 'object');

create table public.engagement_feedback_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid not null,
  recommendation_id uuid not null references public.engagement_recommendations (id) on delete cascade,
  action public.engagement_feedback_action not null,
  variant public.engagement_variant,
  caption_snapshot text,
  hashtag_snapshot text[] not null default '{}',
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint engagement_feedback_draft_org_fkey foreign key (draft_id, organisation_id)
    references public.content_drafts (id, organisation_id) on delete cascade,
  constraint engagement_feedback_selection_payload check (
    (action = 'dismissed' and variant is null and caption_snapshot is null)
    or (action = 'selected' and variant is not null and char_length(trim(caption_snapshot)) between 1 and 5000)
  ),
  constraint engagement_feedback_reason_length check (reason is null or char_length(reason) <= 500),
  constraint engagement_feedback_hashtag_count check (cardinality(hashtag_snapshot) <= 20)
);

create unique index engagement_recommendations_feedback_scope_unique
  on public.engagement_recommendations (id, draft_id, organisation_id);
alter table public.engagement_feedback_events add constraint engagement_feedback_recommendation_scope_fkey
  foreign key (recommendation_id, draft_id, organisation_id)
  references public.engagement_recommendations (id, draft_id, organisation_id) on delete cascade;

create index engagement_feedback_draft_latest_idx
  on public.engagement_feedback_events (organisation_id, draft_id, created_at desc, id desc);

alter table public.engagement_feedback_events enable row level security;
create policy engagement_feedback_select on public.engagement_feedback_events for select to authenticated
  using (app.is_org_member(organisation_id));
create policy engagement_feedback_insert on public.engagement_feedback_events for insert to authenticated
  with check (app.can_write_org(organisation_id) and created_by = (select auth.uid()));
revoke update, delete on public.engagement_feedback_events from authenticated;

create table public.engagement_metric_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid not null,
  publishing_attempt_id uuid not null references public.publishing_attempts (id) on delete cascade,
  recommendation_id uuid references public.engagement_recommendations (id) on delete set null,
  feedback_event_id uuid references public.engagement_feedback_events (id) on delete set null,
  selected_variant public.engagement_variant,
  platform public.social_platform not null,
  objective_type public.engagement_objective_type not null default 'engagement',
  external_post_id text not null,
  provider_snapshot_key text not null,
  observed_at timestamptz not null default now(),
  provider_captured_at timestamptz,
  views bigint, reach bigint, impressions bigint, likes bigint, comments bigint,
  shares bigint, saves bigint, clicks bigint, profile_visits bigint,
  enquiries bigint, bookings bigint, watch_time_ms bigint,
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint engagement_metrics_draft_org_fkey foreign key (draft_id, organisation_id)
    references public.content_drafts (id, organisation_id) on delete cascade,
  constraint engagement_metrics_non_negative check (
    coalesce(views,0) >= 0 and coalesce(reach,0) >= 0 and coalesce(impressions,0) >= 0
    and coalesce(likes,0) >= 0 and coalesce(comments,0) >= 0 and coalesce(shares,0) >= 0
    and coalesce(saves,0) >= 0 and coalesce(clicks,0) >= 0 and coalesce(profile_visits,0) >= 0
    and coalesce(enquiries,0) >= 0 and coalesce(bookings,0) >= 0 and coalesce(watch_time_ms,0) >= 0
  ),
  constraint engagement_metrics_raw_object check (jsonb_typeof(raw_metrics) = 'object')
);

create unique index engagement_metrics_provider_snapshot_unique
  on public.engagement_metric_snapshots (organisation_id, provider_snapshot_key);

create unique index publishing_attempts_engagement_scope_unique
  on public.publishing_attempts (id, draft_id, organisation_id);
create unique index engagement_feedback_metric_scope_unique
  on public.engagement_feedback_events (id, draft_id, organisation_id);
alter table public.engagement_metric_snapshots add constraint engagement_metrics_attempt_scope_fkey
  foreign key (publishing_attempt_id, draft_id, organisation_id)
  references public.publishing_attempts (id, draft_id, organisation_id) on delete cascade;
alter table public.engagement_metric_snapshots add constraint engagement_metrics_recommendation_scope_fkey
  foreign key (recommendation_id, draft_id, organisation_id)
  references public.engagement_recommendations (id, draft_id, organisation_id) on delete set null (recommendation_id);
alter table public.engagement_metric_snapshots add constraint engagement_metrics_feedback_scope_fkey
  foreign key (feedback_event_id, draft_id, organisation_id)
  references public.engagement_feedback_events (id, draft_id, organisation_id) on delete set null (feedback_event_id);

create index engagement_metrics_baseline_idx
  on public.engagement_metric_snapshots (organisation_id, platform, objective_type, observed_at desc);

alter table public.engagement_metric_snapshots enable row level security;
create policy engagement_metrics_select on public.engagement_metric_snapshots for select to authenticated
  using (app.is_org_member(organisation_id));
-- No authenticated INSERT/UPDATE/DELETE policy: only the service-role collector writes provider observations.
revoke insert, update, delete on public.engagement_metric_snapshots from authenticated;

create or replace function app.prevent_engagement_metric_update()
returns trigger language plpgsql as $$
begin
  raise exception 'Engagement metric snapshots are immutable';
end;
$$;
create trigger engagement_metric_snapshots_immutable before update on public.engagement_metric_snapshots
  for each row execute function app.prevent_engagement_metric_update();

create or replace function app.emit_engagement_feedback_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.automation_events (
    event_type, aggregate_type, aggregate_id, organisation_id, payload, occurred_at
  ) values (
    case when new.action = 'selected' then 'engagement.recommendation_selected' else 'engagement.recommendation_dismissed' end,
    'engagement_feedback', new.id, new.organisation_id,
    jsonb_build_object('feedbackId', new.id, 'recommendationId', new.recommendation_id,
      'draftId', new.draft_id, 'action', new.action, 'variant', new.variant),
    new.created_at
  );
  return new;
end;
$$;

create trigger engagement_feedback_emit_automation_event after insert on public.engagement_feedback_events
  for each row execute function app.emit_engagement_feedback_event();
