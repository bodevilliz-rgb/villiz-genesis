-- Suite: unauthenticated access. Nothing is reachable without a session.
--
-- `anon` holds no privileges on `public` at all, so these requests are refused
-- at the privilege layer and never reach RLS. That is the intended design: a
-- policy mistake should not be the only thing standing between the public
-- internet and client data.

begin;
  select test.act_as_anon();

  select test.throws('unauthenticated', 'anon cannot read organisations',
    $$select count(*) from public.organisations$$, '42501');

  select test.throws('unauthenticated', 'anon cannot read MemBrain entries',
    $$select count(*) from public.membrain_entries$$, '42501');

  select test.throws('unauthenticated', 'anon cannot read profiles',
    $$select count(*) from public.profiles$$, '42501');

  select test.throws('unauthenticated', 'anon cannot read version history',
    $$select count(*) from public.membrain_entry_versions$$, '42501');

  select test.throws('unauthenticated', 'anon cannot read limits',
    $$select count(*) from public.organisation_limits$$, '42501');

  select test.throws('unauthenticated', 'anon cannot call the retrieval RPC',
    $$select count(*) from public.membrain_context('00000000-0000-4000-b000-000000000001')$$);

  select test.throws('unauthenticated', 'anon cannot call the search RPC',
    $$select count(*) from public.membrain_search('00000000-0000-4000-b000-000000000001', 'tone')$$);

  select test.throws('unauthenticated', 'anon cannot create an organisation',
    $$insert into public.organisations (name, slug) values ('Anon Co', 'anon-co')$$);

  select test.throws('unauthenticated', 'anon cannot write knowledge',
    $$insert into public.membrain_entries (organisation_id, title, body, importance)
      values ('00000000-0000-4000-b000-000000000001', 'x', 'y', 3)$$);
commit;

-- An inactive staff member is, for access purposes, no different from anon.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000004');

  select test.eq('unauthenticated', 'INACTIVE STAFF: reads no organisations',
    (select count(*)::int from public.organisations), 0);

  select test.eq('unauthenticated', 'INACTIVE STAFF: reads no knowledge',
    (select count(*)::int from public.membrain_entries), 0);
commit;
