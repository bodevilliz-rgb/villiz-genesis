-- Sprint 15.1: fail closed when applying legacy or unaudited LinkedIn recommendations.
-- The application performs the same check for a useful operator error; this
-- database guard prevents a direct authenticated RPC call from bypassing it.

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

  if v_recommendation.platform = 'linkedin'
    and coalesce(v_recommendation.creative_guidance #>> '{linkedinPersonalProfile,auditStatus}', '') <> 'passed' then
    raise exception 'This LinkedIn recommendation requires independent grounding. Generate a new recommendation before applying it' using errcode = '22023';
  end if;
  if v_recommendation.platform = 'linkedin' and p_variant = 'custom' then
    raise exception 'Save custom LinkedIn wording as the draft and generate a new audited recommendation before applying it' using errcode = '22023';
  end if;

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
