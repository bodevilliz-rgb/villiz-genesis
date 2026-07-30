-- ===========================================================================
-- Project Genesis — Sprint 4.1: Internal Approval Workflow
--
-- Completes the human review/approval workflow behind the existing
-- cross-organisation Review Queue. Genesis owns internal workflow and
-- governance; this migration adds nothing that schedules, publishes, or
-- talks to a social platform, n8n, or Blotato.
--
-- ARCHITECTURAL DECISIONS
--
-- 1. 'rejected' is added to content_draft_status, NOT to public.post_status
--    (0004's separate 9-value enum, which already reserves its own
--    'in_review'/'scheduled'/'published'/'failed' values for the still
--    unbuilt publishing queue). A rejected draft is a governance outcome —
--    Genesis's own remit — not a publishing state, so it belongs on
--    Content Studio's own status enum, exactly where 'draft'/'needs_review'/
--    'approved' already live.
--
-- 2. No separate "in review" status. Reviewer assignment
--    (assigned_reviewer_id) is orthogonal metadata, exactly like
--    awo_status already is — a draft can be "Needs Review" and "assigned to
--    Priya" at the same time; assignment routes visibility and workload, it
--    does not gate who may act (see policy note on the RPC below). No
--    "startReview" action exists for the same reason: it would change
--    neither status nor assignment, so it would be ceremony with no
--    governance effect.
--
-- 3. last_review_action / last_review_at are the two columns that make the
--    Review Queue's "returned for changes" / "recently approved" tabs and
--    the Dashboard's approval metrics computable from a single bounded
--    fetch, with no lateral join, view, or second query per draft. They are
--    written atomically alongside status by the same RPC that writes the
--    audit row below — a read-optimisation, not a second source of truth
--    (content_draft_reviews remains the authoritative history).
--
-- 4. content_draft_reviews is a new, separate audit table — NOT a reuse of
--    content_draft_versions. Version history proves what a draft's content
--    looked like at each edit; review history proves who decided what, when,
--    and why. Conflating them would make neither answer its own question
--    cleanly, which is why this migration adds a second append-only trigger
--    rather than extending the existing one.
--
-- 5. app.perform_content_draft_review() is SECURITY INVOKER, not DEFINER.
--    Every one of its writes (the content_drafts UPDATE and the
--    content_draft_reviews INSERT) is already covered by the *existing*
--    content_drafts_update policy (can_write_org OR can_approve_org) and a
--    matching new insert policy on content_draft_reviews — so the function
--    needs no elevated privilege and no duplicated permission check of its
--    own. RLS is the only authorisation boundary this function relies on;
--    fine-grained rules (which transition, whose comment is required,
--    self-approval prevention, reviewer eligibility) are validated in the
--    TypeScript use-case layer *before* this function is ever called — the
--    function itself is a dumb, atomic "write these columns and append this
--    audit row" primitive, so the transition matrix exists in exactly one
--    place, not two.
-- ===========================================================================

alter type public.content_draft_status add value if not exists 'rejected';

create type public.content_draft_review_action as enum (
  'submitted', 'assigned', 'reassigned', 'approved', 'changes_requested', 'rejected', 'reopened'
);

-- ---------------------------------------------------------------------------
-- content_drafts gains reviewer-assignment + last-decision metadata
-- ---------------------------------------------------------------------------
alter table public.content_drafts
  add column assigned_reviewer_id uuid references public.profiles (id) on delete set null,
  add column last_review_action public.content_draft_review_action,
  add column last_review_at timestamptz;

create index content_drafts_org_assigned_reviewer_idx
  on public.content_drafts (organisation_id, assigned_reviewer_id);

create index content_drafts_org_last_review_idx
  on public.content_drafts (organisation_id, last_review_action, last_review_at desc);

-- ---------------------------------------------------------------------------
-- Immutable review history — a parallel, separate concern to
-- content_draft_versions (see decision note 4).
-- ---------------------------------------------------------------------------
create table public.content_draft_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  draft_id uuid not null references public.content_drafts (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  action public.content_draft_review_action not null,
  actor_id uuid references public.profiles (id) on delete set null,
  assigned_reviewer_id uuid references public.profiles (id) on delete set null,
  previous_status public.content_draft_status not null,
  new_status public.content_draft_status not null,
  comment text,
  created_at timestamptz not null default now(),

  constraint content_draft_reviews_comment_length check (comment is null or char_length(comment) <= 2000)
);

create index content_draft_reviews_draft_idx
  on public.content_draft_reviews (draft_id, created_at desc);

create index content_draft_reviews_org_idx
  on public.content_draft_reviews (organisation_id, created_at desc);

create or replace function app.guard_content_draft_reviews_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Review history cannot be modified or deleted' using errcode = '42501';
end;
$$;

drop trigger if exists content_draft_reviews_append_only on public.content_draft_reviews;
create trigger content_draft_reviews_append_only
  before update or delete on public.content_draft_reviews
  for each row execute function app.guard_content_draft_reviews_immutable();

-- ---------------------------------------------------------------------------
-- Atomic write primitive — see decision note 5. Deliberately has no business
-- rules of its own: the actor's permission, the current status, whether a
-- comment is required, reviewer eligibility, and self-approval prevention
-- are all validated in TypeScript before this is ever called.
-- ---------------------------------------------------------------------------
create or replace function app.perform_content_draft_review(
  p_draft_id uuid,
  p_action public.content_draft_review_action,
  p_new_status public.content_draft_status,
  p_assigned_reviewer_id uuid,
  p_comment text
)
returns void
language plpgsql
as $$
declare
  v_organisation_id uuid;
  v_previous_status public.content_draft_status;
begin
  select organisation_id, status into v_organisation_id, v_previous_status
  from public.content_drafts
  where id = p_draft_id
  for update;

  if v_organisation_id is null then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;

  update public.content_drafts
  set
    status = coalesce(p_new_status, status),
    assigned_reviewer_id = case
      when p_action in ('assigned', 'reassigned') then p_assigned_reviewer_id
      else assigned_reviewer_id
    end,
    last_review_action = p_action,
    last_review_at = now(),
    updated_by = (select auth.uid())
  where id = p_draft_id;

  insert into public.content_draft_reviews (
    draft_id, organisation_id, action, actor_id, assigned_reviewer_id,
    previous_status, new_status, comment
  )
  values (
    p_draft_id, v_organisation_id, p_action, (select auth.uid()), p_assigned_reviewer_id,
    v_previous_status, coalesce(p_new_status, v_previous_status), p_comment
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.content_draft_reviews enable row level security;

create policy content_draft_reviews_select on public.content_draft_reviews
  for select to authenticated using (app.is_org_member(organisation_id));

-- Mirrors content_drafts_update exactly — the same actors who may write or
-- approve content may append a review-history row about it.
create policy content_draft_reviews_insert on public.content_draft_reviews
  for insert to authenticated
  with check (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id));
