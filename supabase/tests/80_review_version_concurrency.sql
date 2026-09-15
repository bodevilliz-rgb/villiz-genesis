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
