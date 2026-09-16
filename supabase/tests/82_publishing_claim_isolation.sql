-- Local-only claim/generation/settlement isolation proof. Never run on production.
do $$
declare
  org uuid := '00000000-0000-4000-b000-000000000001';
  draft_sim uuid; draft_live uuid; draft_mock uuid;
  job_sim uuid; job_live uuid; job_mock uuid;
  attempt_sim uuid; attempt_sim_mismatch uuid; attempt_live uuid; attempt_mismatched uuid; attempt_mock uuid; attempt_mock_new uuid; attempt_mock_current uuid;
  claimed uuid; before_mock jsonb; n integer;
begin
  insert into public.publishing_worker_generations(
    generation_id, live_publishing_capable, capability_proof_sha256, status, valid_until
  ) values (
    'generation-current', true, encode(extensions.digest('current-proof', 'sha256'), 'hex'), 'active', now() + interval '1 hour'
  );
  insert into public.publishing_worker_generations(
    generation_id, live_publishing_capable, capability_proof_sha256, status, valid_until
  ) values (
    'generation-draining', true, encode(extensions.digest('old-proof', 'sha256'), 'hex'), 'draining', now() + interval '1 hour'
  );
  insert into public.publishing_worker_generations(
    generation_id, live_publishing_capable, capability_proof_sha256, status, valid_from, valid_until
  ) values (
    'generation-expired', true, encode(extensions.digest('expired-proof', 'sha256'), 'hex'), 'retired',
    now() - interval '2 hours', now() - interval '1 hour'
  );

  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Simulation isolation', 'publishing') returning id into draft_sim;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, execution_mode)
    values(org, draft_sim, 'facebook', 'immediate', 'claim-iso-simulation', 'simulation') returning id into job_sim;
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Live isolation', 'publishing') returning id into draft_live;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, execution_mode)
    values(org, draft_live, 'facebook', 'immediate', 'claim-iso-live', 'live') returning id into job_live;

  select id into claimed from public.claim_pre_submission_publishing_job('false-worker', false, null, null);
  perform test.eq('publishing_claim_isolation', 'false-mode worker claims simulation only', claimed, job_sim);
  perform test.ok('publishing_claim_isolation', 'false-mode worker leaves live authority queued',
    (select status = 'queued' and claimed_by is null from public.publishing_jobs where id = job_live));
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job_sim, org, draft_live, 'facebook', 1, 'started') returning id into attempt_sim_mismatch;
  perform test.throws('publishing_claim_isolation', 'simulation settlement rejects receipt bound to another draft',
    format('select public.settle_publishing_receipt(%L,%L,%L::jsonb,%L,%L)', attempt_sim_mismatch, 'published',
      '{"postSubmissionId":"mock-facebook-binding","simulated":true}', 'mock-facebook-binding',
      'https://mock.local/facebook/mock-facebook-binding'));
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job_sim, org, draft_sim, 'facebook', 2, 'started') returning id into attempt_sim;
  perform public.settle_publishing_receipt(attempt_sim, 'published',
    '{"postSubmissionId":"mock-facebook-simulation","simulated":true}',
    'mock-facebook-simulation', 'https://mock.local/facebook/mock-facebook-simulation');
  perform test.ok('publishing_claim_isolation', 'explicit simulation mock settles only the simulation job',
    (select status = 'published' from public.publishing_jobs where id = job_sim)
    and (select status = 'queued' from public.publishing_jobs where id = job_live));

  update public.publishing_jobs set status = 'cancelled' where id = job_sim;
  select count(*) into n from public.claim_pre_submission_publishing_job('missing-proof', true, 'generation-current', null);
  perform test.eq('publishing_claim_isolation', 'missing proof denies live claim', n, 0);
  select count(*) into n from public.claim_pre_submission_publishing_job('draining-worker', true, 'generation-draining', 'old-proof');
  perform test.eq('publishing_claim_isolation', 'draining generation denies live claim', n, 0);
  select count(*) into n from public.claim_pre_submission_publishing_job('expired-worker', true, 'generation-expired', 'expired-proof');
  perform test.eq('publishing_claim_isolation', 'stale generation denies live claim', n, 0);
  select id into claimed from public.claim_pre_submission_publishing_job('current-worker', true, 'generation-current', 'current-proof');
  perform test.eq('publishing_claim_isolation', 'current verified live worker claims live authority', claimed, job_live);
  perform test.ok('publishing_claim_isolation', 'live claim binds exact generation',
    (select claimed_generation_id = 'generation-current' from public.publishing_jobs where id = job_live));

  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job_live, org, draft_sim, 'facebook', 1, 'started') returning id into attempt_mismatched;
  perform test.throws('publishing_claim_isolation', 'provider barrier rejects attempt bound to another draft',
    format('select public.begin_publishing_submission(%L,%L,%L,%L,%L)', job_live, attempt_mismatched,
      'current-worker', 'generation-current', 'current-proof'));
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job_live, org, draft_live, 'facebook', 2, 'started') returning id into attempt_live;
  update public.publishing_worker_generations set status = 'draining' where generation_id = 'generation-current';
  perform test.throws('publishing_claim_isolation', 'draining after claim cannot cross provider barrier',
    format('select public.begin_publishing_submission(%L,%L,%L,%L,%L)', job_live, attempt_live,
      'current-worker', 'generation-current', 'current-proof'));
  perform test.ok('publishing_claim_isolation', 'rejected barrier leaves claim and attempt pre-submission',
    (select status = 'processing' and pre_submission_recovery from public.publishing_jobs where id = job_live)
    and (select status = 'started' from public.publishing_attempts where id = attempt_live));
  update public.publishing_worker_generations set status = 'active' where generation_id = 'generation-current';
  perform public.begin_publishing_submission(job_live, attempt_live, 'current-worker', 'generation-current', 'current-proof');
  perform test.throws('publishing_claim_isolation', 'mock.local cannot settle live publication',
    format('select public.settle_publishing_receipt(%L,%L,%L::jsonb,%L,%L)', attempt_live, 'published',
      '{"postSubmissionId":"mock-facebook-1"}', 'mock-facebook-1', 'https://mock.local/facebook/mock-facebook-1'));
  perform test.ok('publishing_claim_isolation', 'rejected live mock has zero terminal mutation',
    (select status = 'awaiting_confirmation' and external_post_id is null from public.publishing_attempts where id = attempt_live)
    and (select status = 'awaiting_confirmation' from public.publishing_jobs where id = job_live));
  perform public.settle_publishing_receipt(attempt_live, 'published',
    '{"postSubmissionId":"provider-receipt-1"}', 'provider-receipt-1', 'https://provider.example/post/1');
  perform test.ok('publishing_claim_isolation', 'verified live receipt settles real publication',
    (select status = 'completed' and external_post_id = 'provider-receipt-1' from public.publishing_attempts where id = attempt_live)
    and (select status = 'published' from public.publishing_jobs where id = job_live));

  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Historical mock isolation', 'publishing') returning id into draft_mock;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, execution_mode)
    values(org, draft_mock, 'facebook', 'immediate', 'claim-iso-historical-mock', 'live') returning id into job_mock;
  -- Model a terminal mock row that predates the isolation migration without
  -- asking the new INSERT-time semantic guard to accept fresh mock evidence.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    completed_at, external_post_id, external_url, provider_metadata)
    values(job_mock, org, draft_mock, 'facebook', 1, 'completed', now(), 'mock-facebook-history',
      'https://mock.local/facebook/mock-facebook-history', '{"simulated":true}') returning id into attempt_mock;
  perform set_config('session_replication_role', 'origin', true);
  select to_jsonb(a) into before_mock from public.publishing_attempts a where id = attempt_mock;
  select count(*) into n from public.claim_pre_submission_publishing_job('unreconciled', true, 'generation-current', 'current-proof');
  perform test.eq('publishing_claim_isolation', 'prior mock evidence blocks unreconciled live claim', n, 0);
  insert into public.publishing_duplicate_reconciliations(job_id, reconciled_attempt_ids, disposition, rationale)
    values(job_mock, array[attempt_mock], 'ambiguous', 'Provider state remains ambiguous; submission is forbidden.');
  select count(*) into n from public.claim_pre_submission_publishing_job('ambiguous', true, 'generation-current', 'current-proof');
  perform test.eq('publishing_claim_isolation', 'ambiguous reconciliation fails closed', n, 0);
  insert into public.publishing_duplicate_reconciliations(job_id, reconciled_attempt_ids, disposition, rationale)
    values(job_mock, array[attempt_mock], 'safe_to_submit', 'Operator independently verified this exact attempt set as simulation-only.');
  select id into claimed from public.claim_pre_submission_publishing_job('reconciled', true, 'generation-current', 'current-proof');
  perform test.eq('publishing_claim_isolation', 'exact duplicate reconciliation permits eligibility', claimed, job_mock);
  perform test.ok('publishing_claim_isolation', 'historical mock remains byte-identical evidence',
    (select to_jsonb(a) = before_mock from public.publishing_attempts a where id = attempt_mock));
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    failed_at, external_post_id, external_url, provider_metadata)
    values(job_mock, org, draft_mock, 'facebook', 2, 'failed', now(), 'mock-facebook-late',
      'https://mock.local/facebook/mock-facebook-late', '{"simulated":true}') returning id into attempt_mock_new;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job_mock, org, draft_mock, 'facebook', 3, 'started') returning id into attempt_mock_current;
  perform test.throws('publishing_claim_isolation', 'new ambiguous evidence invalidates reconciliation at provider barrier',
    format('select public.begin_publishing_submission(%L,%L,%L,%L,%L)', job_mock, attempt_mock_current,
      'reconciled', 'generation-current', 'current-proof'));
  perform test.ok('publishing_claim_isolation', 'duplicate barrier rejection preserves pre-submission state',
    (select status = 'processing' and pre_submission_recovery from public.publishing_jobs where id = job_mock)
    and (select status = 'started' from public.publishing_attempts where id = attempt_mock_current));
  perform test.throws('publishing_claim_isolation', 'historical mock remains immutable',
    format('update public.publishing_attempts set external_post_id = %L where id = %L', 'rewritten', attempt_mock), '42501');
  perform test.throws('publishing_claim_isolation', 'reconciliation evidence remains immutable',
    format('update public.publishing_duplicate_reconciliations set rationale = %L where job_id = %L', 'changed', job_mock), '42501');
