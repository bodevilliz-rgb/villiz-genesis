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
ALTER TABLE public.profiles DISABLE TRIGGER profiles_guard_self_escalation;
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
ALTER TABLE public.profiles ENABLE TRIGGER profiles_guard_self_escalation;

-- 3b. Insert a test author so Bode can approve their drafts
INSERT INTO auth.users (
  id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at
)
VALUES (
  '11111111-1111-4111-b111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'author@villiz.com',
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Test Author"}'::jsonb,
  '', '', '', '', now(), now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (user_id, provider_id, provider, identity_data, created_at, updated_at)
VALUES (
  '11111111-1111-4111-b111-111111111111',
  '11111111-1111-4111-b111-111111111111',
  'email',
  jsonb_build_object(
    'sub', '11111111-1111-4111-b111-111111111111',
    'email', 'author@villiz.com',
    'email_verified', true,
    'phone_verified', false
  ),
  now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

ALTER TABLE public.profiles DISABLE TRIGGER profiles_guard_self_escalation;
INSERT INTO public.profiles (id, email, full_name, role, is_active)
VALUES (
  '11111111-1111-4111-b111-111111111111', 
  'author@villiz.com', 
  'Test Author', 
  'member', 
  true
)
ON CONFLICT (id) DO UPDATE
SET is_active = true, role = 'member', full_name = EXCLUDED.full_name;
ALTER TABLE public.profiles ENABLE TRIGGER profiles_guard_self_escalation;

-- 4. Seed the Client Organisation (Villiz Pixels UK — the UK market entity is
-- Client Zero; scripts/local-seed-verification.js enforces this exact name).
INSERT INTO public.organisations (id, name, slug, status, created_by)
VALUES (
  '00000000-0000-4000-b000-000000000001',
  'Villiz Pixels UK',
  'villiz-pixels',
  'active',
  '0eea9074-18f3-4934-9e20-b2bfde1fef05'
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- 5. Link Bode to the Organisation as Lead
INSERT INTO public.organisation_members (organisation_id, profile_id, role)
VALUES (
  '00000000-0000-4000-b000-000000000001', 
  '0eea9074-18f3-4934-9e20-b2bfde1fef05',
  'lead'
)
ON CONFLICT (organisation_id, profile_id) DO NOTHING;

-- 5b. Link Test Author to the Organisation as Contributor
INSERT INTO public.organisation_members (organisation_id, profile_id, role)
VALUES (
  '00000000-0000-4000-b000-000000000001', 
  '11111111-1111-4111-b111-111111111111',
  'contributor'
)
ON CONFLICT (organisation_id, profile_id) DO NOTHING;

-- 6. Seed Campaigns (local workflow fixtures only; never ACOR evidence or real client results)
INSERT INTO public.campaigns (id, organisation_id, name, description, objective, target_audience, primary_cta, start_date, end_date, status, platforms, created_by, updated_by)
VALUES 
  (
    '00000000-0000-4000-c000-000000000001', 
    '00000000-0000-4000-b000-000000000001', 
    '[LOCAL FIXTURE] Summer Launch 2026',
    'SIMULATED LOCAL WORKFLOW FIXTURE. Not a real Villiz Pixels UK campaign, result or source of ACOR evidence.',
    'Exercise campaign, review and publishing workflows only; no real reach target or outcome.',
    'Synthetic test audience',
    'Fixture CTA',
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
    '[LOCAL FIXTURE] Q3 Brand Awareness',
    'SIMULATED LOCAL WORKFLOW FIXTURE. Not a real Villiz Pixels UK campaign, result or source of ACOR evidence.',
    'Exercise planning and content workflows only; no real awareness or community outcome.',
    'Synthetic test audience',
    'Fixture CTA',
    '2026-07-01', 
    '2026-09-30', 
    'planning', 
    ARRAY['x', 'youtube']::public.social_platform[], 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '0eea9074-18f3-4934-9e20-b2bfde1fef05'
  )
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name, description = EXCLUDED.description, objective = EXCLUDED.objective,
    target_audience = EXCLUDED.target_audience, primary_cta = EXCLUDED.primary_cta,
    status = EXCLUDED.status, platforms = EXCLUDED.platforms;

-- 7. Seed Content Drafts (local workflow fixtures; not brand truth, proof or performance evidence)
INSERT INTO public.content_drafts (
  id, organisation_id, title, content_type, summary, body, status, awo_status, version, 
  created_by, updated_by, campaign_id, due_at, reviewer_ids,
  assigned_reviewer_id, review_deadline,
  scheduled_at, scheduled_platform, scheduled_timezone
)
VALUES
  (
    '00000000-0000-4000-d000-000000000001', 
    '00000000-0000-4000-b000-000000000001', 
    '[LOCAL FIXTURE] LinkedIn Announcement',
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
    null, null,
    null, null, null
  ),
  (
    '00000000-0000-4000-d000-000000000002', 
    '00000000-0000-4000-b000-000000000001', 
    '[LOCAL FIXTURE] Q3 Launch Email Newsletter',
    'email', 
    'First newsletter drafts.', 
    'Hi team, here is what we are planning for Q3...', 
    'in_review', 
    'not_requested', 
    1, 
    '11111111-1111-4111-b111-111111111111', 
    '0eea9074-18f3-4934-9e20-b2bfde1fef05',
    '00000000-0000-4000-c000-000000000002', 
    now() + interval '5 days', 
    ARRAY['0eea9074-18f3-4934-9e20-b2bfde1fef05']::uuid[],
    '0eea9074-18f3-4934-9e20-b2bfde1fef05', now() + interval '3 days',
    null, null, null
  ),
  (
    '00000000-0000-4000-d000-000000000003', 
    '00000000-0000-4000-b000-000000000001', 
    '[LOCAL FIXTURE] Instagram Promo Post',
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
    null, null,
    now() + interval '1 day', 'instagram', 'UTC' -- Calendar Item 1
  ),
  (
    '00000000-0000-4000-d000-000000000004', 
    '00000000-0000-4000-b000-000000000001', 
    '[LOCAL FIXTURE] Twitter Launch Teaser',
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
    null, null,
    now() + interval '3 days', 'x', 'UTC' -- Calendar Item 2
  )
ON CONFLICT (id) DO UPDATE 
SET title = EXCLUDED.title, body = EXCLUDED.body, status = EXCLUDED.status, 
    assigned_reviewer_id = EXCLUDED.assigned_reviewer_id, review_deadline = EXCLUDED.review_deadline,
    scheduled_at = EXCLUDED.scheduled_at, scheduled_platform = EXCLUDED.scheduled_platform, scheduled_timezone = EXCLUDED.scheduled_timezone;

-- 8. Seed Reviews (At least 1 review)
INSERT INTO public.content_draft_reviews (id, draft_id, organisation_id, action, actor_id, previous_status, new_status, comment)
VALUES (
  '00000000-0000-4000-e000-000000000001', 
  '00000000-0000-4000-d000-000000000003', 
  '00000000-0000-4000-b000-000000000001', 
  'approved', 
  '0eea9074-18f3-4934-9e20-b2bfde1fef05', 
  'in_review', 
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
    '[LOCAL FIXTURE] LinkedIn Announcement',
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
    '[LOCAL FIXTURE] Instagram Promo Post',
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

-- ---------------------------------------------------------------------------
-- ACOR Client Zero — local-only, owner-approved grounding for Villiz Pixels UK
-- ---------------------------------------------------------------------------
-- This seed is not runtime branching. It uses the same organisation-scoped
-- MemBrain and Market Intelligence records available to every future client.

UPDATE public.organisations
SET name = 'Villiz Pixels UK', slug = 'villiz-pixels-uk', industry = 'Photography',
    primary_contact_name = 'Bode Villiz', primary_contact_email = 'villizpixels@gmail.com',
    notes = 'Sole trader. Home studio plus on-location. Coventry / West Midlands; UK-wide travel by arrangement.',
    updated_at = now()
WHERE id = '00000000-0000-4000-b000-000000000001';

INSERT INTO public.membrain_entries (id, organisation_id, category_id, title, summary, body, status, source, importance, created_by, updated_by)
SELECT values.id::uuid, '00000000-0000-4000-b000-000000000001'::uuid, category.id,
       values.title, values.summary, values.body, 'active'::public.membrain_status,
       'client_brief'::public.membrain_source, values.importance,
       '0eea9074-18f3-4934-9e20-b2bfde1fef05'::uuid, '0eea9074-18f3-4934-9e20-b2bfde1fef05'::uuid
FROM (VALUES
  ('a0000000-0000-4000-a000-000000000001','brand_description','Villiz Pixels UK brand truth','A Coventry-based photography and creative brand serving the West Midlands, with UK-wide commissions by arrangement.','Villiz Pixels UK is a Coventry-based photography and creative brand serving clients across the West Midlands, with UK-wide commissions available by arrangement. Operating from a home studio and on location, Villiz creates distinctive, creatively directed photography for individuals, families, milestones, celebrations and businesses, including portrait, event, personal-brand and creative or editorial photography. Photography is at the heart of the offering, supported by videography and wider creative services. The brand serves a broad UK market and brings cultural understanding to Nigerian and African celebrations where relevant, without defining itself around any single cultural audience. Brand proposition: Creatively directed portraits you''re proud to be seen in. Tagline: Where Every Frame Tells a Story.',5),
  ('a0000000-0000-4000-a000-000000000002','brand_voice','Villiz Pixels UK voice','Warm, confident, creative, human and direct; premium without pretension.','Villiz Pixels UK speaks in warm, confident and polished English that feels human, direct and creatively assured. The voice is premium without pretension and uses clear, specific language about the work, creative direction and finished outcomes. It may be culturally aware when the audience and occasion make that relevant, but LIGHT_NAIJA is contextual only and must never become the default voice or a stereotype.',5),
  ('a0000000-0000-4000-a000-000000000003','audience','Primary UK photography audiences','Individuals, families, celebrations, events and businesses seeking distinctive photography.','Villiz Pixels UK serves individuals seeking distinctive portraits; birthday and milestone clients; families; event clients; and professionals, founders and personal brands needing strong imagery. Its core geography is Coventry and the West Midlands, with UK-wide commissions available by arrangement. Nigerian and African cultural understanding is relevant for clients and celebrations that call for it, but geography and cultural identity must never be treated as the same thing.',4),
  ('a0000000-0000-4000-a000-000000000004','content_pillars','Creatively directed portraiture','Portrait outcomes, camera confidence and practical creative direction.','Show distinctive portrait outcomes and the creative choices behind them, including camera confidence, posing guidance, preparation and direction that help people look and feel considered in the frame.',4),
  ('a0000000-0000-4000-a000-000000000005','content_pillars','Milestones, families and celebrations','People, relationships and meaningful occasions photographed with creative care.','Show birthdays, milestones, families, events and celebrations through genuine finished work, preparation and occasion-aware storytelling. Cultural fluency may be expressed when it is relevant to the people and celebration shown.',4),
  ('a0000000-0000-4000-a000-000000000006','content_pillars','Creative and editorial craft','Creative photography, visual experimentation and the craft behind the finished frame.','Show creative and editorial photography alongside the craft that shapes the result, including lighting, composition, retouching, finishing and cleared behind-the-scenes or client-experience material.',4),
  ('a0000000-0000-4000-a000-000000000007','offering','Photography and creative services','Photography is the primary offering, supported by videography and wider creative capability.','Services include portrait, birthday and milestone, family, event, personal-brand and branding, and creative or editorial photography, together with videography and wider creative or AI-enabled capability. Work is available from a Coventry home studio and on location across the West Midlands, with UK-wide travel by arrangement. Pricing is by enquiry; no fixed price, availability or turnaround should be assumed.',5),
  ('a0000000-0000-4000-a000-000000000008','guidelines','Brand claims and publishing boundaries','Use only verified services, evidence and permissions; never invent claims or outcomes.','Never invent services, prices, availability, turnaround, awards, testimonials or commercial outcomes, and never guarantee reach, sales or bookings. Do not present an emerging creative approach as a proven proprietary process, or describe a service as more established than the approved evidence supports. Publish only work with the required consent, public-use and attribution clearance. Keep UK and Nigeria geography distinct; use LIGHT_NAIJA only in a supported context, express cultural fluency without stereotyping, and never copy competitors. AI-assisted production is not the ordinary photography customer proposition.',5)
) AS values(id, category_key, title, summary, body, importance)
JOIN public.membrain_categories category
  ON category.organisation_id = '00000000-0000-4000-b000-000000000001' AND category.key = values.category_key
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, body = EXCLUDED.body, category_id = EXCLUDED.category_id, status = EXCLUDED.status, importance = EXCLUDED.importance, updated_by = EXCLUDED.updated_by;

INSERT INTO public.market_intelligence_profiles (organisation_id, business_objectives, target_geographies, service_areas, audience_context, cultural_context, promotional_focus, cultural_voice_level, conversion_actions, platform_strategy, hashtag_strategy, created_by)
VALUES (
  '00000000-0000-4000-b000-000000000001',
  ARRAY['visibility','enquiries','bookings','authority']::text[],
  ARRAY['Coventry','West Midlands','United Kingdom']::text[],
  ARRAY['Coventry','West Midlands','UK-wide by arrangement']::text[],
  'Broad-market UK photography audiences seeking creatively directed portraits, birthday and milestone work, family photography, events, personal-brand imagery, or creative/editorial work. Do not infer cultural identity.',
  'Broad-market default. Nigerian and African cultural fluency is optional only for a specifically supported audience or brief.',
  'Increase qualified UK visibility that leads to photography enquiries and bookings. Photography is primary; videography and broader creative capabilities use separate secondary pathways.',
  'conversational', ARRAY['WhatsApp','website enquiry form','DM','phone']::text[],
  '{"instagram":"Coventry-first visual discovery using cleared portrait, milestone and craft evidence; primary UK account @villizpixelsuk.","facebook":"Support local entity and occasion discovery with cleared evidence.","tiktok":"Test supported direction, posing and craft content only after account and measurement setup.","linkedin":"Use personal-brand or creative authority only where proof supports it."}'::jsonb,
  '{"local":"Use verified Coventry and West Midlands terms; UK-wide only with by-arrangement wording.","service":"Prioritise portrait, birthday and milestone photography terms; do not overstate weak services.","audience_cultural":"Use cultural terms only for a specifically supported context.","occasion_topic":"Use verified birthday and milestone language naturally.","campaign":"Use only an active campaign identifier.","brand":"Use Villiz Pixels UK and owned identifiers where relevant."}'::jsonb,
  '0eea9074-18f3-4934-9e20-b2bfde1fef05'
)
ON CONFLICT (organisation_id) DO UPDATE SET business_objectives=EXCLUDED.business_objectives, target_geographies=EXCLUDED.target_geographies, service_areas=EXCLUDED.service_areas, audience_context=EXCLUDED.audience_context, cultural_context=EXCLUDED.cultural_context, promotional_focus=EXCLUDED.promotional_focus, cultural_voice_level=EXCLUDED.cultural_voice_level, conversion_actions=EXCLUDED.conversion_actions, platform_strategy=EXCLUDED.platform_strategy, hashtag_strategy=EXCLUDED.hashtag_strategy;

INSERT INTO public.market_intelligence_references (id, organisation_id, identifier, platform, market, vertical, relevance_note, is_active, reviewed_at, created_by)
VALUES
 ('b0000000-0000-4000-a000-000000000001','00000000-0000-4000-b000-000000000001','ACOR owner-confirmed intake','ACOR','United Kingdom','Photography','Human-approved source for durable brand truth and conversion configuration. The forensic report itself is not authoritative.',true,now(),'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('b0000000-0000-4000-a000-000000000002','00000000-0000-4000-b000-000000000001','@villizpixelsuk Day-0','instagram','United Kingdom','Photography','Owner-observed baseline: 3 followers, 1 following, 5 posts; unfinished bio, no location, link or configured conversion path. Reach, profile visits, enquiries and bookings are NOT_MEASURED.',true,now(),'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('b0000000-0000-4000-a000-000000000003','00000000-0000-4000-b000-000000000001','ACOR pending evidence gates','ACOR','United Kingdom','Photography','PENDING: per-image public-use consent and attribution, genuine testimonials, full BTS/process proof, personal-brand proof, videography proof, stronger event sequence, award provenance and TikTok Creator Search Insights.',true,now(),'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('b0000000-0000-4000-a000-000000000004','00000000-0000-4000-b000-000000000001','ACOR Day-0 baseline status matrix','ACOR','United Kingdom','Photography','Branded search ownership OWNER_ANALYTICS_REQUIRED; GBP NOT_CONFIGURED; website NOT_CONFIGURED; Instagram UK ACTUAL baseline in its own reference; TikTok UK, Facebook UK and LinkedIn UK NOT_CONFIGURED; posting consistency, reach, profile visits, enquiries, bookings, reviews and search visibility NOT_MEASURED; conversion path configured in Market Intelligence; MemBrain and Market Intelligence readiness are derived live.',true,now(),'0eea9074-18f3-4934-9e20-b2bfde1fef05')
ON CONFLICT (organisation_id, platform, identifier) DO UPDATE SET relevance_note=EXCLUDED.relevance_note, market=EXCLUDED.market, vertical=EXCLUDED.vertical, reviewed_at=EXCLUDED.reviewed_at;

INSERT INTO public.market_intelligence_patterns (id, organisation_id, observation, category, platform, market, vertical, provenance, confidence, reviewed_at, is_active, created_by)
VALUES
 ('c0000000-0000-4000-a000-000000000001','00000000-0000-4000-b000-000000000001','Use a Coventry-first entity and discovery strategy, with West Midlands secondary and UK-wide travel described only as by arrangement.','local_language',null,'United Kingdom','Photography','Owner-approved ACOR forensic synthesis; directional strategy, not measured performance.',80,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('c0000000-0000-4000-a000-000000000002','00000000-0000-4000-b000-000000000001','Treat birthday and milestone portraits as a discovery opportunity; the phrase birthday photoshoot coventry was observed in UK-localised autocomplete but has no verified search-volume claim.','discovery_language',null,'United Kingdom','Photography','Human-reviewed UK-localised autocomplete observation; volume NOT_MEASURED.',65,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('c0000000-0000-4000-a000-000000000003','00000000-0000-4000-b000-000000000001','Position creatively directed portrait outcomes as the central differentiation while avoiding claims of a proven proprietary end-to-end method until process and client-experience proof exists.','offer_positioning',null,'United Kingdom','Photography','Owner-approved positioning constrained by inspected proof depth.',85,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('c0000000-0000-4000-a000-000000000004','00000000-0000-4000-b000-000000000001','Generic phrases such as capturing memories, timeless images, stress-free, professional photography, and creative and exceptional are saturated territory and should not be treated as differentiation without specific proof.','emotional_angle',null,'United Kingdom','Photography','Approved forensic language audit; guidance, not a mechanical phrase ban.',70,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('c0000000-0000-4000-a000-000000000005','00000000-0000-4000-b000-000000000001','Thirty-day sequence: Week 1 establish canonical entity, conversion and baseline; Week 2 test occasion-led discovery and cleared proof; Week 3 demonstrate direction, posing, preparation, lighting and finish; Week 4 publish cleared proof and perform the first evidence-based analysis. Proof clearance begins in Week 1.','educational_angle',null,'United Kingdom','Photography','Owner-approved ACOR 30-day attack plan.',80,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
 ('c0000000-0000-4000-a000-000000000006','00000000-0000-4000-b000-000000000001','Google Business Profile strategy: Coventry base, West Midlands core market, UK-wide travel by arrangement, home-studio plus on-location model, appointment availability, enquiry-only pricing and WhatsApp CTA. Do not expose the home address without an owner decision and Google eligibility support.','local_language','google_business_profile','United Kingdom','Photography','Owner-approved blueprint; Google remains NOT_CONFIGURED and no external write is authorised.',80,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05')
 ,('c0000000-0000-4000-a000-000000000007','00000000-0000-4000-b000-000000000001','Inspected UK work adequately proves portrait and milestone outcomes; creative and editorial is the strongest current portfolio area. This does not prove a proprietary end-to-end directed client experience.','proof',null,'United Kingdom','Photography','Human-approved ACOR proof-pack assessment with explicit limitation.',80,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05')
 ,('c0000000-0000-4000-a000-000000000008','00000000-0000-4000-b000-000000000001','Attribute explicit enquiries and bookings to a supported source such as Google Business Profile, Instagram, TikTok, website, Facebook, or a specific campaign or content item. Never infer commercial outcomes from reach or engagement.','cta',null,'United Kingdom','Photography','Owner-approved ACOR conversion and measurement framework.',85,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05')
 ,('c0000000-0000-4000-a000-000000000009','00000000-0000-4000-b000-000000000001','CURRENT MARKET PROOF DEPTH — portrait photography: ADEQUATELY_PROVEN; creative/editorial photography: ADEQUATELY_PROVEN and the strongest currently demonstrated portfolio territory; birthday/milestone photography: ADEQUATELY_PROVEN with occasion provenance incomplete; family photography: ADEQUATELY_PROVEN with comparatively thin proof; event photography: UNDER_PROVEN; personal-brand/branding photography: CONFIRMED_UNPROVEN; videography: CONFIRMED_UNPROVEN. Proof depth guides recommendation confidence, emphasis and proof-development priorities; it does not decide whether an owner-confirmed service is sellable or prohibit that service. ADEQUATELY_PROVEN is not STRONGLY_PROVEN. Visual evidence does not establish consent, testimonials, customer experience, commercial outcomes, reach, enquiries, bookings or revenue.','proof',null,'United Kingdom','Photography','ACOR forensic review plus owner-confirmed service catalogue and direct inspection of the Villiz Pixels UK proof pack.',95,now(),true,'0eea9074-18f3-4934-9e20-b2bfde1fef05')
ON CONFLICT (id) DO UPDATE SET observation=EXCLUDED.observation, provenance=EXCLUDED.provenance, confidence=EXCLUDED.confidence, reviewed_at=EXCLUDED.reviewed_at, is_active=EXCLUDED.is_active;
