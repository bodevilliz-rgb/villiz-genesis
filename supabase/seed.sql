-- Project Genesis Local Seed Data
-- Locked to local stabilisation requirements.

-- 1. Ensure platform settings email domains remain strict (retaining default security)
UPDATE public.platform_settings 
SET allowed_email_domains = ARRAY['villiz.com']
WHERE id = true;

-- 2. Insert Bodevilliz@gmail.com explicitly into auth.users (to allow auth lookup)
-- ID: 0eea9074-18f3-4934-9e20-b2bfde1fef05
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
  'Bodevilliz@gmail.com',
  '{"full_name": "Bode Villiz"}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email, raw_user_meta_data = EXCLUDED.raw_user_meta_data;

-- 3. Ensure profile is active and role is set to owner (explicit activation bypassing domain check)
INSERT INTO public.profiles (id, email, full_name, role, is_active)
VALUES (
  '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
  'bodevilliz@gmail.com', 
  'Bode Villiz', 
  'owner', 
  true
)
ON CONFLICT (id) DO UPDATE
SET is_active = true, role = 'owner', full_name = EXCLUDED.full_name;

-- 4. Seed the Client Organisation (Villiz Pixels)
INSERT INTO public.organisations (id, name, slug, status, created_by)
VALUES (
  '00000000-0000-4000-b000-000000000001', 
  'Villiz Pixels', 
  'villiz-pixels', 
  'active', 
  '0eea9074-18f3-4934-9e20-b2bfde1fef05'
)
ON CONFLICT (id) DO NOTHING;

-- 5. Seed organisation membership (role must be lead)
INSERT INTO public.organisation_members (organisation_id, profile_id, role, assigned_by)
VALUES (
  '00000000-0000-4000-b000-000000000001', 
  '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
  'lead',
  '0eea9074-18f3-4934-9e20-b2bfde1fef05'
)
ON CONFLICT (organisation_id, profile_id) DO UPDATE
SET role = 'lead';

-- 6. Seed Campaigns (At least 2 campaigns)
INSERT INTO public.campaigns (id, organisation_id, name, description, objective, target_audience, primary_cta, start_date, end_date, status, platforms, created_by, updated_by)
VALUES 
  (
    '00000000-0000-4000-c000-000000000001', 
    '00000000-0000-4000-b000-000000000001', 
    'Summer Launch 2026', 
    'Marketing campaign for summer launch.', 
    'Objective to reach 10k users.', 
    'Young adults', 
    'Sign up today', 
    '2026-06-01', 
    '2026-08-31', 
    'active', 
    ARRAY['instagram', 'linkedin']::public.social_platform[], 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '0eea9074-18f3-4934-9e20-b2bfde1fef05'
  ),
  (
    '00000000-0000-4000-c000-000000000002', 
    '00000000-0000-4000-b000-000000000001', 
    'Q3 Brand Awareness', 
    'Brand awareness campaign.', 
    'Build community', 
    'Developers', 
    'Learn more', 
    '2026-07-01', 
    '2026-09-30', 
    'planning', 
    ARRAY['x', 'youtube']::public.social_platform[], 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '0eea9074-18f3-4934-9e20-b2bfde1fef05'
  )
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name, description = EXCLUDED.description, objective = EXCLUDED.objective, status = EXCLUDED.status, platforms = EXCLUDED.platforms;

