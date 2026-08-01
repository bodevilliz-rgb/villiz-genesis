# Publishing Engine (Sprint 6A)

A durable, worker-driven publishing pipeline. Once a draft is Approved, the
operator queues (or schedules) a publish and the system — never a human —
drives it the rest of the way to Published or Failed.

```
Approved → Queued → Publishing → Published
                              ↘ Failed → (operator retries) → Queued → …

Approved → Scheduled → Queued → Publishing → Published/Failed
```

No real social platform is integrated yet. Every platform (LinkedIn,
Facebook, Instagram, X) is served by a simulated adapter that behaves like a
real one — deterministic ids, a brief delay, controllable success/failure —
without ever calling out to the internet.

## Architecture

```
core/domain/entities/publishing.ts        PublishingJob, PublishingAttempt, statuses, transition matrix
core/application/ports/
  publishing-port.ts                      PublishingRepository interface
  publisher-port.ts                       PublisherPort interface (provider-neutral)
core/application/use-cases/publishing/
  index.ts                                createImmediatePublishingJob, retryFailedPublishingJob, … (13 use-cases)
  analytics.ts                            computePublishingAnalytics — pure, formula-only
infrastructure/
  repositories/supabase-publishing-repository.ts   the only concrete PublishingRepository
  publishers/mock/*.ts                    MockLinkedInPublisher, MockFacebookPublisher, MockInstagramPublisher, MockXPublisher
  publishers/publisher-factory.ts         resolvePublisher(platform) — the only place a platform maps to an adapter
  publishers/simulation-mode.ts           dev-only mock-outcome override, gated on NODE_ENV
scripts/publishing-worker.ts              the background worker (a separate OS process)
server/actions/publishing.ts              Server Actions: create/retry/cancel/reschedule
app/(workspace)/organisations/[orgId]/publishing/  Publishing Queue UI + attempt detail
```

Application code never imports a `Mock*Publisher` class directly — only
`resolvePublisher()` does. Swapping a platform to a real provider later means
adding one case to that factory; nothing above it changes.

## Domain model

**PublishingJob** — the durable intent to publish one draft to one platform
once. Statuses: `queued`, `processing`, `published`, `failed`, `cancelled`.
There is no separate "scheduled" job status — a scheduled job is simply a
`queued` job whose `scheduledFor` is still in the future. The Publishing
Queue's "Scheduled" tab is `queued` jobs not yet due; its "Queued" tab is
`queued` jobs that are due and waiting for a worker slot.

**PublishingAttempt** — one immutable historical record of the engine
actually trying. A retry always **inserts a new attempt row** — a database
trigger (`app.prevent_terminal_attempt_mutation`, see
`supabase/migrations/20260801140000_publishing_engine.sql`) makes it a hard
error to `UPDATE` an attempt that has already reached `completed` or
`failed`. This is enforced by Postgres, not application discipline.

Trigger types: `immediate`, `scheduled`, `retry`.

## Database

New tables, purely additive (no existing migration touched):

- `publishing_jobs` — one row per intended publish. A partial unique index on
  `(draft_id, platform)` restricted to `queued`/`processing` rows prevents two
  simultaneously-active jobs for the same draft+platform. A unique
  `idempotency_key` prevents a duplicated request (double-click, action
  retry) from ever inserting a second job for the exact same request.
- `publishing_attempts` — append-only. Grants `SELECT` to organisation
  members but **no** `INSERT`/`UPDATE` to `authenticated` at all — every
  attempt is written exclusively by the worker's service-role client.
- `public.claim_next_publishing_job(worker_id)` — the atomic claim. Uses
  `for update skip locked` so two worker processes racing for the same due
  job can never both win.
- `public.recover_stale_publishing_jobs(stale_after_seconds)` — closes out
  any attempt stuck in `started` past the threshold as failed, then requeues
  the job (if under its retry limit) or fails it (if at the limit).

## The background worker

```bash
npm run worker:publishing
```

A standalone Node process (run via `tsx`, not through Next.js) that:

1. On startup, calls `recover_stale_publishing_jobs` once — a job left
   `processing` by a worker that crashed or was killed gets recovered before
   any new work is claimed, so it processes again exactly once, never twice.
2. Polls every 2 seconds (`PUBLISHING_WORKER_POLL_INTERVAL_MS`), claiming and
   fully draining every currently-due job each tick.
