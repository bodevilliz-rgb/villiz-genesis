-- Suite: identity, activation and domain policy.

select test.eq('identity', 'profile created by trigger for every auth user',
  (select count(*)::int from public.profiles), 4);

select test.eq('identity', 'first user becomes platform owner',
  (select role::text from public.profiles where email = 'founder@villiz.com'), 'owner');

select test.ok('identity', 'first user is active',
  (select is_active from public.profiles where email = 'founder@villiz.com'));

select test.eq('identity', 'subsequent staff default to member',
  (select role::text from public.profiles where email = 'strategist.a@villiz.com'), 'member');

select test.ok('identity', 'allowlisted domain is activated',
  (select is_active from public.profiles where email = 'strategist.a@villiz.com'));

-- The important one. A non-Villiz address may obtain an auth row (invited by
-- mistake, or via a provider) but must never become active staff.
select test.ok('identity', 'REJECTED DOMAIN: gmail.com user is created inactive',
  (select is_active = false from public.profiles where email = 'outsider@gmail.com'));

-- Self-escalation, attempted as the user themselves.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');
  select test.throws('identity', 'staff cannot promote themselves to admin',
    $$update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-000000000002'$$);
  -- RLS filters this rather than rejecting it: the row is simply not visible to
  -- update, so the statement affects nothing. Assert the outcome, because "no
  -- error was raised" would be a dangerously weak thing to assert here.
  update public.profiles set is_active = true
   where id = '00000000-0000-4000-a000-000000000004';
commit;

select test.ok('identity', 'a member cannot activate another user',
  (select is_active = false from public.profiles where email = 'outsider@gmail.com'));

begin;
commit;
