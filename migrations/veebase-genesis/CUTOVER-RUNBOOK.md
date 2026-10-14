# Genesis Veebase cutover runbook

Candidate: dedicated `supabase-genesis` stack on K11. API target: `http://100.94.229.2:8001`. Studio remains loopback-only. This document grants no production or cancellation authority.

## Boundaries

- Do not mutate the existing main Veebase/Omoroga stack; it remains independent.
- Do not merge, deploy, publish content, incur paid actions, or cancel Supabase from this runbook.
- Olabode is the sole production/cancellation approval owner. Every `[OWNER GO]` must be explicit and recorded against the exact candidate.
- A separate infrastructure card must add and drill backups for `supabase-genesis`; the main-stack cron does not cover it.

## Pre-cutover gates

1. Confirm `IMPORT-MANIFEST.json` says `PASS`, source dump checksums match, all source table counts and critical fingerprints match, storage is accounted for, and all target public tables have RLS.
2. Confirm all Genesis stack containers are healthy, API is tailnet-bound on 8001, Studio is loopback-only, and the main stack remains healthy.
3. Complete `PRE-CANCEL-RECEIPT.md` through the cutover/soak sections.
4. Complete targeted tests, full suite, typecheck, lint, production build, browser/responsive/accessibility and fallback checks against the exact candidate.
5. Verify a separate Genesis backup job exists and a restore drill passes. This is a production blocker until the subsequent infrastructure card supplies evidence.
6. `[OWNER GO — PRODUCTION ENV FLIP]` Record Olabode's explicit approval. Without it, stop.

## Controlled production swap

1. Capture current Vercel environment variable names and deployment/candidate identifiers; never copy secret values into reports.
2. Change only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the verified Genesis-stack values. Preserve a protected rollback copy of the cloud values.
3. Redeploy one exact candidate through the normal controlled release lane. Do not trigger a real social publish.
4. Verify login/session, organisations, Picks Queue, publishing history, media reads/signed URLs, server actions, worker read-only health, and error logs.
5. Insert a labelled non-production probe only if separately authorised; prove it lands solely in Genesis Veebase, then remove it with an auditable receipt.

## Soak (minimum 48 hours)

At cutover, +1h, +6h, +24h, and +48h record: route health; auth success; row-count deltas; critical aggregate fingerprints; storage bucket/object counts and bytes; RLS/policy presence; application/worker errors; CPU/memory/disk; backup completion. Any unexplained mismatch or security/auth/storage failure triggers rollback.

## Rollback

1. Stop writes/publishing workers.
2. Restore the protected cloud URL/anon/service environment values and redeploy the last known-good candidate.
3. Verify cloud auth, read paths, queue/history and storage; keep the Genesis stack intact for reconciliation.
4. Reconcile writes made during the cutover window before another attempt. Never discard either side.
5. Record trigger, timestamps, candidate IDs, verification receipts and the decision owner.

## Cancellation gate — last action only

The cloud project cannot currently be re-paused through the management API: the bounded `POST /v1/projects/{ref}/pause` attempt returned HTTP 400 because the paid project must be downgraded first. Do not retry, change plan or perform billing actions from an engineering run. `[OWNER GO — DOWNGRADE/PAUSE CLOUD PROJECT]` is an explicit owner billing gate; Olabode must perform the required account action and the operator must then verify the project is `INACTIVE`.

After at least 48 hours of clean soak, verified Genesis backups plus restore drill, final parity receipt, successful rollback rehearsal, and confirmed cloud `INACTIVE` status: `[OWNER GO — CANCEL PAID SUPABASE]`. Olabode performs the billing click. Re-check the organisation-wide blast radius immediately before cancellation. Cancellation is forbidden while any checklist item is open.
