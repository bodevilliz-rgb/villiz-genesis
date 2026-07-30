-- ===========================================================================
-- Project Genesis — 0007 Usage snapshot
--
-- A single view is the source of truth for guardrail consumption. It is
-- computed from live tables, never cached and never estimated, so the number
-- on the dashboard is the number in the database.
--
-- security_invoker = on: the view is filtered by the caller's RLS, so staff
-- only ever see usage for organisations they are assigned to.
-- ===========================================================================

create or replace view public.organisation_usage_snapshot
with (security_invoker = on)
as
select
  o.id as organisation_id,
  coalesce(sa.connected_accounts, 0)::integer as social_accounts_used,
  coalesce(sp.posts_this_week, 0)::integer as posts_this_week,
  coalesce(ma.storage_bytes, 0)::bigint as storage_bytes_used,
  coalesce(ai.tokens_this_month, 0)::bigint as ai_tokens_this_month,
  coalesce(mb.entry_count, 0)::integer as membrain_entries_used,
  l.max_social_accounts,
  l.max_posts_per_week,
  l.max_storage_bytes,
  l.max_ai_tokens_per_month,
  l.max_membrain_entries
from public.organisations o
join public.organisation_limits l on l.organisation_id = o.id
left join lateral (
  select count(*) as connected_accounts
  from public.social_accounts x
  where x.organisation_id = o.id and x.status = 'connected'
) sa on true
left join lateral (
  select count(*) as posts_this_week
  from public.scheduled_posts x
  where x.organisation_id = o.id
    and x.status in ('scheduled', 'published')
    and coalesce(x.published_at, x.scheduled_for) >= date_trunc('week', now())
    and coalesce(x.published_at, x.scheduled_for) < date_trunc('week', now()) + interval '1 week'
) sp on true
left join lateral (
  select sum(x.size_bytes) as storage_bytes
  from public.media_assets x
  where x.organisation_id = o.id
) ma on true
left join lateral (
  select sum(x.input_tokens + x.output_tokens) as tokens_this_month
  from public.ai_usage_events x
  where x.organisation_id = o.id
    and x.occurred_at >= date_trunc('month', now())
) ai on true
left join lateral (
  select count(*) as entry_count
  from public.membrain_entries x
  where x.organisation_id = o.id and x.status <> 'archived'
) mb on true;

grant select on public.organisation_usage_snapshot to authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement. Limits that are only rendered are decoration; this one bites.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_membrain_entry_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select max_membrain_entries into v_limit
  from public.organisation_limits
  where organisation_id = new.organisation_id;

  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.membrain_entries
  where organisation_id = new.organisation_id and status <> 'archived';

  if v_count >= v_limit then
    raise exception 'MemBrain entry limit reached for this organisation (% of %)', v_count, v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists membrain_entries_enforce_limit on public.membrain_entries;
create trigger membrain_entries_enforce_limit
  before insert on public.membrain_entries
  for each row execute function app.enforce_membrain_entry_limit();
