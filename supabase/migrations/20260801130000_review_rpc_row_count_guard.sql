-- ===========================================================================
-- Sprint 5 — Root cause hardening for the approval workflow
--
-- perform_content_draft_review()'s UPDATE was never checked for affected row
-- count. Because the function is SECURITY INVOKER, its UPDATE is governed by
-- the content_drafts_update RLS policy at the moment it runs; Postgres RLS
-- does not raise an error when a policy excludes a row from an UPDATE — it
-- simply matches zero rows. Without a row-count check, that zero-row outcome
-- was indistinguishable from success: the function would still INSERT an
-- audit row into content_draft_reviews claiming the action happened, even
-- though content_drafts.status never changed.
--
-- This was NOT the cause of the specific "stuck in review" incident
-- investigated in Sprint 5 (that traced to duplicate `next dev` processes —
-- see scripts/dev-local.js) but it is a real, separate silent-failure vector
-- that the mission's own "no invalid transition, no silent reversion"
-- requirement rules out. Closing it here, additively, so the same symptom
-- can never arise from a genuine RLS/permission edge case either.
--
-- IMPORTANT SCHEMA NOTE, found while writing this migration: the original
-- 20260731090000_review_workflow.sql declared this function as
-- app.perform_content_draft_review, but this repo's supabase/config.toml has
-- `[api] schemas = ["public"]` — PostgREST's RPC endpoint only ever resolves
-- functions living in `public`, so `app.perform_content_draft_review` was
-- never actually reachable via `.rpc("perform_content_draft_review")` at all.
-- The live database already has a separate public.perform_content_draft_review
-- (created outside the migration history, evidently to work around exactly
-- this) which is the one the application has been calling. This migration
-- patches that live, actually-called public-schema function. It does not
-- touch app.perform_content_draft_review (dead code, left as-is) and does not
-- modify the original migration file.
-- ===========================================================================

create or replace function public.perform_content_draft_review(
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
  v_updated_rows int;
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

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows = 0 then
    -- The row was visible for the SELECT above but not writable under RLS for
    -- this actor. Fail loudly instead of silently recording a decision that
    -- never actually applied to the draft.
    raise exception 'You do not have permission to update this draft' using errcode = '42501';
  end if;

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
