-- Add new statuses for the Publishing Pipeline

ALTER TYPE public.content_draft_status ADD VALUE IF NOT EXISTS 'publishing';
ALTER TYPE public.content_draft_status ADD VALUE IF NOT EXISTS 'failed';
