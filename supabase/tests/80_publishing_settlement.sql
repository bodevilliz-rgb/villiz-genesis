-- Local-only transactional fault injection. Run with the existing db:test
-- harness after migrations/10_seed; never point this suite at a live database.
create or replace function test.reject_settlement_write() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail_table', true) = tg_table_name then
    raise exception 'injected settlement write failure' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create trigger test_settlement_attempt before update on public.publishing_attempts
  for each row execute function test.reject_settlement_write();
create trigger test_settlement_job before update on public.publishing_jobs
  for each row execute function test.reject_settlement_write();
create trigger test_settlement_draft before update on public.content_drafts
  for each row execute function test.reject_settlement_write();

do $$
declare
  org uuid := '00000000-0000-4000-b000-000000000001';
  draft uuid; job uuid; attempt uuid; boundary text; outcome text;
  n integer; recovered integer; original_anchor timestamptz;
begin
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Settlement fault injection', 'publishing') returning id into draft;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key,
    status, execution_mode, claimed_by, claimed_at, pre_submission_recovery)
    values(org, draft, 'facebook', 'immediate', 'settlement-test', 'processing', 'live', 'test-worker', now(), true)
    returning id into job;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job, org, draft, 'facebook', 1, 'started') returning id into attempt;

  -- Failure settlement must roll back every write and fence stale owners.
  perform test.ok('publishing_settlement', 'stale failure owner rejected',
    not public.settle_failed_publishing_claim(job, 'other-worker', 'infrastructure_transient', 'unavailable'));
  foreach boundary in array array['publishing_jobs', 'publishing_attempts', 'content_drafts'] loop
    perform set_config('test.fail_table', boundary, true);
    begin
      perform public.settle_failed_publishing_claim(job, 'test-worker', 'infrastructure_transient', 'unavailable');
      raise exception 'Fault did not fire';
    exception when no_data_found then null;
    end;
    perform set_config('test.fail_table', '', true);
    perform test.ok('publishing_settlement', 'failure rollback ' || boundary,
      (select status = 'processing' and pre_submission_recovery from public.publishing_jobs where id = job)
      and (select status = 'started' and error_code is null from public.publishing_attempts where id = attempt)
      and (select status = 'publishing' from public.content_drafts where id = draft));
  end loop;
  perform test.ok('publishing_settlement', 'owned failure commits',
    public.settle_failed_publishing_claim(job, 'test-worker', 'infrastructure_transient', 'unavailable'));
  perform public.settle_failed_publishing_claim(job, 'test-worker', 'different', 'replay');
  perform test.ok('publishing_settlement', 'failure replay preserves atomic terminal state',
    (select status = 'failed' from public.publishing_jobs where id = job)
    and (select status = 'failed' and error_code = 'infrastructure_transient' from public.publishing_attempts where id = attempt)
    and (select status = 'failed' from public.content_drafts where id = draft));
  perform test.throws('publishing_settlement', 'failed attempt remains immutable',
    format('update public.publishing_attempts set status = %L where id = %L', 'started', attempt), '42501');
  perform test.ok('publishing_settlement', 'failed attempt unchanged after rejected mutation',
    (select status = 'failed' and error_code = 'infrastructure_transient' from public.publishing_attempts where id = attempt));
  -- A separate live lease tests reassignment without reopening terminal history.
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Reassignment fixture', 'publishing') returning id into draft;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key,
    status, execution_mode, claimed_by, claimed_at, pre_submission_recovery)
    values(org, draft, 'facebook', 'immediate', 'reassignment-test', 'processing', 'live', 'new-worker', now(), true)
    returning id into job;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job, org, draft, 'facebook', 1, 'started') returning id into attempt;
  perform test.ok('publishing_settlement', 'reassigned owner remains untouched',
    not public.settle_failed_publishing_claim(job, 'test-worker', 'old', 'old')
    and (select status = 'processing' and claimed_by = 'new-worker' from public.publishing_jobs where id = job)
    and (select status = 'started' from public.publishing_attempts where id = attempt)
    and (select status = 'publishing' from public.content_drafts where id = draft));
  update public.publishing_jobs set claimed_by = 'test-worker' where id = job;

  -- Barrier rollback at either write leaves a recoverable pre-submission row.
  foreach boundary in array array['publishing_jobs', 'publishing_attempts'] loop
    perform set_config('test.fail_table', boundary, true);
    begin
      perform public.begin_publishing_submission(job, attempt, 'test-worker');
      raise exception 'Fault did not fire';
    exception when no_data_found then null;
    end;
    perform set_config('test.fail_table', '', true);
    perform test.ok('publishing_settlement', 'barrier rollback ' || boundary,
      (select status = 'processing' and pre_submission_recovery from public.publishing_jobs where id = job)
      and (select status = 'started' from public.publishing_attempts where id = attempt));
  end loop;
  perform public.begin_publishing_submission(job, attempt, 'test-worker');
  update public.publishing_jobs set claimed_at = now() - interval '1 hour' where id = job;
  select count(*) into recovered from public.recover_stale_publishing_jobs(300);
  perform test.eq('publishing_settlement', 'restart never recovers a post-barrier job', recovered, 0);

  foreach outcome in array array['pending', 'published'] loop
    foreach boundary in array array['publishing_attempts', 'publishing_jobs', 'content_drafts'] loop
      if outcome = 'pending' and boundary = 'content_drafts' then continue; end if;
      perform set_config('test.fail_table', boundary, true);
      begin
        perform public.settle_publishing_receipt(attempt, outcome, '{"postSubmissionId":"receipt"}', 'receipt', 'https://example.test/post');
        raise exception 'Fault did not fire';
      exception when no_data_found then null;
      end;
      perform set_config('test.fail_table', '', true);
      perform test.ok('publishing_settlement', outcome || ' rollback ' || boundary,
        (select status = 'awaiting_confirmation' and next_status_check_at is null from public.publishing_jobs where id = job)
        and (select not (provider_metadata ? 'postSubmissionId') from public.publishing_attempts where id = attempt)
        and (select status = 'publishing' from public.content_drafts where id = draft));
    end loop;
  end loop;
  perform public.settle_publishing_receipt(attempt, 'pending', '{"postSubmissionId":"receipt"}', null, null);
  select awaiting_confirmation_since into original_anchor from public.publishing_jobs where id = job;
  -- Discard RPC response and replay, as a restarted client would.
  perform public.settle_publishing_receipt(attempt, 'pending', '{"postSubmissionId":"receipt"}', null, null);
  perform test.ok('publishing_settlement', 'pending receipt durable and replay preserves horizon',
    (select next_status_check_at is not null and awaiting_confirmation_since = original_anchor from public.publishing_jobs where id = job)
    and (select provider_metadata->>'postSubmissionId' = 'receipt' from public.publishing_attempts where id = attempt));
  update public.publishing_jobs set next_status_check_at = null where id = job;
  perform public.settle_publishing_receipt(attempt, 'pending', '{"postSubmissionId":"receipt"}', null, null);
  perform test.ok('publishing_settlement', 'replay cannot restart an intentionally stopped schedule',
    (select next_status_check_at is null from public.publishing_jobs where id = job));
  perform public.settle_publishing_receipt(attempt, 'published', '{"postSubmissionId":"receipt"}', 'receipt', 'https://example.test/post');
  perform public.settle_publishing_receipt(attempt, 'published', '{"postSubmissionId":"receipt"}', 'receipt', 'https://example.test/post');
  perform public.settle_publishing_receipt(attempt, 'pending', '{"postSubmissionId":"receipt"}', null, null);
  perform test.ok('publishing_settlement', 'terminal replay is immutable and cannot reopen job',
    (select status = 'published' and next_status_check_at is null from public.publishing_jobs where id = job)
    and (select status = 'completed' from public.publishing_attempts where id = attempt)
    and (select status = 'published' from public.content_drafts where id = draft));

  perform test.throws('publishing_settlement', 'completed attempt remains immutable',
    format('update public.publishing_attempts set status = %L where id = %L', 'started', attempt), '42501');
  perform test.ok('publishing_settlement', 'completed attempt unchanged after rejected mutation',
    (select status = 'completed' and external_post_id = 'receipt' from public.publishing_attempts where id = attempt));

  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key)
    values(org, draft, 'facebook', 'immediate', 'recovery-claim-test');
  select id into job from public.claim_pre_submission_publishing_job('expired');
  perform test.ok('publishing_settlement', 'opt-in claim atomically marks pre-submission eligibility',
    (select status = 'processing' and pre_submission_recovery from public.publishing_jobs where id = job));
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job, org, draft, 'facebook', 1, 'started') returning id into attempt;
  update public.publishing_jobs set claimed_at = now() - interval '1 hour' where id = job;
  perform public.recover_stale_publishing_jobs(300);
  perform test.throws('publishing_settlement', 'expired attempt cannot cross submission barrier',
    format('select public.begin_publishing_submission(%L, %L, %L)', job, attempt, 'expired'));
  perform test.ok('publishing_settlement', 'recovery schedules finite future retry',
    (select next_attempt_at = now() + interval '60 seconds' and retry_count = 1 from public.publishing_jobs where id = job));
  select count(*) into n from public.claim_next_publishing_job('too-soon');
  perform test.eq('publishing_settlement', 'immediate legacy claim is empty', n, 0);
  select count(*) into n from public.claim_pre_submission_publishing_job('too-soon');
  perform test.eq('publishing_settlement', 'immediate recovery claim is empty', n, 0);
  -- Simulate expiry without sleeping or replacing the database clock.
  update public.publishing_jobs set next_attempt_at = now() - interval '1 second' where id = job;
  perform public.claim_pre_submission_publishing_job('after-backoff');
  perform test.ok('publishing_settlement', 'claim succeeds after backoff',
    (select status = 'processing' and claimed_by = 'after-backoff' from public.publishing_jobs where id = job));
  update public.publishing_jobs set claimed_at = now() - interval '1 hour' where id = job;
  perform public.recover_stale_publishing_jobs(300);
  update public.publishing_jobs set next_attempt_at = now() - interval '1 second' where id = job;
  update public.publishing_jobs set pre_submission_recovery = true where id = job;
  perform public.claim_next_publishing_job('legacy-worker');
  perform test.ok('publishing_settlement', 'legacy caller cannot inherit recovery eligibility',
    (select not pre_submission_recovery from public.publishing_jobs where id = job));
  perform test.ok('publishing_settlement', 'legacy claim succeeds after backoff',
    (select status = 'processing' and claimed_by = 'legacy-worker' from public.publishing_jobs where id = job));
  -- Exhaust the finite retry allowance without creating or submitting another attempt.
  for n in 1..2 loop
    update public.publishing_jobs set status = 'processing', pre_submission_recovery = true,
      claimed_at = now() - interval '1 hour', claimed_by = 'expired' where id = job;
    perform public.recover_stale_publishing_jobs(300);
  end loop;
  perform test.ok('publishing_settlement', 'recovery preserves max retries and never reopens attempts',
    (select status = 'failed' and retry_count = max_retries from public.publishing_jobs where id = job)
    and (select count(*) = 1 and bool_and(status = 'failed') from public.publishing_attempts where job_id = job));
  -- Remove this recovered fixture before the independent batch test.
  update public.publishing_jobs set status = 'cancelled' where id = job;

  -- 26 eligible rows plus a legacy row. One call has a hard 25-row ceiling.
  for n in 1..27 loop
    insert into public.content_drafts(organisation_id, title) values(org, 'Recovery test ' || n) returning id into draft;
    insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key,
      status, claimed_at, claimed_by, pre_submission_recovery)
      values(org, draft, 'facebook', 'immediate', 'recovery-test-' || n, 'processing', now() - interval '1 hour', 'expired', n <= 26)
      returning id into job;
  end loop;
  select count(*) into recovered from public.recover_stale_publishing_jobs(300);
  perform test.eq('publishing_settlement', 'bounded first recovery batch', recovered, 25);
  select count(*) into recovered from public.recover_stale_publishing_jobs(300);
  perform test.eq('publishing_settlement', 'bounded next recovery batch', recovered, 1);
  perform test.ok('publishing_settlement', 'legacy processing remains excluded',
    (select status = 'processing' from public.publishing_jobs where id = job));
end;
$$;

drop trigger test_settlement_attempt on public.publishing_attempts;
drop trigger test_settlement_job on public.publishing_jobs;
drop trigger test_settlement_draft on public.content_drafts;
drop function test.reject_settlement_write();
