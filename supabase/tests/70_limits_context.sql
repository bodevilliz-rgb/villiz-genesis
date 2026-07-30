-- Suite: guardrail enforcement and context assembly.

-- Enforcement must be a database rule, not a rendered number.
update public.organisation_limits set max_membrain_entries = 2
 where organisation_id = '00000000-0000-4000-b000-000000000001';

begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  insert into public.membrain_entries (organisation_id, title, body, importance, created_by, updated_by)
  values ('00000000-0000-4000-b000-000000000001', 'Audience', 'Independent studios in London.', 3,
          '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002');

  -- Now at the limit of 2. The next insert must be rejected by trigger, with the
  -- P0001 the error translator maps to LimitExceededError (HTTP 429).
  select test.throws('limits', 'MemBrain entry limit is enforced in the database',
    $$insert into public.membrain_entries (organisation_id, title, body, importance)
      values ('00000000-0000-4000-b000-000000000001', 'Third', 'Over the limit', 3)$$,
    'P0001');
commit;

update public.organisation_limits set max_membrain_entries = 2000
 where organisation_id = '00000000-0000-4000-b000-000000000001';

-- Usage must be measured, never estimated.
select test.eq('limits', 'usage snapshot counts real MemBrain entries',
  (select membrain_entries_used::int from public.organisation_usage_snapshot
    where organisation_id = '00000000-0000-4000-b000-000000000001'), 2);

select test.eq('limits', 'usage snapshot reports a true zero for unused resources',
  (select social_accounts_used::int from public.organisation_usage_snapshot
    where organisation_id = '00000000-0000-4000-b000-000000000001'), 0);

-- Context ranking: importance 4+ is unconditional.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  insert into public.membrain_entries (id, organisation_id, title, body, status, importance, created_by, updated_by)
  values ('00000000-0000-4000-c000-000000000010', '00000000-0000-4000-b000-000000000001',
          'Legal restriction', 'Never claim guaranteed results. Regulated sector.', 'active', 5,
          '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002'),
         ('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000001',
          'Office move', 'Studio relocated to Hackney in March.', 'active', 1,
          '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002'),
         ('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000001',
          'Archived note', 'Superseded guidance nobody should use.', 'archived', 5,
          '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002');

  -- The query is about a spring campaign. The legal restriction has nothing to
  -- do with it and must be returned anyway.
  select test.ok('context', 'importance 5 is returned for an unrelated query',
    (select count(*) > 0 from public.membrain_context('00000000-0000-4000-b000-000000000001', 'spring campaign')
      where id = '00000000-0000-4000-c000-000000000010'));

  select test.eq('context', 'archived knowledge is never sent to AI',
    (select count(*)::int from public.membrain_context('00000000-0000-4000-b000-000000000001', 'superseded guidance')
      where id = '00000000-0000-4000-c000-000000000012'), 0);

  select test.ok('context', 'limit parameter caps the number of entries returned',
    (select count(*) <= 2 from public.membrain_context('00000000-0000-4000-b000-000000000001', null, 2)));

  select test.eq('context', 'retrieval counter starts at zero',
    (select retrieval_count from public.membrain_entries
      where id = '00000000-0000-4000-c000-000000000010'), 0);
commit;

begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');
  select public.membrain_mark_retrieved(array['00000000-0000-4000-c000-000000000010'::uuid]);
  select test.eq('context', 'mark_retrieved increments the counter',
    (select retrieval_count from public.membrain_entries
      where id = '00000000-0000-4000-c000-000000000010'), 1);

  select test.ok('context', 'mark_retrieved stamps last_retrieved_at',
    (select last_retrieved_at is not null from public.membrain_entries
      where id = '00000000-0000-4000-c000-000000000010'));
commit;

-- Platform admins see the whole portfolio; that is the point of the role.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000001');
  select test.eq('limits', 'platform owner sees every organisation',
    (select count(*)::int from public.organisations), 2);
commit;
