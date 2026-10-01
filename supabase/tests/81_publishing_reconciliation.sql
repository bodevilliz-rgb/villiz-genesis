-- Local-only: run after harness/10_seed. Every failure boundary must roll back
-- the append, job, draft AND audit; replay must preserve both terminal rows.
create or replace function test.reject_reconciliation_write() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail_table', true) = tg_table_name then
    raise exception 'injected reconciliation failure' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create trigger test_reconcile_attempt before insert on public.publishing_attempts
  for each row execute function test.reject_reconciliation_write();
create trigger test_reconcile_job before update on public.publishing_jobs
  for each row execute function test.reject_reconciliation_write();
create trigger test_reconcile_draft before update on public.content_drafts
  for each row execute function test.reject_reconciliation_write();
create trigger test_reconcile_audit before insert on public.audit_events
  for each row execute function test.reject_reconciliation_write();

do $$
declare
  org uuid := '00000000-0000-4000-b000-000000000001';
  draft uuid; job uuid; attempt uuid; boundary text; original jsonb; result public.publishing_jobs;
  other_attempt uuid; job_state public.publishing_job_status;
begin
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Legacy reconciliation fixture', 'failed') returning id into draft;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
    values(org, draft, 'instagram', 'scheduled', 'reconciliation-test', 'failed', 'live') returning id into job;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    failed_at, error_code, provider_metadata)
    values(job, org, draft, 'instagram', 1, 'failed', now(), 'blotato_status_timeout',
      '{"postSubmissionId":"legacy-receipt","preserved":"metadata"}') returning id into attempt;
  select to_jsonb(a) into original from public.publishing_attempts a where id = attempt;

  perform test.throws('publishing_reconciliation', 'wrong receipt rejected',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null)', org, job, attempt, 'wrong'));
  perform test.throws('publishing_reconciliation', 'wrong organisation rejected',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null)', gen_random_uuid(), job, attempt, 'legacy-receipt'));

  foreach job_state in array array['queued','processing','awaiting_confirmation','cancelled','published']::public.publishing_job_status[] loop
    update public.publishing_jobs set status = job_state where id = job;
    perform test.throws('publishing_reconciliation', 'reject job state ' || job_state::text,
      format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null)', org, job, attempt, 'legacy-receipt'));
  end loop;
  update public.publishing_jobs set status = 'failed', execution_mode = 'simulation' where id = job;
  perform test.throws('publishing_reconciliation', 'reject simulation',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null)', org, job, attempt, 'legacy-receipt'));
  update public.publishing_jobs set execution_mode = 'live' where id = job;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job, org, draft, 'instagram', 2, 'queued') returning id into other_attempt;
  perform test.throws('publishing_reconciliation', 'reject superseded timeout',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null)', org, job, attempt, 'legacy-receipt'));
  delete from public.publishing_attempts where id = other_attempt;

  foreach boundary in array array['publishing_attempts','publishing_jobs','content_drafts','audit_events'] loop
    perform set_config('test.fail_table', boundary, true);
    begin
      perform public.reconcile_failed_publishing_timeout(org, job, attempt, 'legacy-receipt', 'https://example.test/post', null);
      raise exception 'Fault did not fire';
    exception when no_data_found then null;
    end;
    perform set_config('test.fail_table', '', true);
    perform test.ok('publishing_reconciliation', 'atomic rollback ' || boundary,
      (select count(*) = 1 from public.publishing_attempts where job_id = job)
      and (select to_jsonb(a) = original from public.publishing_attempts a where id = attempt)
      and (select status = 'failed' from public.publishing_jobs where id = job)
      and (select status = 'failed' from public.content_drafts where id = draft)
      and not exists(select 1 from public.audit_events where draft_id = draft));
  end loop;

  result := public.reconcile_failed_publishing_timeout(org, job, attempt, 'legacy-receipt', 'https://example.test/post', null);
  result := public.reconcile_failed_publishing_timeout(org, job, attempt, 'legacy-receipt', 'https://example.test/changed', null);
  perform test.ok('publishing_reconciliation', 'restart replay preserves one append and audit',
    result.status = 'published' and result.trigger_type = 'scheduled'
    and (select status = 'published' from public.content_drafts where id = draft)
    and (select count(*) = 2 and bool_and(status in ('failed','completed')) from public.publishing_attempts where job_id = job)
    and (select to_jsonb(a) = original from public.publishing_attempts a where id = attempt)
    and (select count(*) = 1 from public.audit_events where draft_id = draft)
    and exists(select 1 from public.publishing_attempts where job_id = job and status = 'completed'
      and retry_of_attempt_id = attempt and external_post_id = 'legacy-receipt'
      and external_url = 'https://example.test/post' and provider_metadata->>'preserved' = 'metadata'));
  perform test.throws('publishing_reconciliation', 'published replay still checks receipt',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null)', org, job, attempt, 'wrong'));
  perform test.throws('publishing_reconciliation', 'original terminal attempt immutable',
    format('update public.publishing_attempts set status = %L where id = %L', 'started', attempt), '42501');
  perform test.ok('publishing_reconciliation', 'only service role may execute',
    has_function_privilege('service_role','public.reconcile_failed_publishing_timeout(uuid,uuid,uuid,text,text,uuid,text,text)','execute')
    and not has_function_privilege('authenticated','public.reconcile_failed_publishing_timeout(uuid,uuid,uuid,text,text,uuid,text,text)','execute')
    and not has_function_privilege('anon','public.reconcile_failed_publishing_timeout(uuid,uuid,uuid,text,text,uuid,text,text)','execute'));
end;
$$;
do $$
declare
  org uuid := '00000000-0000-4000-b000-000000000001';
  draft uuid; job uuid; attempt uuid; boundary text; original jsonb; result public.publishing_jobs;
  other_attempt uuid; job_state public.publishing_job_status;
