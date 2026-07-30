-- Suite: cross-organisation isolation.
--
-- This is the suite that matters. Villiz Pixels and Genesis Test Client exist
-- solely so that a leak between them would be caught here. If anything in this
-- file fails, nothing else in the test report is worth reading.

-- Give Genesis Test Client some knowledge of its own, owned by the other
-- strategist, so there is something real to try to steal.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000003');
  insert into public.membrain_entries (id, organisation_id, title, body, status, importance, created_by, updated_by)
  values ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000002',
          'Confidential pricing floor',
          'Never quote below 4,500 GBP per month. This is commercially sensitive.',
          'active', 5,
          '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000003');
commit;

-- Everything below runs as strategist A, who leads Villiz Pixels and has no
-- relationship whatsoever to Genesis Test Client.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  select test.eq('isolation', 'strategist A sees exactly one organisation',
    (select count(*)::int from public.organisations), 1);

  select test.eq('isolation', 'the organisation A sees is their own',
    (select name from public.organisations), 'Villiz Pixels');

  select test.eq('isolation', 'A cannot read the other organisation directly',
    (select count(*)::int from public.organisations
      where id = '00000000-0000-4000-b000-000000000002'), 0);

  -- Table-level reads.
  select test.eq('isolation', 'A sees only their own MemBrain entries',
    (select count(*)::int from public.membrain_entries), 1);

  select test.eq('isolation', 'A cannot read the other client''s pricing floor',
    (select count(*)::int from public.membrain_entries
      where organisation_id = '00000000-0000-4000-b000-000000000002'), 0);

  select test.eq('isolation', 'A cannot read the other client''s version history',
    (select count(*)::int from public.membrain_entry_versions
      where organisation_id = '00000000-0000-4000-b000-000000000002'), 0);

  select test.eq('isolation', 'A cannot read the other client''s categories',
    (select count(*)::int from public.membrain_categories
      where organisation_id = '00000000-0000-4000-b000-000000000002'), 0);

  select test.eq('isolation', 'A cannot read the other client''s team',
    (select count(*)::int from public.organisation_members
      where organisation_id = '00000000-0000-4000-b000-000000000002'), 0);

  select test.eq('isolation', 'A cannot read the other client''s limits',
    (select count(*)::int from public.organisation_limits
      where organisation_id = '00000000-0000-4000-b000-000000000002'), 0);

  -- RPCs called with a FORGED organisation id. This is the attack that would
  -- succeed if the retrieval functions were SECURITY DEFINER.
  select test.eq('isolation', 'FORGED ID: membrain_search on another org returns nothing',
    (select count(*)::int from public.membrain_search('00000000-0000-4000-b000-000000000002', 'pricing')), 0);

  select test.eq('isolation', 'FORGED ID: membrain_search with no query returns nothing',
    (select count(*)::int from public.membrain_search('00000000-0000-4000-b000-000000000002')), 0);

  select test.eq('isolation', 'FORGED ID: membrain_context on another org returns nothing',
    (select count(*)::int from public.membrain_context('00000000-0000-4000-b000-000000000002')), 0);

  select test.eq('isolation', 'FORGED ID: membrain_context cannot retrieve the pricing floor',
    (select count(*)::int from public.membrain_context('00000000-0000-4000-b000-000000000002', 'pricing')), 0);

  -- Writes.
  select test.throws('isolation', 'A cannot write knowledge into another organisation',
    $$insert into public.membrain_entries (organisation_id, title, body, importance)
      values ('00000000-0000-4000-b000-000000000002', 'Injected', 'Should never land', 5)$$);

  select test.throws('isolation', 'A cannot add themselves to another organisation',
    $$insert into public.organisation_members (organisation_id, profile_id, role)
      values ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'lead')$$);

  -- An UPDATE that matches no visible row is not an error; it affects nothing.
  update public.organisations set name = 'Hijacked'
   where id = '00000000-0000-4000-b000-000000000002';

  select test.eq('isolation', 'A cannot rename another organisation',
    (select count(*)::int from public.organisations where name = 'Hijacked'), 0);

  update public.membrain_entries set body = 'tampered'
   where organisation_id = '00000000-0000-4000-b000-000000000002';

  select test.eq('isolation', 'A cannot overwrite another org''s knowledge',
    (select count(*)::int from public.membrain_entries where body = 'tampered'), 0);

  -- Invalid / non-existent identifiers must be inert, not error.
  select test.eq('isolation', 'INVALID ID: unknown org returns no search results',
    (select count(*)::int from public.membrain_search('99999999-9999-4999-9999-999999999999', 'anything')), 0);

  select test.eq('isolation', 'INVALID ID: unknown org returns no context',
    (select count(*)::int from public.membrain_context('99999999-9999-4999-9999-999999999999')), 0);

  select test.eq('isolation', 'INVALID ID: unknown org returns no rows from tables',
    (select count(*)::int from public.membrain_entries
      where organisation_id = '99999999-9999-4999-9999-999999999999'), 0);
commit;

-- Confirm from the other side that the data genuinely exists and is readable by
-- its owner. Without this, every assertion above could pass on an empty table.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000003');

  select test.eq('isolation', 'CONTROL: strategist B can read their own pricing floor',
    (select count(*)::int from public.membrain_entries
      where organisation_id = '00000000-0000-4000-b000-000000000002'), 1);

  select test.eq('isolation', 'CONTROL: B''s own context retrieval works',
    (select count(*)::int from public.membrain_context('00000000-0000-4000-b000-000000000002')), 1);

  select test.eq('isolation', 'CONTROL: B cannot see Villiz Pixels either',
    (select count(*)::int from public.membrain_entries
      where organisation_id = '00000000-0000-4000-b000-000000000001'), 0);
commit;