end;
$$;

-- Reconciliation is another terminal-settlement path, and append-only evidence
-- must survive both direct deletion and the parent foreign-key cascades.
do $$
declare
  org uuid := '00000000-0000-4000-b000-000000000001';
  draft_mock_reconcile uuid; job_mock_reconcile uuid; attempt_mock_reconcile uuid;
  draft_real_reconcile uuid; job_real_reconcile uuid; attempt_real_reconcile uuid;
  draft_direct uuid; job_direct uuid; attempt_direct uuid;
  draft_job_cascade uuid; job_cascade uuid; attempt_job_cascade uuid;
  draft_draft_cascade uuid; job_draft_cascade uuid; attempt_draft_cascade uuid;
  before_mock_reconcile jsonb; after_mock_reconcile jsonb;
begin
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Mock reconciliation isolation', 'failed') returning id into draft_mock_reconcile;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
    values(org, draft_mock_reconcile, 'facebook', 'scheduled', 'claim-iso-mock-reconcile', 'failed', 'live')
    returning id into job_mock_reconcile;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    failed_at, error_code, external_post_id, external_url, provider_metadata)
    values(job_mock_reconcile, org, draft_mock_reconcile, 'facebook', 1, 'failed', now(),
      'blotato_status_timeout', 'mock-facebook-reconcile', 'https://mock.local/facebook/mock-facebook-reconcile',
      '{"postSubmissionId":"mock-facebook-reconcile","simulated":true}')
    returning id into attempt_mock_reconcile;
  select jsonb_build_array(to_jsonb(a), to_jsonb(j), to_jsonb(d)) into before_mock_reconcile
    from public.publishing_attempts a
    join public.publishing_jobs j on j.id = a.job_id
    join public.content_drafts d on d.id = a.draft_id
    where a.id = attempt_mock_reconcile;
  perform test.throws('publishing_claim_isolation', 'mock receipt cannot reconcile a live timeout as published',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,%L,null)',
      org, job_mock_reconcile, attempt_mock_reconcile, 'mock-facebook-reconcile',
      'https://mock.local/facebook/mock-facebook-reconcile'));
  select jsonb_build_array(to_jsonb(a), to_jsonb(j), to_jsonb(d)) into after_mock_reconcile
    from public.publishing_attempts a
    join public.publishing_jobs j on j.id = a.job_id
    join public.content_drafts d on d.id = a.draft_id
    where a.id = attempt_mock_reconcile;
  perform test.ok('publishing_claim_isolation', 'rejected mock reconciliation has zero attempt/job/draft/audit mutation',
    before_mock_reconcile = after_mock_reconcile
    and (select count(*) = 1 from public.publishing_attempts where job_id = job_mock_reconcile)
    and not exists(select 1 from public.audit_events where draft_id = draft_mock_reconcile));

  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Real reconciliation compatibility', 'failed') returning id into draft_real_reconcile;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
    values(org, draft_real_reconcile, 'facebook', 'scheduled', 'claim-iso-real-reconcile', 'failed', 'live')
    returning id into job_real_reconcile;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    failed_at, error_code, provider_metadata)
    values(job_real_reconcile, org, draft_real_reconcile, 'facebook', 1, 'failed', now(),
      'blotato_status_timeout', '{"postSubmissionId":"provider-reconcile-1"}')
    returning id into attempt_real_reconcile;
  perform public.reconcile_failed_publishing_timeout(org, job_real_reconcile, attempt_real_reconcile,
    'provider-reconcile-1', 'https://provider.example/post/reconcile-1', null);
  perform test.ok('publishing_claim_isolation', 'non-mock live reconciliation remains compatible and explicit',
    (select status = 'published' from public.publishing_jobs where id = job_real_reconcile)
    and (select status = 'published' from public.content_drafts where id = draft_real_reconcile)
    and exists(
      select 1 from public.publishing_attempts
      where job_id = job_real_reconcile and status = 'completed'
        and external_post_id = 'provider-reconcile-1'
        and provider_metadata->>'reconciledFromAttemptId' = attempt_real_reconcile::text
    ));

  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Direct evidence deletion', 'published') returning id into draft_direct;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
    values(org, draft_direct, 'facebook', 'scheduled', 'claim-iso-direct-delete', 'published', 'live')
    returning id into job_direct;
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Job cascade evidence deletion', 'published') returning id into draft_job_cascade;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
    values(org, draft_job_cascade, 'facebook', 'scheduled', 'claim-iso-job-delete', 'published', 'live')
    returning id into job_cascade;
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Draft cascade evidence deletion', 'published') returning id into draft_draft_cascade;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
    values(org, draft_draft_cascade, 'facebook', 'scheduled', 'claim-iso-draft-delete', 'published', 'live')
    returning id into job_draft_cascade;

  -- These rows model evidence that predates the isolation migration. Replica
  -- mode is scoped to fixture insertion only so current semantic guards do not
  -- rewrite history while the deletion guards remain exercised normally.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    completed_at, external_post_id, external_url, provider_metadata)
    values(job_direct, org, draft_direct, 'facebook', 1, 'completed', now(), 'mock-direct-history',
      'https://mock.local/facebook/mock-direct-history', '{"simulated":true}') returning id into attempt_direct;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    completed_at, external_post_id, external_url, provider_metadata)
    values(job_cascade, org, draft_job_cascade, 'facebook', 1, 'completed', now(), 'mock-job-history',
      'https://mock.local/facebook/mock-job-history', '{"simulated":true}') returning id into attempt_job_cascade;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    completed_at, external_post_id, external_url, provider_metadata)
    values(job_draft_cascade, org, draft_draft_cascade, 'facebook', 1, 'completed', now(), 'mock-draft-history',
      'https://mock.local/facebook/mock-draft-history', '{"simulated":true}') returning id into attempt_draft_cascade;
  perform set_config('session_replication_role', 'origin', true);

  perform test.throws('publishing_claim_isolation', 'historical terminal mock rejects direct deletion',
    format('delete from public.publishing_attempts where id = %L', attempt_direct), '42501');
  perform test.throws('publishing_claim_isolation', 'historical terminal mock rejects job cascade deletion',
    format('delete from public.publishing_jobs where id = %L', job_cascade), '42501');
  perform test.throws('publishing_claim_isolation', 'historical terminal mock rejects draft cascade deletion',
    format('delete from public.content_drafts where id = %L', draft_draft_cascade), '42501');
  perform test.ok('publishing_claim_isolation', 'rejected deletion paths preserve every historical mock and parent',
    exists(select 1 from public.publishing_attempts where id = attempt_direct)
    and exists(select 1 from public.publishing_attempts where id = attempt_job_cascade)
    and exists(select 1 from public.publishing_attempts where id = attempt_draft_cascade)
    and (select count(*) = 3 from public.publishing_jobs where id in (job_direct, job_cascade, job_draft_cascade))
    and (select count(*) = 3 from public.content_drafts where id in (draft_direct, draft_job_cascade, draft_draft_cascade)));
end;
$$;
