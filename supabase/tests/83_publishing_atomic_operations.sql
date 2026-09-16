-- Supported publishing-operation contracts. Never run on production.

insert into public.blotato_accounts (
  blotato_account_id, platform, organisation_id, active, provider_active
) values (
  'villiz-instagram',
  'instagram',
  '00000000-0000-4000-b000-000000000001',
  true,
  true
)
on conflict (blotato_account_id) do update
set platform = excluded.platform,
    organisation_id = excluded.organisation_id,
    active = true,
    provider_active = true;

insert into public.content_drafts (
  id, organisation_id, title, body, status, created_by, updated_by
) values (
  '00000000-0000-4000-d000-000000000090',
  '00000000-0000-4000-b000-000000000001',
  'Atomic immediate publishing',
  'Approved atomic publishing fixture',
  'approved',
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000002'
);

begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');

  select current_user as atomic_test_role,
         auth.uid() as atomic_test_uid,
         app.is_org_member('00000000-0000-4000-b000-000000000001') as atomic_test_is_member;
  select blotato_account_id, organisation_id, platform, active, provider_active
  from public.blotato_accounts
  where blotato_account_id = 'villiz-instagram';

  select public.enqueue_immediate_publishing_job(
    '00000000-0000-4000-b000-000000000001',
    '00000000-0000-4000-d000-000000000090',
    1,
    'instagram',
    'atomic-immediate-1',
    '00000000-0000-4000-a000-000000000002',
    3,
    null,
    'villiz-instagram',
    'live',
    true,
    true,
    false
  );

  select test.ok(
    'publishing-atomic-operations',
    'immediate RPC creates one job advances the draft and records one audit event',
    (select count(*) = 1 from public.publishing_jobs where idempotency_key = 'atomic-immediate-1')
    and (select status = 'publishing' from public.content_drafts where id = '00000000-0000-4000-d000-000000000090')
    and (select count(*) = 1 from public.audit_events
      where draft_id = '00000000-0000-4000-d000-000000000090'
        and event_type = 'publishing_job_queued')
  );

  select public.enqueue_immediate_publishing_job(
    '00000000-0000-4000-b000-000000000001',
    '00000000-0000-4000-d000-000000000090',
    1,
    'instagram',
    'atomic-immediate-1',
    '00000000-0000-4000-a000-000000000002',
    3,
    null,
    'villiz-instagram',
    'live',
    true,
    true,
    false
  );

  select test.ok(
    'publishing-atomic-operations',
    'exact replay creates neither a second job nor a second audit event',
    (select count(*) = 1 from public.publishing_jobs where draft_id = '00000000-0000-4000-d000-000000000090')
    and (select count(*) = 1 from public.audit_events
      where draft_id = '00000000-0000-4000-d000-000000000090'
        and event_type = 'publishing_job_queued')
  );

  update public.publishing_jobs
  set status = 'awaiting_confirmation'
  where idempotency_key = 'atomic-immediate-1';

  select public.enqueue_immediate_publishing_job(
    '00000000-0000-4000-b000-000000000001',
    '00000000-0000-4000-d000-000000000090',
    1,
    'instagram',
    'atomic-immediate-2',
    '00000000-0000-4000-a000-000000000002',
    3,
    null,
    'villiz-instagram',
    'live',
    true,
    true,
    false
  );

  select test.ok(
    'publishing-atomic-operations',
    'awaiting-confirmation publication blocks a second job and audit event',
    (select count(*) = 1 from public.publishing_jobs where draft_id = '00000000-0000-4000-d000-000000000090')
    and not exists(select 1 from public.publishing_jobs where idempotency_key = 'atomic-immediate-2')
    and (select count(*) = 1 from public.audit_events
      where draft_id = '00000000-0000-4000-d000-000000000090'
        and event_type = 'publishing_job_queued')
  );
commit;

begin;
  select test.act_as_anon();
  select test.throws(
    'publishing-atomic-operations',
    'anonymous caller cannot enqueue an immediate publishing job',
    $$select public.enqueue_immediate_publishing_job(
      '00000000-0000-4000-b000-000000000001',
      '00000000-0000-4000-d000-000000000090',
      1,
      'instagram', 'anon-atomic',
      '00000000-0000-4000-a000-000000000002',
      3, null, 'villiz-instagram', 'live', true, true, false
    )$$,
    '42501'
  );
commit;

update public.publishing_worker_generations set status = 'retired' where status = 'active';
insert into public.publishing_worker_generations (
  generation_id, live_publishing_capable, capability_proof_sha256, status, valid_until
) values (
  'atomic-generation-previous',
  true,
  encode(extensions.digest('previous-proof', 'sha256'), 'hex'),
  'active',
  now() + interval '1 hour'
);

begin;
  select test.act_as('00000000-0000-4000-a000-000000000002');
  select test.throws(
    'publishing-atomic-operations',
    'authenticated application caller cannot rotate worker authority',
    $$select public.rotate_publishing_worker_generation(
      'atomic-generation-previous',
      'atomic-generation-new',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      now() + interval '30 days'
    )$$,
    '42501'
  );
commit;

begin;
  set local role service_role;
  select public.rotate_publishing_worker_generation(
    'atomic-generation-previous',
    'atomic-generation-new',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    now() + interval '30 days'
  );
  select test.ok(
    'publishing-atomic-operations',
    'service role rotation retires the exact predecessor and activates one bounded generation',
    (select status = 'retired' from public.publishing_worker_generations where generation_id = 'atomic-generation-previous')
    and (select status = 'active' and live_publishing_capable
      and valid_until > now() + interval '29 days'
      from public.publishing_worker_generations where generation_id = 'atomic-generation-new')
    and (select count(*) = 1 from public.publishing_worker_generations where status = 'active')
  );

  select public.rollback_publishing_worker_generation(
    'atomic-generation-new',
    'atomic-generation-previous'
  );
  select test.ok(
    'publishing-atomic-operations',
    'generation rollback retires the failed generation and restores its exact predecessor',
    (select status = 'retired' from public.publishing_worker_generations where generation_id = 'atomic-generation-new')
    and (select status = 'active' from public.publishing_worker_generations where generation_id = 'atomic-generation-previous')
  );
commit;
