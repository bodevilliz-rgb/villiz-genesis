-- Project Genesis Local Seed Data
-- Locked to local stabilisation requirements.

-- 1. Ensure platform settings email domains remain strict (retaining default security)
UPDATE public.platform_settings 
SET allowed_email_domains = ARRAY['villiz.com']
WHERE id = true;

-- 2. Insert Bodevilliz@gmail.com explicitly into auth.users (to allow auth lookup)
-- ID: 0eea9074-18f3-4934-9e20-b2bfde1fef05
-- Every column below is required for GoTrue itself to find and accept this row.
-- A minimal insert (id/email/raw_user_meta_data only, as this used to be) looks
-- fine in the table but is invisible to GoTrue's own logic in three separate
-- ways, confirmed by comparing against a row GoTrue creates itself:
--   - instance_id must be the fixed zero-UUID: GoTrue's lookup index is on
--     (instance_id, lower(email)), so a NULL instance_id never matches.
--   - email must already be lowercase: GoTrue writes it lowercase itself and
--     compares exactly, not case-insensitively, against what's stored.
--   - confirmation_token/recovery_token/email_change/email_change_token_new
--     have no column default and are NOT NULL in GoTrue's own row-scanning
--     code; a NULL there breaks the scan with an opaque 500, not a clean error.
-- Any one of these being wrong makes GoTrue treat this email as never having
-- signed up, so it tries to create a second user for it — which then collides
-- with this row's own unique constraints. That was silently breaking both the
-- real magic-link flow and admin-generated links, not just this seed script.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at
)
VALUES (
  '0eea9074-18f3-4934-9e20-b2bfde1fef05',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'bodevilliz@gmail.com',
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Bode Villiz"}'::jsonb,
  '',
  '',
  '',
  '',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
SET
  instance_id = EXCLUDED.instance_id,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role,
  email = EXCLUDED.email,
  email_confirmed_at = coalesce(auth.users.email_confirmed_at, EXCLUDED.email_confirmed_at),
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  confirmation_token = coalesce(auth.users.confirmation_token, ''),
  recovery_token = coalesce(auth.users.recovery_token, ''),
  email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
  email_change_token_current = coalesce(auth.users.email_change_token_current, ''),
  reauthentication_token = coalesce(auth.users.reauthentication_token, ''),
  email_change = coalesce(auth.users.email_change, ''),
  created_at = coalesce(auth.users.created_at, EXCLUDED.created_at),
  updated_at = now();

-- 2b. Insert the matching auth.identities row. GoTrue resolves "does this email
-- already have an account" through auth.identities, not auth.users directly —
-- without this row, both the real magic-link flow (signInWithOtp) and the
-- admin-generated-link flow treat this email as a brand-new signup and reject
-- it (enable_signup = false), even though the auth.users row above exists.
INSERT INTO auth.identities (user_id, provider_id, provider, identity_data, created_at, updated_at)
VALUES (
  '0eea9074-18f3-4934-9e20-b2bfde1fef05',
  '0eea9074-18f3-4934-9e20-b2bfde1fef05',
  'email',
  jsonb_build_object(
    'sub', '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    'email', 'bodevilliz@gmail.com',
    'email_verified', true,
    'phone_verified', false
  ),
  now(),
  now()
)
ON CONFLICT (provider_id, provider) DO UPDATE
SET
  identity_data = EXCLUDED.identity_data,
  created_at = coalesce(auth.identities.created_at, EXCLUDED.created_at),
  updated_at = now();

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
