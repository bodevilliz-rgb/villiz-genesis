-- Suite: approval version concurrency.
-- Exercises the production RPC against a real second PostgreSQL session. The
-- application assesses version 1, the second session commits a material edit,
-- and the stale transition must neither approve version 2 nor append history.

create extension if not exists dblink with schema extensions;

insert into public.content_drafts (
  id, organisation_id, title, body, status, created_by, updated_by
) values (
  '00000000-0000-4000-d000-000000000080',
  '00000000-0000-4000-b000-000000000001',
  'Concurrency regression draft',
  'Assessed caption',
  'needs_review',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000003'
);

select test.eq(
  'review-version-concurrency',
  'control: action assessment reads draft version 1',
  (select version from public.content_drafts where id = '00000000-0000-4000-d000-000000000080'),
  1
);

-- A distinct database connection represents the edit committed after the
-- server action's recommendation assessment and before its review transition.
select extensions.dblink_exec(
  format('dbname=%I', current_database()),
  $$update public.content_drafts
      set body = 'Caption edited in another transaction'
    where id = '00000000-0000-4000-d000-000000000080'$$
);

select test.eq(
  'review-version-concurrency',
  'intervening transaction advances the current draft version',
  (select version from public.content_drafts where id = '00000000-0000-4000-d000-000000000080'),
  2
);

begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  select test.throws(
    'review-version-concurrency',
    'stale assessed version cannot approve the edited draft',
    $$select public.perform_content_draft_review(
      '00000000-0000-4000-d000-000000000080',
      'approved',
      'approved',
      null,
      'Approved from stale assessment',
      1
    )$$,
    '40001'
  );

  select test.eq(
    'review-version-concurrency',
    'the newer draft remains unapproved after the stale transition',
    (select status::text from public.content_drafts where id = '00000000-0000-4000-d000-000000000080'),
    'needs_review'
  );

  select test.eq(
    'review-version-concurrency',
    'the rejected stale transition appends no review history',
    (select count(*)::int from public.content_draft_reviews where draft_id = '00000000-0000-4000-d000-000000000080'),
    0
  );
commit;

-- Expand-contract compatibility: an old application instance may still issue
-- the exact five-argument call after the migration has added the canonical
-- expected-version form. Both signatures must remain independently resolvable.
insert into public.content_drafts (
  id, organisation_id, title, body, status, created_by, updated_by
) values
  ('00000000-0000-4000-d000-000000000081', '00000000-0000-4000-b000-000000000001',
   'Legacy RPC draft', 'Legacy body', 'needs_review',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-d000-000000000082', '00000000-0000-4000-b000-000000000001',
   'Expanded RPC draft', 'Expanded body', 'needs_review',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-d000-000000000083', '00000000-0000-4000-b000-000000000001',
   'Mixed deploy draft', 'Mixed body', 'needs_review',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002');

select test.eq(
  'review-version-concurrency',
  'expanded RPC exposes exactly the five- and six-argument signatures',
  (select count(*)::int
     from pg_proc as proc
     join pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'perform_content_draft_review'),
  2
);

select test.ok(
  'review-version-concurrency',
  'both overloads preserve invoker security caller search path grants and no defaults',
  (select bool_and(
     not proc.prosecdef
     and proc.proconfig is null
     and proc.pronargdefaults = 0
     and has_function_privilege('authenticated', proc.oid, 'execute')
     and has_function_privilege('service_role', proc.oid, 'execute')
   )
   and count(distinct proc.proacl::text) = 1
   from pg_proc as proc
   join pg_namespace as namespace on namespace.oid = proc.pronamespace
   where namespace.nspname = 'public'
     and proc.proname = 'perform_content_draft_review')
);

begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  select public.perform_content_draft_review(
    '00000000-0000-4000-d000-000000000081', 'approved', 'approved', null, 'Legacy deployment'
  );
  select test.eq(
    'review-version-concurrency',
    'five-argument legacy call remains available after schema expansion',
    (select status::text from public.content_drafts where id = '00000000-0000-4000-d000-000000000081'),
    'approved'
  );

  select public.perform_content_draft_review(
    '00000000-0000-4000-d000-000000000082', 'approved', 'approved', null, 'Expanded deployment', 1
  );
  select test.eq(
    'review-version-concurrency',
    'six-argument call enforces and records the expected draft version',
    (select status::text from public.content_drafts where id = '00000000-0000-4000-d000-000000000082'),
    'approved'
  );

  select public.perform_content_draft_review(
    '00000000-0000-4000-d000-000000000083', 'approved', 'approved', null, 'Expanded instance', 1
  );
  select public.perform_content_draft_review(
    '00000000-0000-4000-d000-000000000083', 'reopened', 'needs_review', null, 'Rolled-back instance'
  );
  select test.eq(
    'review-version-concurrency',
    'five-argument rollback remains usable after a six-argument transition',
    (select status::text from public.content_drafts where id = '00000000-0000-4000-d000-000000000083'),
    'needs_review'
  );
  select test.eq(
    'review-version-concurrency',
    'mixed expanded-schema calls preserve one audit row per transition',
    (select count(*)::int from public.content_draft_reviews where draft_id = '00000000-0000-4000-d000-000000000083'),
    2
  );
commit;

begin;
  select test.act_as('00000000-0000-4000-a000-000000000004');
  select test.throws(
    'review-version-concurrency',
    'unauthorised caller is rejected by the five-argument invoker path',
    $$select public.perform_content_draft_review(
      '00000000-0000-4000-d000-000000000081', 'approved', 'approved', null, 'Unauthorised legacy'
    )$$,
    'P0002'
  );
  select test.throws(
    'review-version-concurrency',
    'unauthorised caller is rejected by the six-argument invoker path',
    $$select public.perform_content_draft_review(
      '00000000-0000-4000-d000-000000000082', 'approved', 'approved', null, 'Unauthorised expanded', 1
    )$$,
    'P0002'
  );
commit;

begin;
  select test.act_as_anon();
  select test.throws(
    'review-version-concurrency',
    'anonymous caller is rejected by the five-argument privilege boundary',
    $$select public.perform_content_draft_review(
      '00000000-0000-4000-d000-000000000081', 'approved', 'approved', null, 'Anonymous legacy'
    )$$,
    '42501'
  );
  select test.throws(
    'review-version-concurrency',
    'anonymous caller is rejected by the six-argument privilege boundary',
    $$select public.perform_content_draft_review(
      '00000000-0000-4000-d000-000000000082', 'approved', 'approved', null, 'Anonymous expanded', 1
    )$$,
    '42501'
  );
commit;
