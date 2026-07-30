-- Suite: organisation lifecycle, provisioning and edit permissions.

select test.eq('organisations', 'creator auto-assigned as lead',
  (select role::text from public.organisation_members
    where organisation_id = '00000000-0000-4000-b000-000000000001'
      and profile_id = '00000000-0000-4000-a000-000000000002'), 'lead');

select test.eq('organisations', 'limits row provisioned on creation',
  (select count(*)::int from public.organisation_limits), 2);

select test.eq('organisations', 'default MemBrain entry limit is 2000',
  (select max_membrain_entries from public.organisation_limits
    where organisation_id = '00000000-0000-4000-b000-000000000001'), 2000);

select test.eq('organisations', 'seven system categories seeded per organisation',
  (select count(*)::int from public.membrain_categories
    where organisation_id = '00000000-0000-4000-b000-000000000001'), 7);

select test.eq('organisations', 'categories seeded independently per organisation',
  (select count(*)::int from public.membrain_categories), 14);

select test.ok('organisations', 'onboarded_at stamped when status is active',
  (select onboarded_at is not null from public.organisations
    where id = '00000000-0000-4000-b000-000000000001'));

-- Editing, as the lead of that account.
begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  update public.organisations set industry = 'Creative production'
   where id = '00000000-0000-4000-b000-000000000001';

  select test.eq('organisations', 'lead can edit their own organisation',
    (select industry from public.organisations
      where id = '00000000-0000-4000-b000-000000000001'), 'Creative production');

  select test.eq('organisations', 'slug is unchanged by an unrelated edit',
    (select slug from public.organisations
      where id = '00000000-0000-4000-b000-000000000001'), 'villiz-pixels');
commit;

-- Slug uniqueness is a database guarantee, not an application convention.
select test.throws('organisations', 'duplicate slug is rejected',
  $$insert into public.organisations (name, slug, status) values ('Copy', 'villiz-pixels', 'active')$$,
  '23505');

select test.throws('organisations', 'invalid brand colour is rejected',
  $$insert into public.organisations (name, slug, brand_colour) values ('Bad', 'bad-colour', 'orange')$$,
  '23514');
