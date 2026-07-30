-- Test fixtures.
--
-- Runs as the table owner, so RLS does not apply here — this is setup, not a
-- test. Every assertion afterwards runs as `authenticated` with a real subject
-- claim, which is where RLS starts mattering.

-- Users are created in auth.users only. Profiles must appear by trigger; if
-- they do not, that is itself a failure the identity suite will catch.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'founder@villiz.com'),
  ('00000000-0000-4000-a000-000000000002', 'strategist.a@villiz.com'),
  ('00000000-0000-4000-a000-000000000003', 'strategist.b@villiz.com'),
  ('00000000-0000-4000-a000-000000000004', 'outsider@gmail.com');

-- The two organisations named in the Sprint 1 brief. They exist for one
-- purpose: proving knowledge cannot cross between them.
insert into public.organisations (id, name, slug, status, created_by) values
  ('00000000-0000-4000-b000-000000000001', 'Villiz Pixels', 'villiz-pixels', 'active',
   '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-b000-000000000002', 'Genesis Test Client', 'genesis-test-client', 'active',
   '00000000-0000-4000-a000-000000000003');

-- Each strategist leads exactly one account and has no relationship to the other.
-- The creator trigger should already have done this; assert rather than assume.