begin
  insert into public.content_drafts(organisation_id, title, status)
    values(org, 'Legacy reconciliation fixture', 'failed') returning id into draft;
  insert into public.publishing_jobs(organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
    values(org, draft, 'instagram', 'scheduled', 'reconciliation-failed-test', 'failed', 'live') returning id into job;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status,
    failed_at, error_code, provider_metadata)
    values(job, org, draft, 'instagram', 1, 'failed', now(), 'blotato_status_timeout',
      '{"postSubmissionId":"legacy-receipt","preserved":"metadata"}') returning id into attempt;
  select to_jsonb(a) into original from public.publishing_attempts a where id = attempt;

  perform test.throws('publishing_reconciliation', 'confirmed failure: wrong receipt rejected',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null,%L,%L)', org, job, attempt, 'wrong', 'failed', 'provider rejected'));
  perform test.throws('publishing_reconciliation', 'confirmed failure: wrong organisation rejected',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null,%L,%L)', gen_random_uuid(), job, attempt, 'legacy-receipt', 'failed', 'provider rejected'));

  foreach job_state in array array['queued','processing','awaiting_confirmation','cancelled','published']::public.publishing_job_status[] loop
    update public.publishing_jobs set status = job_state where id = job;
    perform test.throws('publishing_reconciliation', 'confirmed failure: reject job state ' || job_state::text,
      format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null,%L,%L)', org, job, attempt, 'legacy-receipt', 'failed', 'provider rejected'));
  end loop;
  update public.publishing_jobs set status = 'failed', execution_mode = 'simulation' where id = job;
  perform test.throws('publishing_reconciliation', 'confirmed failure: reject simulation',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null,%L,%L)', org, job, attempt, 'legacy-receipt', 'failed', 'provider rejected'));
  update public.publishing_jobs set execution_mode = 'live' where id = job;
  insert into public.publishing_attempts(job_id, organisation_id, draft_id, platform, attempt_number, status)
    values(job, org, draft, 'instagram', 2, 'queued') returning id into other_attempt;
  perform test.throws('publishing_reconciliation', 'confirmed failure: reject superseded timeout',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null,%L,%L)', org, job, attempt, 'legacy-receipt', 'failed', 'provider rejected'));
  delete from public.publishing_attempts where id = other_attempt;

  foreach boundary in array array['publishing_attempts','publishing_jobs','content_drafts','audit_events'] loop
    perform set_config('test.fail_table', boundary, true);
    begin
      perform public.reconcile_failed_publishing_timeout(org, job, attempt, 'legacy-receipt', 'https://example.test/post', null, 'failed', 'provider rejected');
      raise exception 'Fault did not fire';
    exception when no_data_found then null;
    end;
    perform set_config('test.fail_table', '', true);
    perform test.ok('publishing_reconciliation', 'confirmed failure: atomic rollback ' || boundary,
      (select count(*) = 1 from public.publishing_attempts where job_id = job)
      and (select to_jsonb(a) = original from public.publishing_attempts a where id = attempt)
      and (select status = 'failed' from public.publishing_jobs where id = job)
      and (select status = 'failed' from public.content_drafts where id = draft)
      and not exists(select 1 from public.audit_events where draft_id = draft));
  end loop;

  result := public.reconcile_failed_publishing_timeout(org, job, attempt, 'legacy-receipt', 'https://example.test/post', null, 'failed', 'provider rejected');
  result := public.reconcile_failed_publishing_timeout(org, job, attempt, 'legacy-receipt', 'https://example.test/changed', null, 'failed', 'changed');
  perform test.ok('publishing_reconciliation', 'confirmed failure: restart replay preserves one append and audit',
    result.status = 'failed' and result.trigger_type = 'scheduled'
    and (select status = 'failed' from public.content_drafts where id = draft)
    and (select count(*) = 2 and bool_and(status = 'failed') from public.publishing_attempts where job_id = job)
    and (select to_jsonb(a) = original from public.publishing_attempts a where id = attempt)
    and (select count(*) = 1 from public.audit_events where draft_id = draft)
    and exists(select 1 from public.publishing_attempts where job_id = job and status = 'failed'
      and error_code = 'blotato_publish_failed' and retry_of_attempt_id = attempt and external_post_id = 'legacy-receipt'
      and external_url = 'https://example.test/post' and provider_metadata->>'preserved' = 'metadata'));
  perform test.throws('publishing_reconciliation', 'confirmed failure: published replay still checks receipt',
    format('select public.reconcile_failed_publishing_timeout(%L,%L,%L,%L,null,null,%L,%L)', org, job, attempt, 'wrong', 'failed', 'provider rejected'));
  perform test.throws('publishing_reconciliation', 'confirmed failure: original terminal attempt immutable',
    format('update public.publishing_attempts set status = %L where id = %L', 'started', attempt), '42501');
  perform test.ok('publishing_reconciliation', 'confirmed failure: only service role may execute',
    has_function_privilege('service_role','public.reconcile_failed_publishing_timeout(uuid,uuid,uuid,text,text,uuid,text,text)','execute')
    and not has_function_privilege('authenticated','public.reconcile_failed_publishing_timeout(uuid,uuid,uuid,text,text,uuid,text,text)','execute')
    and not has_function_privilege('anon','public.reconcile_failed_publishing_timeout(uuid,uuid,uuid,text,text,uuid,text,text)','execute'));
end;
$$;
drop trigger test_reconcile_attempt on public.publishing_attempts;
drop trigger test_reconcile_job on public.publishing_jobs;
drop trigger test_reconcile_draft on public.content_drafts;
drop trigger test_reconcile_audit on public.audit_events;
drop function test.reject_reconciliation_write();