-- 7. Seed Content Drafts (At least 3 drafts in different states, at least 2 scheduled for calendar items)
INSERT INTO public.content_drafts (
  id, organisation_id, title, content_type, summary, body, status, awo_status, version, 
  created_by, updated_by, campaign_id, due_at, reviewer_ids,
  scheduled_at, scheduled_platform, scheduled_timezone
)
VALUES
  (
    '00000000-0000-4000-d000-000000000001', 
    '00000000-0000-4000-b000-000000000001', 
    'LinkedIn Announcement', 
    'social_post', 
    'Short announcement for LinkedIn.', 
    'We are thrilled to announce our new brand direction!', 
    'draft', 
    'not_requested', 
    1, 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '00000000-0000-4000-c000-000000000001', 
    now() + interval '2 days', 
    '{}',
    null, null, null
  ),
  (
    '00000000-0000-4000-d000-000000000002', 
    '00000000-0000-4000-b000-000000000001', 
    'Q3 Launch Email Newsletter', 
    'email', 
    'First newsletter drafts.', 
    'Hi team, here is what we are planning for Q3...', 
    'needs_review', 
    'not_requested', 
    1, 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '00000000-0000-4000-c000-000000000002', 
    now() + interval '5 days', 
    ARRAY['0eea9074-18f3-4934-9e20-b2bfde1fef05']::uuid[],
    null, null, null
  ),
  (
    '00000000-0000-4000-d000-000000000003', 
    '00000000-0000-4000-b000-000000000001', 
    'Instagram Promo Post', 
    'social_post', 
    'Approved post for Instagram.', 
    'Check out our new look!', 
    'approved', 
    'not_requested', 
    1, 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '00000000-0000-4000-c000-000000000001', 
    now() - interval '1 day', 
    '{}',
    now() + interval '1 day', 'instagram', 'UTC' -- Calendar Item 1
  ),
  (
    '00000000-0000-4000-d000-000000000004', 
    '00000000-0000-4000-b000-000000000001', 
    'Twitter Launch Teaser', 
    'social_post', 
    'Teaser tweet for X.', 
    'Big news coming next week. Stay tuned!', 
    'scheduled', 
    'not_requested', 
    1, 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '00000000-0000-4000-c000-000000000002', 
    now() + interval '3 days', 
    '{}',
    now() + interval '3 days', 'x', 'UTC' -- Calendar Item 2
  )
ON CONFLICT (id) DO UPDATE 
SET title = EXCLUDED.title, body = EXCLUDED.body, status = EXCLUDED.status, scheduled_at = EXCLUDED.scheduled_at, scheduled_platform = EXCLUDED.scheduled_platform, scheduled_timezone = EXCLUDED.scheduled_timezone;

-- 8. Seed Reviews (At least 1 review)
INSERT INTO public.content_draft_reviews (id, draft_id, organisation_id, action, actor_id, previous_status, new_status, comment)
VALUES (
  '00000000-0000-4000-e000-000000000001', 
  '00000000-0000-4000-d000-000000000003', 
  '00000000-0000-4000-b000-000000000001', 
  'approved', 
  '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
  'needs_review', 
  'approved', 
  'Looks wonderful! Approved.'
)
ON CONFLICT (id) DO NOTHING;

-- 9. Seed Content Draft Versions (Required to populate Dashboard Activity Feed)
INSERT INTO public.content_draft_versions (id, draft_id, organisation_id, version, title, body, content_type, status, change_summary, created_at, changed_by)
VALUES 
  (
    '00000000-0000-4000-f000-000000000001', 
    '00000000-0000-4000-d000-000000000001', 
    '00000000-0000-4000-b000-000000000001', 
    1, 
    'LinkedIn Announcement', 
    'We are thrilled to announce our new brand direction!', 
    'social_post', 
    'draft', 
    'Initial draft creation.', 
    now() - interval '1 hour', 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05'
  ),
  (
    '00000000-0000-4000-f000-000000000002', 
    '00000000-0000-4000-d000-000000000003', 
    '00000000-0000-4000-b000-000000000001', 
    1, 
    'Instagram Promo Post', 
    'Check out our new look!', 
    'social_post', 
    'approved', 
    'Approved first version.', 
    now() - interval '2 hours', 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05'
  )
ON CONFLICT (draft_id, version) DO NOTHING;

-- 10. Seed organisation limits (for usage dashboard meters)
INSERT INTO public.organisation_limits (organisation_id, max_social_accounts, max_posts_per_week, max_storage_bytes, max_ai_tokens_per_month, max_membrain_entries)
VALUES (
  '00000000-0000-4000-b000-000000000001',
  6,
  25,
  10737418240, -- 10 GB
  2000000,
  2000
)
ON CONFLICT (organisation_id) DO NOTHING;
