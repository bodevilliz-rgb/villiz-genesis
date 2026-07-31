-- Project Genesis Local Seed Data

-- Set allowed_email_domains to include gmail.com so Bodevilliz@gmail.com is allowed.
update public.platform_settings set allowed_email_domains = array['villiz.com', 'gmail.com'];

-- Insert Bodevilliz@gmail.com into auth.users (ID from setup-user.js is 0eea9074-18f3-4934-9e20-b2bfde1fef05)
insert into auth.users (id, email)
values ('0eea9074-18f3-4934-9e20-b2bfde1fef05', 'Bodevilliz@gmail.com')
on conflict (id) do nothing;

-- Ensure profile is active and role is set to owner
insert into public.profiles (id, email, full_name, role, is_active)
values ('0eea9074-18f3-4934-9e20-b2bfde1fef05', 'bodevilliz@gmail.com', 'Bode Villiz', 'owner', true)
on conflict (id) do update
set is_active = true, role = 'owner';

-- Insert organisations (ID: 00000000-0000-4000-b000-000000000001, name: Villiz Pixels)
insert into public.organisations (id, name, slug, status, created_by)
values ('00000000-0000-4000-b000-000000000001', 'Villiz Pixels', 'villiz-pixels', 'active', '0eea9074-18f3-4934-9e20-b2bfde1fef05')
on conflict (id) do nothing;

-- Insert organisation membership (role must be lead)
insert into public.organisation_members (organisation_id, profile_id, role)
values ('00000000-0000-4000-b000-000000000001', '0eea9074-18f3-4934-9e20-b2bfde1fef05', 'lead')
on conflict (organisation_id, profile_id) do nothing;

-- Seeding Campaigns
insert into public.campaigns (id, organisation_id, name, description, objective, target_audience, primary_cta, start_date, end_date, status, platforms, created_by)
values 
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', 'Summer Launch 2026', 'Marketing campaign for summer launch.', 'Objective to reach 10k users.', 'Young adults', 'Sign up today', '2026-06-01', '2026-08-31', 'active', array['instagram', 'linkedin']::public.social_platform[], '0eea9074-18f3-4934-9e20-b2bfde1fef05'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000001', 'Q3 Brand Awareness', 'Brand awareness campaign.', 'Build community', 'Developers', 'Learn more', '2026-07-01', '2026-09-30', 'planning', array['x', 'youtube']::public.social_platform[], '0eea9074-18f3-4934-9e20-b2bfde1fef05')
on conflict (id) do nothing;

-- Seeding Content Drafts
insert into public.content_drafts (id, organisation_id, title, content_type, summary, body, status, awo_status, version, created_by, campaign_id, due_at, reviewer_ids)
values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-b000-000000000001', 'LinkedIn Announcement', 'social_post', 'Short announcement for LinkedIn.', 'We are thrilled to announce our new brand direction!', 'draft', 'not_requested', 1, '0eea9074-18f3-4934-9e20-b2bfde1fef05', '00000000-0000-4000-c000-000000000001', now() + interval '2 days', '{}'),
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-b000-000000000001', 'Q3 Launch Email Newsletter', 'email', 'First newsletter drafts.', 'Hi team, here is what we are planning for Q3...', 'needs_review', 'not_requested', 1, '0eea9074-18f3-4934-9e20-b2bfde1fef05', '00000000-0000-4000-c000-000000000002', now() + interval '5 days', array['0eea9074-18f3-4934-9e20-b2bfde1fef05']::uuid[]),
  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-b000-000000000001', 'Instagram Promo Post', 'social_post', 'Approved post for Instagram.', 'Check out our new look!', 'approved', 'not_requested', 1, '0eea9074-18f3-4934-9e20-b2bfde1fef05', '00000000-0000-4000-c000-000000000001', now() - interval '1 day', '{}')
on conflict (id) do nothing;

-- Seeding Reviews
insert into public.content_draft_reviews (id, draft_id, organisation_id, action, actor_id, previous_status, new_status, comment)
values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-d000-000000000003', '00000000-0000-4000-b000-000000000001', 'approved', '0eea9074-18f3-4934-9e20-b2bfde1fef05', 'needs_review', 'approved', 'Looks wonderful! Approved.')
on conflict (id) do nothing;