3. For each claimed job: creates the next attempt row, resolves the mock
   publisher for that platform, calls it, and records success or failure.
4. Runs stale-job recovery again every 60 seconds
   (`PUBLISHING_WORKER_STALE_RECOVERY_INTERVAL_MS`) while running, not just
   at startup.
5. Shuts down gracefully on `SIGINT`/`SIGTERM` — it does not abort an
   in-flight attempt.

It uses the service-role admin client
(`src/infrastructure/supabase/admin-client.ts`) throughout — the same
service-role usage that codebase's own doc-comment already reserves for
"server/worker contexts." It must run alongside `npm run dev:local`; the web
app itself never claims or advances a job.

**Why a separate process, not part of Next.js?** A serverless/edge request
handler cannot run a persistent poll loop, and the mission explicitly
requires processing that does not depend on a browser tab remaining open.

## Idempotency (non-negotiable)

A publishing job's `idempotencyKey` is minted **once per logical user
action**, client-side (`crypto.randomUUID()` in `PublishingPanel`, held in
component state so it survives re-renders but not remounts) — not inside the
Server Action. This is what makes a double-click or a network-level action
retry safe: both invocations carry the same key, so the second one returns
the first one's job instead of creating a duplicate.

Two independent guards exist:

1. **Application layer** (`createImmediatePublishingJob`/
   `createScheduledPublishingJob`): checks for an existing active job for the
   same draft+platform *before* validating the draft's current status —
   deliberately, since a replay arrives after the first call has already
   moved the draft past its original status.
2. **Database layer**: the unique `idempotency_key` constraint and the
   partial active-job unique index. If the application-layer check is ever
   bypassed, the database still refuses a duplicate insert
   (`SupabasePublishingRepository.createJob` catches the `23505` conflict and
   returns the existing row instead of surfacing an error).

## Retry behaviour

A failed job is **never** automatically retried. An operator must click
**Retry Publish**. `retryFailedPublishingJob`:

- refuses if the job isn't `failed`
- refuses if `retryCount >= maxRetries` (default `3`,
  `DEFAULT_MAX_PUBLISHING_RETRIES`)
- requeues the same job row (`status → queued`, `retryCount + 1`) — retrying
  is a state change on the job, not a new job
- the next attempt the worker creates is a **new** attempt row, referencing
  the previous one via `retryOfAttemptId`; the previous attempt is never
  touched

## Mock publisher simulation controls (development only)

Every mock adapter (`MockLinkedInPublisher`, etc.) shares one base class
(`MockPublisherBase`) with three outcomes:

- `always_succeed` (default) — deterministic external id/url, ~30ms delay
- `fail_next_attempt` — fails the very next attempt on this job, then is
  automatically cleared back to `always_succeed` the moment that job is
  retried
- `always_fail` — persistently fails every attempt on this job until an
  operator changes it or the job exhausts its retries

The override lives on the `publishing_jobs.dev_simulation_mode` column
(not in-process memory) because the web process and the worker process are
two separate OS processes with no shared memory — an operator setting this
from the UI (web process) would otherwise be invisible to the worker that
actually resolves the mock publisher.

**Why this can't reach production**: every read of this column goes through
`resolveEffectiveSimulationMode()`
(`src/infrastructure/publishers/simulation-mode.ts`), which returns
`always_succeed` unconditionally whenever `NODE_ENV === "production"` —
Next.js bakes `NODE_ENV` into the production bundle at build time, so this
is not a runtime toggle that could be flipped by mistake. The control is
also only rendered in the Publish Now form when
`process.env.NODE_ENV !== "production"`, which the production bundler
eliminates as dead code.

## Analytics — exact formulas

All computed by `computePublishingAnalytics()`
(`core/application/use-cases/publishing/analytics.ts`, pure, unit-tested in
`tests/publishing-analytics.test.ts`) from persisted `publishing_jobs`/
`publishing_attempts` rows only — never from `content_drafts`.

