-- Sprint 12: Client Report Generator
--
-- Stores the per-period record that Villiz operators create when they generate
-- a monthly client report. The report DATA itself (metrics, drafts, publishing
-- jobs) is computed live from existing tables at render time — only operator
-- notes, next-month recommendations, and the metadata needed to reconstruct
-- report history are persisted here.
--
-- One row per (organisation, period_start, period_end, campaign_id) tuple.
-- campaign_id is nullable (whole-org report vs. campaign-scoped report), so
-- the uniqueness constraint uses coalesce to make NULLs compare equal.

create table public.client_reports (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations(id) on delete cascade,
  period_start    date        not null,
  period_end      date        not null,
  campaign_id     uuid        references public.campaigns(id) on delete set null,
  operator_notes  text,
  recommendations text,
  generated_by    uuid        references auth.users(id) on delete set null,
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint client_reports_period_order check (period_end >= period_start)
);

-- One report per org/period/campaign combination (NULL campaign = whole-org report).
create unique index client_reports_period_uidx
  on public.client_reports (organisation_id, period_start, period_end, coalesce(campaign_id::text, ''));

create trigger client_reports_updated_at
  before update on public.client_reports
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.client_reports enable row level security;

create policy client_reports_select on public.client_reports
  for select to authenticated
  using (app.is_org_member(organisation_id));

create policy client_reports_insert on public.client_reports
  for insert to authenticated
  with check (app.can_write_org(organisation_id));

create policy client_reports_update on public.client_reports
  for update to authenticated
  using  (app.can_write_org(organisation_id))
  with check (app.can_write_org(organisation_id));
