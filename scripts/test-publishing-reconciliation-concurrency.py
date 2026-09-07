#!/usr/bin/env python3
"""Local-only two-session SQL test, after db:test fixtures/migrations.
Usage: PGURL=postgresql://postgres@localhost:54322/postgres python3 scripts/test-publishing-reconciliation-concurrency.py [published|failed|confirmation_failed]
Requires psql on PATH (or PGBIN). Never targets non-loopback hosts.
"""
import os
from pathlib import Path
import select
import subprocess
import sys
from urllib.parse import urlparse
import uuid

url = os.environ.get("PGURL", "postgresql://postgres@localhost:54322/postgres")
if urlparse(url).hostname not in ("localhost", "127.0.0.1", "::1"):
    raise SystemExit("Only a local loopback PostgreSQL database is allowed")
psql = str(Path(os.environ["PGBIN"]) / "psql") if "PGBIN" in os.environ else "psql"
command = [psql, url, "-X", "-At", "-v", "ON_ERROR_STOP=1"]
mode = sys.argv[1] if len(sys.argv) > 1 else "published"
if mode not in ("published", "failed", "confirmation_failed"):
    raise SystemExit("Expected published, failed or confirmation_failed")
normal = mode == "confirmation_failed"
terminal = "published" if mode == "published" else "failed"
initial = "awaiting_confirmation" if normal else "failed"
initial_error = "null" if normal else "'blotato_status_timeout'"
org = "00000000-0000-4000-b000-000000000001"
draft, job, attempt = [str(uuid.uuid4()) for _ in range(3)]


def sql(statement):
    return subprocess.run(command, input=statement, text=True, capture_output=True, check=True).stdout.strip()


sql(f"""
insert into public.content_drafts(id, organisation_id, title, status)
values('{draft}', '{org}', 'Concurrent provider settlement', '{'publishing' if normal else 'failed'}');
insert into public.publishing_jobs(id, organisation_id, draft_id, platform, trigger_type, idempotency_key, status, execution_mode)
values('{job}', '{org}', '{draft}', 'instagram', 'immediate', '{job}', '{initial}', 'live');
insert into public.publishing_attempts(id, job_id, organisation_id, draft_id, platform, attempt_number, status, error_code, provider_metadata)
values('{attempt}', '{job}', '{org}', '{draft}', 'instagram', 1, '{initial}', {initial_error}, '{{"postSubmissionId":"concurrent-receipt"}}');
""")
original = sql(f"select to_jsonb(a) from public.publishing_attempts a where id = '{attempt}';")
call = f"select (public.reconcile_failed_publishing_timeout('{org}','{job}','{attempt}','concurrent-receipt','https://example.test/post',null,'{terminal}','rejected')).status;"
if normal:
    call = f"""select (public.settle_publishing_receipt('{attempt}','failed',
      '{{"postSubmissionId":"concurrent-receipt","confirmedAfterAwaiting":true,"errorMessage":"rejected"}}',
      'concurrent-receipt',null)).status;"""
first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    # Hold the transaction open after the first repair. The second session must
    # block on its job lock, then observe the committed reconciliation on replay.
    first.stdin.write("begin;\n" + call + "\n")
    first.stdin.flush()
    assert first.stdout.readline().strip() == "BEGIN"
    assert first.stdout.readline().strip() == terminal
    second = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        second.stdin.write("set application_name = 'genesis-reconcile-concurrency';\n" + call + "\n")
        second.stdin.flush()
        assert second.stdout.readline().strip() == "SET"
        # Observe actual lock contention, not merely two sequential successes.
        for _ in range(100):
            waiting = sql("select count(*) from pg_stat_activity where application_name = 'genesis-reconcile-concurrency' and wait_event_type = 'Lock';")
            if waiting == "1":
                break
        else:
            raise AssertionError("Second reconciliation never waited for the job lock")
        assert not select.select([second.stdout], [], [], 0)[0]
        first.stdin.write("commit;\n")
        first.stdin.flush()
        first.stdin.close()
        assert first.wait(timeout=10) == 0, first.stderr.read()
        second.stdin.close()
        assert second.stdout.readline().strip() == terminal
        assert second.wait(timeout=10) == 0, second.stderr.read()
        result = sql(f"""
select
 (select count(*) = {1 if normal else 2} and bool_and(status in ('failed','completed')) from public.publishing_attempts where job_id = '{job}')
 and (select status = 'failed' and error_code = '{'blotato_publish_failed' if normal else 'blotato_status_timeout'}' from public.publishing_attempts where id = '{attempt}')
 and (select status = '{terminal}' from public.publishing_jobs where id = '{job}')
 and (select status = '{terminal}' from public.content_drafts where id = '{draft}')
 and (select count(*) = {0 if normal else 1} from public.audit_events where draft_id = '{draft}');
""")
        assert result == "t", result
        if not normal:
            assert sql(f"select to_jsonb(a) from public.publishing_attempts a where id = '{attempt}';") == original
        settled = sql(f"select to_jsonb(a) from public.publishing_attempts a where job_id = '{job}' order by attempt_number;")
        assert sql(call) == terminal  # Third process simulates client restart.
        assert sql(f"select to_jsonb(a) from public.publishing_attempts a where job_id = '{job}' order by attempt_number;") == settled
        print(f"PASS {mode}: concurrent job-lock contention, atomic terminal state, no orphan, restart replay")
    finally:
        if second.poll() is None:
            second.kill()
            second.wait()
finally:
    if first.poll() is None:
        first.kill()
        first.wait()
    # Draft/version history is intentionally immutable; remove only mutable test rows.
    sql(f"delete from public.audit_events where draft_id = '{draft}'; delete from public.publishing_jobs where id = '{job}';")
