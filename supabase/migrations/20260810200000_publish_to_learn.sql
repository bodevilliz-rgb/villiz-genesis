-- Sprint 14: publish-to-learn operator workflow.
-- 1. Apply a recommendation to a draft and record its attribution in one transaction.
-- 2. Compare posts at fixed 24h, 72h and 7d measurement checkpoints.
-- 3. Keep commercial outcomes append-only and tied to the exact publishing attempt.

create type public.engagement_measurement_window as enum ('under_24h', '24h', '72h', '7d');

alter table public.engagement_feedback_events
  add column applied_draft_version integer;
alter table public.engagement_feedback_events
  add constraint engagement_feedback_applied_version_positive
  check (applied_draft_version is null or applied_draft_version > 0);

drop trigger if exists engagement_metric_snapshots_immutable
  on public.engagement_metric_snapshots;

alter table public.engagement_metric_snapshots
  add column measurement_window public.engagement_measurement_window;

update public.engagement_metric_snapshots as metric
set measurement_window = case
  when extract(epoch from ((coalesce(metric.provider_captured_at, metric.observed_at)) - attempt.completed_at)) >= 604800 then '7d'::public.engagement_measurement_window
  when extract(epoch from ((coalesce(metric.provider_captured_at, metric.observed_at)) - attempt.completed_at)) >= 259200 then '72h'::public.engagement_measurement_window
  when extract(epoch from ((coalesce(metric.provider_captured_at, metric.observed_at)) - attempt.completed_at)) >= 86400 then '24h'::public.engagement_measurement_window
  else 'under_24h'::public.engagement_measurement_window
end
from public.publishing_attempts as attempt
where attempt.id = metric.publishing_attempt_id
  and attempt.completed_at is not null
  and metric.measurement_window is null;

create index engagement_metrics_comparable_window_idx
  on public.engagement_metric_snapshots
    (organisation_id, provider_account_id, platform, objective_type, measurement_window, observed_at desc)
  where provider_account_id is not null;

create trigger engagement_metric_snapshots_immutable
  before update on public.engagement_metric_snapshots
  for each row execute function app.prevent_engagement_metric_update();

create table public.engagement_commercial_outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid not null,
  publishing_attempt_id uuid not null,
  platform public.social_platform not null,
  provider_account_id text not null,
  enquiries integer not null default 0,
  bookings integer not null default 0,
  revenue_minor bigint not null default 0,
  currency text not null default 'GBP',
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint engagement_outcomes_draft_org_fkey foreign key (draft_id, organisation_id)
    references public.content_drafts (id, organisation_id) on delete cascade,
  constraint engagement_outcomes_attempt_scope_fkey foreign key (publishing_attempt_id, draft_id, organisation_id)
    references public.publishing_attempts (id, draft_id, organisation_id) on delete cascade,
  constraint engagement_outcomes_non_negative check (
    enquiries >= 0 and bookings >= 0 and revenue_minor >= 0 and bookings <= enquiries
  ),
  constraint engagement_outcomes_currency check (currency ~ '^[A-Z]{3}$'),
  constraint engagement_outcomes_account_length check (char_length(provider_account_id) between 1 and 200),
  constraint engagement_outcomes_note_length check (note is null or char_length(note) <= 500)
);

create index engagement_outcomes_baseline_idx
  on public.engagement_commercial_outcomes
    (organisation_id, provider_account_id, platform, created_at desc);
create index engagement_outcomes_draft_latest_idx
  on public.engagement_commercial_outcomes
    (organisation_id, draft_id, platform, created_at desc);

alter table public.engagement_commercial_outcomes enable row level security;
create policy engagement_outcomes_select on public.engagement_commercial_outcomes for select to authenticated
  using (app.is_org_member(organisation_id));
create policy engagement_outcomes_insert on public.engagement_commercial_outcomes for insert to authenticated
  with check (app.can_write_org(organisation_id) and created_by = (select auth.uid()));
revoke update, delete on public.engagement_commercial_outcomes from authenticated;

