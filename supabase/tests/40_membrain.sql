-- Suite: MemBrain creation, retrieval, updating and version history.

begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  insert into public.membrain_entries (id, organisation_id, title, summary, body, status, importance, created_by, updated_by)
  values ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001',
          'Tone of voice', 'How Villiz Pixels sounds',
          'Warm, direct, never corporate. Short sentences. Never use exclamation marks.',
          'active', 5,
          '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002');

  select test.eq('membrain', 'new entry starts at version 1',
    (select version from public.membrain_entries where id = '00000000-0000-4000-c000-000000000001'), 1);

  select test.eq('membrain', 'v1 written to history on insert',
    (select count(*)::int from public.membrain_entry_versions
      where entry_id = '00000000-0000-4000-c000-000000000001'), 1);

  select test.ok('membrain', 'search_vector generated on insert',
    (select search_vector is not null from public.membrain_entries
      where id = '00000000-0000-4000-c000-000000000001'));

  -- Update → version must advance by trigger, not by application code.
  update public.membrain_entries
     set body = 'Warm, direct, never corporate. Short sentences. Exclamation marks are banned.'
   where id = '00000000-0000-4000-c000-000000000001';

  select test.eq('membrain', 'update advances version to 2',
    (select version from public.membrain_entries where id = '00000000-0000-4000-c000-000000000001'), 2);

  select test.eq('membrain', 'history now holds two versions',
    (select count(*)::int from public.membrain_entry_versions
      where entry_id = '00000000-0000-4000-c000-000000000001'), 2);

  select test.ok('membrain', 'v1 body preserved verbatim in history',
    (select body like '%Never use exclamation marks.%' from public.membrain_entry_versions
      where entry_id = '00000000-0000-4000-c000-000000000001' and version = 1));

  -- v1 is sealed at birth: its reason is that the entry was created, and there
  -- is nothing a later editor could truthfully add.
  select test.eq('membrain', 'v1 is auto-sealed with its own reason',
    (select change_summary from public.membrain_entry_versions
      where entry_id = '00000000-0000-4000-c000-000000000001' and version = 1), 'Entry created');

  select test.throws('membrain', 'a sealed version rejects any further edit',
    $$update public.membrain_entry_versions set change_summary = 'Rewriting the past'
       where entry_id = '00000000-0000-4000-c000-000000000001' and version = 1$$, '42501');

  -- v2 has no reason yet, because the editor supplies it after the write. One
  -- annotation is permitted; the version then seals like every other.
  update public.membrain_entry_versions set change_summary = 'Clarified the exclamation-mark rule'
   where entry_id = '00000000-0000-4000-c000-000000000001' and version = 2;

  select test.eq('membrain', 'a change reason can be attached once',
    (select change_summary from public.membrain_entry_versions
      where entry_id = '00000000-0000-4000-c000-000000000001' and version = 2),
    'Clarified the exclamation-mark rule');

  select test.throws('membrain', 'a change reason cannot be rewritten',
    $$update public.membrain_entry_versions set change_summary = 'Different story'
       where entry_id = '00000000-0000-4000-c000-000000000001' and version = 2$$, '42501');

  select test.throws('membrain', 'history body is immutable',
    $$update public.membrain_entry_versions set body = 'tampered'
       where entry_id = '00000000-0000-4000-c000-000000000001' and version = 2$$, '42501');

  select test.throws('membrain', 'history cannot be deleted',
    $$delete from public.membrain_entry_versions
       where entry_id = '00000000-0000-4000-c000-000000000001' and version = 1$$);

  -- Retrieval.
  select test.ok('membrain', 'full-text search finds the entry',
    (select count(*) > 0 from public.membrain_search('00000000-0000-4000-b000-000000000001', 'exclamation marks')));

  select test.ok('membrain', 'trigram search tolerates a typo in the title',
    (select count(*) > 0 from public.membrain_search('00000000-0000-4000-b000-000000000001', 'tone of voise')));

  select test.ok('membrain', 'search returns a total_count for pagination',
    (select total_count >= 1 from public.membrain_search('00000000-0000-4000-b000-000000000001', 'exclamation') limit 1));
commit;
