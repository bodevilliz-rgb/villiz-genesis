-- ===========================================================================
-- Project Genesis — Sprint 2.1: Content Studio Workflow States & Scheduling
--
-- Adds new workflow states, content types, and columns for scheduling.
-- ===========================================================================

-- 1. Add new enum values to public.content_draft_status
alter type public.content_draft_status add value if not exists 'in_review';
alter type public.content_draft_status add value if not exists 'changes_requested';
alter type public.content_draft_status add value if not exists 'scheduled';
alter type public.content_draft_status add value if not exists 'published';
alter type public.content_draft_status add value if not exists 'archived';

-- 2. Add new enum values to public.content_draft_type
alter type public.content_draft_type add value if not exists 'caption';
alter type public.content_draft_type add value if not exists 'campaign_copy';
alter type public.content_draft_type add value if not exists 'image_prompt';

-- 3. Add scheduling columns to public.content_drafts
alter table public.content_drafts
  add column if not exists scheduled_at timestamptz,
  add column if not exists scheduled_platform text,
  add column if not exists scheduled_timezone text;