create or replace function public.apply_engagement_recommendation(
  p_organisation_id uuid,
  p_draft_id uuid,
  p_recommendation_id uuid,
  p_variant public.engagement_variant,
  p_caption_snapshot text,
  p_hashtag_snapshot text[]
)
returns table (
  id uuid,
  organisation_id uuid,
  draft_id uuid,
  recommendation_id uuid,
  action public.engagement_feedback_action,
  variant public.engagement_variant,
  caption_snapshot text,
  hashtag_snapshot text[],
  reason text,
  created_by uuid,
  created_at timestamptz,
  applied_draft_version integer,
  draft_version integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recommendation public.engagement_recommendations%rowtype;
  v_draft public.content_drafts%rowtype;
  v_feedback public.engagement_feedback_events%rowtype;
  v_expected_caption text;
  v_expected_hashtags text[];
  v_stored_hashtags text[];
begin
  if (select auth.uid()) is null or not app.can_write_org(p_organisation_id) then
    raise exception 'Contributor or Lead access is required' using errcode = '42501';
  end if;

  select * into v_recommendation
  from public.engagement_recommendations
  where engagement_recommendations.id = p_recommendation_id
    and engagement_recommendations.organisation_id = p_organisation_id
    and engagement_recommendations.draft_id = p_draft_id;
  if not found then raise exception 'Engagement recommendation not found' using errcode = 'P0002'; end if;

  select * into v_draft
  from public.content_drafts
  where content_drafts.id = p_draft_id
    and content_drafts.organisation_id = p_organisation_id
  for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;

  if v_draft.status in ('approved', 'scheduled', 'publishing', 'published', 'archived', 'rejected', 'awaiting_client', 'failed') then
    raise exception 'This draft is locked. Reopen it before applying a recommendation' using errcode = '22023';
  end if;
  if v_recommendation.draft_version <> v_draft.version then
    raise exception 'This recommendation is outdated. Generate a new recommendation first' using errcode = '40001';
  end if;

  v_expected_caption := case p_variant
    when 'recommended' then v_recommendation.recommended_caption
    when 'alternative_1' then v_recommendation.alternative_captions[1]
    when 'alternative_2' then v_recommendation.alternative_captions[2]
    else p_caption_snapshot
  end;
  if v_expected_caption is null or trim(p_caption_snapshot) = '' or p_caption_snapshot <> v_expected_caption then
    raise exception 'The caption does not match the selected recommendation variant' using errcode = '22023';
  end if;

  select coalesce(array_agg(item.value order by item.group_order, item.item_order), '{}'::text[])
  into v_expected_hashtags
  from (
    select 1 as group_order, ordinality as item_order, value from jsonb_array_elements_text(coalesce(v_recommendation.hashtag_groups -> 'brand', '[]'::jsonb)) with ordinality
    union all
    select 2, ordinality, value from jsonb_array_elements_text(coalesce(v_recommendation.hashtag_groups -> 'local', '[]'::jsonb)) with ordinality
    union all
    select 3, ordinality, value from jsonb_array_elements_text(coalesce(v_recommendation.hashtag_groups -> 'service', '[]'::jsonb)) with ordinality
    union all
    select 4, ordinality, value from jsonb_array_elements_text(coalesce(v_recommendation.hashtag_groups -> 'audience', '[]'::jsonb)) with ordinality
  ) as item;
  if p_hashtag_snapshot is distinct from v_expected_hashtags then
    raise exception 'The hashtag snapshot does not match this recommendation' using errcode = '22023';
  end if;

  select coalesce(array_agg(cleaned order by ordinality), '{}'::text[])
  into v_stored_hashtags
  from (
    select ordinality, regexp_replace(trim(value), '^#+', '') as cleaned
    from unnest(p_hashtag_snapshot) with ordinality as hashtag(value, ordinality)
  ) as normalised
  where cleaned <> '' and cleaned !~ '\s';

  update public.content_drafts
  set body = p_caption_snapshot,
      hashtags = v_stored_hashtags,
      updated_by = (select auth.uid())
  where content_drafts.id = p_draft_id
    and content_drafts.organisation_id = p_organisation_id
  returning * into v_draft;

  insert into public.engagement_feedback_events (
    organisation_id, draft_id, recommendation_id, action, variant,
    caption_snapshot, hashtag_snapshot, reason, created_by, applied_draft_version
  ) values (
    p_organisation_id, p_draft_id, p_recommendation_id, 'selected', p_variant,
    p_caption_snapshot, p_hashtag_snapshot, 'Applied atomically to draft', (select auth.uid()), v_draft.version
  ) returning * into v_feedback;

  update public.content_draft_versions
  set change_summary = 'Applied AWO engagement recommendation'
  where content_draft_versions.draft_id = p_draft_id
    and content_draft_versions.organisation_id = p_organisation_id
    and content_draft_versions.version = v_draft.version
    and content_draft_versions.change_summary is null;

  return query select
    v_feedback.id, v_feedback.organisation_id, v_feedback.draft_id,
    v_feedback.recommendation_id, v_feedback.action, v_feedback.variant,
    v_feedback.caption_snapshot, v_feedback.hashtag_snapshot, v_feedback.reason,
    v_feedback.created_by, v_feedback.created_at, v_feedback.applied_draft_version, v_draft.version;
end;
$$;

revoke all on function public.apply_engagement_recommendation(uuid, uuid, uuid, public.engagement_variant, text, text[]) from public, anon;
grant execute on function public.apply_engagement_recommendation(uuid, uuid, uuid, public.engagement_variant, text, text[]) to authenticated;
