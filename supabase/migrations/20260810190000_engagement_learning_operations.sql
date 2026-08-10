-- Sprint 13: operationalise the engagement learning loop.
-- Keep historical metrics immutable while scoping comparisons to the exact
-- Blotato destination account used for each published post.

-- Sprint 11 deliberately rejects every update. Temporarily remove that trigger
-- inside this migration transaction solely for the deterministic legacy
-- backfill, then restore it before the migration can commit.
drop trigger if exists engagement_metric_snapshots_immutable
  on public.engagement_metric_snapshots;

alter table public.engagement_metric_snapshots
  add column provider_account_id text;

update public.engagement_metric_snapshots as metric
set provider_account_id = nullif(trim(attempt.provider_metadata ->> 'blotatoAccountId'), '')
from public.publishing_attempts as attempt
where attempt.id = metric.publishing_attempt_id
  and metric.organisation_id = attempt.organisation_id
  and metric.provider_account_id is null;

alter table public.engagement_metric_snapshots
  add constraint engagement_metrics_provider_account_length
  check (provider_account_id is null or char_length(provider_account_id) between 1 and 200);

create index engagement_metrics_account_baseline_idx
  on public.engagement_metric_snapshots
    (organisation_id, provider_account_id, platform, objective_type, observed_at desc)
  where provider_account_id is not null;

create index engagement_metrics_draft_latest_idx
  on public.engagement_metric_snapshots
    (organisation_id, draft_id, observed_at desc);

comment on column public.engagement_metric_snapshots.provider_account_id is
  'Historical Blotato destination ID captured from the publishing attempt. Null only for legacy attempts; null rows never enter account-scoped performance baselines.';

create trigger engagement_metric_snapshots_immutable
  before update on public.engagement_metric_snapshots
  for each row execute function app.prevent_engagement_metric_update();
