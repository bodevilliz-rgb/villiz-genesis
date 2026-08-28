-- Genesis Intent-to-Opportunity Engine v1.
-- Captures minimal, structured commercial demand signals for every organisation.
-- No raw conversations, customer identifiers, contact details or sensitive traits.

create type public.intent_source as enum ('phone', 'direct_message', 'website', 'booking', 'social', 'referral', 'other');
create type public.intent_stage as enum ('enquiry', 'quote_requested', 'booking_started', 'booked', 'lost');
create type public.intent_consent_status as enum ('not_recorded', 'not_required', 'consented', 'objected');

create table public.intent_signals (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  service_key text not null,
  service_label text not null,
  locality text,
  desired_timeframe text,
  source public.intent_source not null,
  stage public.intent_stage not null default 'enquiry',
  consent_status public.intent_consent_status not null default 'not_recorded',
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intent_service_key_format check (service_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(service_key) between 2 and 80),
  constraint intent_service_label_length check (char_length(trim(service_label)) between 2 and 120),
  constraint intent_locality_length check (locality is null or char_length(trim(locality)) between 2 and 120),
  constraint intent_timeframe_length check (desired_timeframe is null or char_length(trim(desired_timeframe)) between 2 and 120)
);

create index intent_signals_org_occurred_idx on public.intent_signals (organisation_id, occurred_at desc);
create index intent_signals_org_service_locality_idx on public.intent_signals (organisation_id, service_key, locality, occurred_at desc);
create trigger intent_signals_touch before update on public.intent_signals for each row execute function app.touch_updated_at();

alter table public.intent_signals enable row level security;

create policy intent_signals_select on public.intent_signals
  for select to authenticated using (app.is_org_member(organisation_id));
create policy intent_signals_insert on public.intent_signals
  for insert to authenticated with check (app.can_write_org(organisation_id) and created_by = (select auth.uid()));
create policy intent_signals_update on public.intent_signals
  for update to authenticated using (app.can_write_org(organisation_id)) with check (app.can_write_org(organisation_id));
create policy intent_signals_delete on public.intent_signals
  for delete to authenticated using (app.can_write_org(organisation_id));

comment on table public.intent_signals is
  'Minimal organisation-scoped demand signals. Never store raw calls, messages, contact details or sensitive traits.';