| Metric | Formula |
|---|---|
| Average publish time | mean `durationMs` of `completed` attempts only |
| Attempt success rate | completed attempts ÷ (completed + failed attempts) × 100 |
| Failure rate | failed attempts ÷ (completed + failed attempts) × 100 |
| Job success rate | published jobs ÷ jobs reaching any terminal state (published/failed/cancelled) × 100 |
| Retry success rate | completed attempts with `attemptNumber > 1` ÷ resolved (completed+failed) attempts with `attemptNumber > 1` × 100 |
| Scheduled vs. immediate | job count, average duration, and success rate computed identically but filtered by `triggerType` |
| Platform breakdown | the same attempt-level figures, filtered per platform, for all 4 platforms every time (zeroed if unused) |
| Published today | published jobs whose `completedAt` falls on the same UTC calendar day as "now" |

## Publishing Queue UI

`/organisations/[orgId]/publishing` — six views: Queued, Scheduled,
Publishing, Failed, Published, Cancelled (derived client-side from job
status + due/not-due, per the "no separate scheduled status" note above),
plus platform filtering and the analytics summary. Each job row links to
`/organisations/[orgId]/publishing/[jobId]` — the full attempt timeline,
oldest first, one row per immutable attempt with its exact timestamps and
duration.

## Content Studio and Calendar integration

Content Studio's own status counts and the draft detail page already read
`content_drafts.status`, which the publishing use-cases update in lock-step
at every transition (`publishing` → `published`/`failed`) — so Content
Studio needed no separate data-source change to stay correct.

The Content Calendar's drag-and-drop only allows dragging a draft whose
status is `scheduled` (anything `publishing`/`published`/`failed` is not
draggable, both visually and because `reschedulePublishingJob` refuses to
touch a job that isn't still `queued`). Dropping calls a real Server Action
that cancels the existing queued job and creates a new one at the target
date — it does not just repaint the calendar; a rejected reschedule reverts
the optimistic UI move and shows the real reason.

## Troubleshooting

**A queued job never moves past "Queued."** The worker isn't running. Start
it: `npm run worker:publishing`.

**Two operators both see the same "Publish Now" fail with a duplicate-key
error instead of one succeeding.** This should not happen — file it as a bug.
The intended behaviour is that the second call returns the *first* call's
job. If you see a raw constraint-violation error surfaced to the UI instead,
the application-layer idempotency check was bypassed somehow.

**A job is stuck in "Publishing" for a long time.** Either the worker that
claimed it crashed, or it's still within its processing window. Restart the
worker — its startup stale-job recovery (or the periodic one, every 60s)
will close out anything past the staleness threshold
(`PUBLISHING_WORKER_STALE_AFTER_SECONDS`, default 300s) and requeue it.

**Retry button doesn't appear on a failed job.** It only renders once
`retryCount < maxRetries`. A job at its retry limit needs an operator
decision (accept the failure, or manually investigate) rather than another
automated retry.

## Replacing a mock adapter with a real provider (future work)

1. Implement `PublisherPort` (`publish(input): Promise<PublisherResult>`)
   against the real platform API.
2. Add one case to `resolvePublisher()` in
   `src/infrastructure/publishers/publisher-factory.ts` for that platform.
3. Nothing else changes — the worker, the use-cases, the domain model, and
   the UI all depend only on `PublisherPort`, never on a concrete adapter.
4. Remove that platform from `resolveEffectiveSimulationMode()`'s reach (a
   real adapter should not honour `dev_simulation_mode` at all) by having the
   real adapter simply ignore `input.devSimulationMode`.

## Known limitations

- The Content Studio draft detail page currently renders the Publishing
  Actions panel twice (once directly, once nested inside the review panel
  component it also uses) — cosmetic duplication, not a correctness issue,
  since both instances are the same component wired to the same engine.
  Pre-dates Sprint 6A's publishing work; not fixed here since it touches
  page layout beyond this sprint's scope.
- The Schedule form's timezone selector is a label only — the underlying
  `scheduledAt` value is whatever the browser's `datetime-local` input
  produces (implicitly the browser's local time), not actually converted
  into the selected zone. This predates Sprint 6A.
- `supabase/seed.sql`'s idempotent upsert resets seeded `content_drafts`
  rows' `status` on every `dev:local` run (a known limitation documented
  since Sprint 5) — any publishing_jobs/publishing_attempts rows created
  against a seeded draft in one session will reference a draft whose status
  gets reset on the next `dev:local` restart. Manually re-approve the draft
  (or use a non-seeded draft) after a restart if you're resuming a publishing
  test.
