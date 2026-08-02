# Publishing Engine (Sprint 6A, UX polish in 6A.1)

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

`/organisations/[orgId]/publishing` — six tabs: Queued, Scheduled,
Publishing, Failed, Published, Cancelled (derived client-side from job
status + due/not-due, per the "no separate scheduled status" note above),
plus the analytics summary and a filter bar (search, platform, trigger type,
queued-date range). Each job card links to
`/organisations/[orgId]/publishing/[jobId]` — the full job detail page.

### Operator guide — reading a queue card

Every card (`PublishingJobRow`, `src/components/publishing/publishing-job-row.tsx`)
shows, top to bottom:

- **Content title** (the draft's own title, links to the job detail page) and,
  directly under it, the **organisation** and **campaign** (if the draft has one).
- A row of badges: **status**, **publishing destination** (see "Platform
  destination vs. content title" below), **trigger type**
  (Immediate/Scheduled/Retry), and a **Retry N/M** badge once a job has been
  retried at least once.
- A status-specific detail line: an indeterminate spinner + "Publishing to
  X — attempt N, started …" while `processing`; "Waiting for the worker to
  pick this up" while `queued` and due; a countdown + timezone while `queued`
  and not yet due (a genuinely scheduled item).
- A timing grid: Queued, Scheduled-for/Due, Started, Completed/Failed,
  Duration, Attempts, Requested by (a resolved name, never a raw UUID).
- The latest error, if `failed`.
- Actions valid for the *current* status only — see "Retry workflow" below.

### Job detail page guide

`/organisations/[orgId]/publishing/[jobId]` has five sections, in order:

1. **Summary** — the same card described above, reused so the queue and the
   detail page can never disagree about a job's state.
2. **Progress** — a four-step timeline of *this job's current/latest
   attempt only* (Queued → Claimed by worker → Publishing to `<platform>` →
   Completed/Failed), each step showing its own elapsed time since the
   previous one. This is distinct from "Attempt history" below — it never
   lists prior retried attempts, only the current cycle.
3. **Attempt history** — every attempt ever recorded for this job, oldest
   first, each an immutable row (a retry never overwrites a previous
   attempt's status, timestamps, or error).
4. **Audit events** — every audited action tied to this specific job
   (queued, retried, cancelled, completed, failed), each attributed to the
   actor who caused it or "System (background worker)" for automated steps.
5. **Technical details** — collapsed by default (`<details>`): internal job
   ID, draft ID, organisation ID, idempotency key, last-claimed-by worker ID,
   and the latest attempt's raw provider metadata. Never shown in the normal
   operator UI outside this section.

### Platform destination vs. content title

A draft's **title** and a job's **publishing destination** are two
independent facts — a draft called "Instagram Promo Post" can genuinely be
published to LinkedIn, if that's what the operator selected when queuing it.
Every surface that shows a platform (queue card, job detail, Dashboard,
Content Studio, Calendar) renders it via the one shared `PlatformBadge`
component (`src/components/publishing/platform-badge.tsx`), which always
takes its platform from the persisted `PublishingJob.platform` field —
never inferred from the draft's title, content type, or campaign. The badge
also carries an explicit `role="img"` accessible name of the form
"Publishing destination: LinkedIn", so this distinction holds for screen
readers too, not just sighted operators.

### Retry workflow

A **failed** job with `retryCount < maxRetries` shows a **Retry Publish**
button. Clicking it:

1. Immediately flips the job back to `queued` (visible on the next page
   load/revalidation — the previously-failed job disappears from the Failed
   tab and reappears in Queued).
2. The worker picks it up on its next poll tick and creates a **new**
   attempt row — attempt 1 (the original failure) is never touched. The job
   detail page's "Attempt history" then shows both: Attempt 1 (Failed, with
   its original error preserved) and Attempt 2 (labelled "Retry of attempt
   1"), each with its own independent outcome.
3. Analytics (Job Success Rate, Retry Success Rate, Successful Retries,
   Failed — Needs Attention) update to reflect the new state on the next
   page load, since every figure is recomputed from persisted rows, never
   cached client-side.

The **Retry Publish** button itself disables and shows "Retrying…" for the
duration of the click (via `useFormStatus`/`SubmitButton`), so a double-click
cannot submit the retry twice.

### Failure troubleshooting (operator-facing)

- **A failed job shows no Retry Publish button.** It has reached
  `maxRetries` (default 3). This needs an operator decision — accept the
  failure, or investigate the recorded error code/message in the job
  detail page's Attempt history — rather than another automated retry.
- **A retry appears to have done nothing.** Give the worker one poll cycle
  (`PUBLISHING_WORKER_POLL_INTERVAL_MS`, default 2s) — clicking Retry only
  requeues the job; the worker (a separate process) still has to claim and
  process it. Refresh the job detail page after a few seconds.
- **The error message is generic ("Simulated provider failure").** Expected
  in this simulated environment — no real platform API is integrated yet
  (see "Mock publisher simulation controls" above). A real adapter would
  surface its own provider-specific error code/message through the same
  `errorCode`/`errorMessage` fields, with no UI change required.

### Interpreting analytics (zero-data states)

Job Success Rate, Attempt Success Rate, Retry Success Rate, and Failure Rate
are **percentages of a specific denominator** (e.g. jobs that reached a
terminal state, or attempts that resolved) — when that denominator is zero,
the analytics engine (`computePublishingAnalytics`) returns `null`, and the
UI renders **"No data yet"**, never a misleading "0%" that would read as "a
real result that happens to be zero." Durations (Average Publish Time) use
the existing `"—"` convention for the same reason. Hovering the ⓘ next to
Job/Attempt/Retry Success Rate and Average Publish Time shows exactly what
each figure measures.

## Content Studio and Calendar integration

Content Studio's own status counts and the draft detail page already read
`content_drafts.status`, which the publishing use-cases update in lock-step
at every transition (`publishing` → `published`/`failed`) — so Content
Studio needed no separate data-source change to stay correct.

The Content Studio "Publishing Queue" tab and the Content Calendar both now
join each shown draft to its latest `PublishingJob` (fetched once per
scheduled/published/failed/queued draft) to render the real
`PlatformBadge`, trigger type, and — for a **failed** draft — link straight
to that job's detail/error page instead of the draft editor, since that is
where the actionable retry lives. A **published** draft's calendar/queue
entry is never draggable and carries no write affordance beyond navigation,
satisfying "published items are read-only."

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

## Blotato integration (Sprint 6B)

`resolvePublisher()` in `src/infrastructure/publishers/publisher-factory.ts`
now registers `Blotato*Publisher` classes (`src/infrastructure/publishers/blotato/`)
instead of `Mock*Publisher` — this is the "replacing a mock adapter with a
real provider" step the previous version of this document described as
future work. It shipped exactly the way that section said it would: one
class per platform implementing `PublisherPort`, registered in the same
factory, with nothing else in the worker, use-cases, domain model, or UI
changed.

**The safety switch.** `BLOTATO_LIVE_PUBLISHING_ENABLED` (default `false`,
read once via `src/infrastructure/blotato/blotato-config.ts`) gates the one
thing that matters: whether `BlotatoPublisherBase.publish()` ever calls
Blotato's real `POST /posts` endpoint. While it's `false`:

- Every publish is simulated by the exact same `simulatePublish()` function
  every `Mock*Publisher` used before Sprint 6B
  (`src/infrastructure/publishers/simulated-publish.ts`) — same fixed delay,
  same `dev_simulation_mode` handling, same deterministic
  `mock-<platform>-<n>` external id. Nothing about the worker, retry flow,
  analytics, or dev-simulation UI changed by this switch existing.
- Reading — verifying the API key and listing connected accounts — is
  **not** gated by this flag and always hits the real Blotato API. Those are
  read-only operations with no publishing side effect, so there's nothing
  for the flag to protect against.

**Connecting accounts.** `/settings/publishing` (Publishing Settings) has a
"Test Connection" button, visible to every authenticated staff member but
only actionable by a platform administrator
(`app.is_platform_admin()`, enforced at the RLS layer, not just in the UI).
Clicking it runs `testBlotatoConnection()`
(`core/application/use-cases/blotato.ts`), which:

1. Calls `GET https://backend.blotato.com/v2/users/me/accounts` via
   `HttpBlotatoClient` (`blotato-api-key` header — not a Bearer token).
2. Reports reachability, every connected account, and which of this app's 4
   platforms (LinkedIn, Facebook, Instagram, X — Blotato calls the last one
   "twitter", see `mapBlotatoPlatform`/`toBlotatoPlatform` in
   `core/domain/entities/blotato.ts`) have at least one account connected.
3. On success, upserts every account into `blotato_accounts`
   (platform-wide, not organisation-scoped — see the migration's own
   comment for why) so `BlotatoPublisherBase` can resolve an `accountId` for
   a real publish without requiring another Test Connection click first.

**The live publish path**, exercised only once
`BLOTATO_LIVE_PUBLISHING_ENABLED=true`: `BlotatoPublisherBase` resolves the
most-recently-verified stored account for the job's platform
(`findMostRecentForPlatform`), calls `POST /posts` with that `accountId`,
and treats the returned `postSubmissionId` as success — Blotato publishes
asynchronously and does not return a direct post permalink synchronously, so
`externalUrl` points at the Blotato dashboard (`https://my.blotato.com`),
not a specific post. A platform with no connected account returns a normal
`PublisherResult` failure (`blotato_no_connected_account`), not a thrown
exception — that's an expected, operator-actionable outcome ("connect an
account, then retry"), the same distinction the domain's own `PublisherResult`
comment already draws between expected failures and infrastructure faults.

## Known limitations

- ~~The Content Studio draft detail page currently renders the Publishing
  Actions panel twice~~ — **fixed in Sprint 6A.1**: `ReviewPanel` no longer
  renders its own `PublishingPanel`; the draft page's direct render is the
  sole instance (regression-tested in `tests/review-panel-publishing-panel.test.tsx`).
- A job's `claimedBy` (surfaced in the Progress timeline and Technical
  details as "worker ID") reflects only the **most recent** claim — a retry
  re-claims and overwrites it, so it is not a per-attempt historical record.
  Persisting a true per-attempt worker ID would need a new column on
  `publishing_attempts`, out of scope for a UX-polish sprint.
- The background worker process (`npm run worker:publishing`) does not
  hot-reload — it loads its modules once at startup and keeps running that
  in-memory snapshot. If you edit code that the worker imports (e.g. an
  audit-event description string) while a worker is already running, restart
  it to see the change reflected in newly-created attempts/audit events;
  otherwise you'll see old and new wording mixed in the same job's history,
  which is confusing during a demo but not a data-correctness bug.
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
- **(Sprint 6B)** `blotato_accounts` has no concept of which client
  organisation an account belongs to — Blotato itself has none either.
  `BlotatoPublisherBase` resolves an account by platform only
  (`findMostRecentForPlatform`), so an organisation with two connected
  LinkedIn accounts cannot be disambiguated once live publishing is
  enabled. Only matters once `BLOTATO_LIVE_PUBLISHING_ENABLED=true`, which
  this sprint does not ship.
- **(Sprint 6B)** `BlotatoPublisherBase`'s live path treats a `201` from
  `POST /posts` as an immediate success once the `postSubmissionId` is
  returned. Blotato actually publishes asynchronously — a submission that
  is accepted can still fail downstream (visible at
  `https://my.blotato.com/failed`), and this app has no mechanism yet to
  poll for that outcome and correct a job it already marked Published.
  Building that poll loop was out of scope while live publishing stays off.
