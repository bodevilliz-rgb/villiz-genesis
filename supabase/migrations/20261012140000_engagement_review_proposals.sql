-- GENv2-P2: review-only scorecard proposals.
-- A proposal is advice, not publishing configuration. This table has no foreign
-- key, trigger, RPC or write path into publishing_jobs, account settings or
-- scheduling configuration; applying a proposal requires a separate owner-GO
-- action and implementation path.

create table public.engagement_review_proposals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  week_start date not null,
  platform text,
  caption_pattern text,
  publishing_slot text,
  review_note text not null check (char_length(trim(review_note)) between 1 and 2000),
  status text not null default 'proposed' check (status in ('proposed', 'accepted_for_review', 'rejected')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  owner_go_by uuid references public.profiles(id) on delete set null,
  owner_go_at timestamptz,
  constraint engagement_review_proposals_review_pair check (
    (reviewed_by is null and reviewed_at is null) or
    (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint engagement_review_proposals_owner_go_pair check (
    (owner_go_by is null and owner_go_at is null) or
    (owner_go_by is not null and owner_go_at is not null)
  )
);

create index engagement_review_proposals_week_idx
  on public.engagement_review_proposals (organisation_id, week_start desc, created_at desc);

alter table public.engagement_review_proposals enable row level security;

create policy engagement_review_proposals_select
  on public.engagement_review_proposals for select to authenticated
  using (app.is_org_member(organisation_id));

create policy engagement_review_proposals_insert
  on public.engagement_review_proposals for insert to authenticated
  with check (
    app.can_write_org(organisation_id)
    and created_by = (select auth.uid())
    and status = 'proposed'
    and reviewed_by is null
    and reviewed_at is null
    and owner_go_by is null
    and owner_go_at is null
  );

-- Review and owner-GO transitions are intentionally server-action/RPC-only.
-- Ordinary authenticated clients cannot mutate or delete proposal history.
revoke update, delete on public.engagement_review_proposals from authenticated;

comment on table public.engagement_review_proposals is
  'Immutable weekly scorecard review notes. Rows never auto-apply to publishing configuration; owner_go_* is only an explicit approval receipt.';
