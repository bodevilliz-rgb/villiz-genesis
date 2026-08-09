-- Draft hashtags: first-class field on content_drafts and content_draft_versions.
--
-- Hashtags are stored as normalized tokens (no leading #) in a text array.
-- They are combined with the draft body only at the publishing boundary via
-- composePublishedText() — the stored body column is never modified.
--
-- Both tables receive the column so that version snapshots include hashtags,
-- and restoring a version also restores the hashtag set that existed at that
-- point in time.
--
-- The existing trigger that writes version rows on content_drafts updates will
-- copy the hashtags column automatically once it is present on both tables.

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS hashtags text[] NOT NULL DEFAULT '{}';

ALTER TABLE content_draft_versions
  ADD COLUMN IF NOT EXISTS hashtags text[] NOT NULL DEFAULT '{}';
