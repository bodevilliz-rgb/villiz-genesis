-- ===========================================================================
-- Project Genesis — Sprint 2: Campaign Orchestration & Calendar
-- ===========================================================================

-- Alter campaigns table to support planning metadata
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS client text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS campaign_type text,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_members uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS color_label text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS assets jsonb DEFAULT '[]';

-- Alter content drafts to support due dates and multiple reviewers
ALTER TABLE public.content_drafts
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewer_ids uuid[] DEFAULT '{}';

-- Create comment threads table
CREATE TABLE IF NOT EXISTS public.content_draft_comments (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.content_drafts (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  parent_id uuid REFERENCES public.content_draft_comments (id) ON DELETE CASCADE,
  body text NOT NULL,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comment_body_length check (char_length(trim(body)) between 1 and 4000)
);

CREATE INDEX IF NOT EXISTS comments_draft_idx ON public.content_draft_comments (draft_id, created_at ASC);
CREATE INDEX IF NOT EXISTS comments_org_idx ON public.content_draft_comments (organisation_id, created_at DESC);

-- Enable RLS and setup policies
ALTER TABLE public.content_draft_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_select ON public.content_draft_comments
  FOR SELECT TO authenticated USING (app.is_org_member(organisation_id));

CREATE POLICY comments_insert ON public.content_draft_comments
  FOR INSERT TO authenticated WITH CHECK (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id));

CREATE POLICY comments_update ON public.content_draft_comments
  FOR UPDATE TO authenticated USING (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id));

CREATE POLICY comments_delete ON public.content_draft_comments
  FOR DELETE TO authenticated USING (app.can_write_org(organisation_id) or app.can_approve_org(organisation_id));
