# Publishing Reliability Testing (Sprint 7.1 — Operation Iron Shield)

A repeatable, automated go/no-go check for the publishing engine — run before
every release to prove the pipeline (`PublishingPanel` → `publishing_jobs` →
worker → `PublisherPort`/Blotato) still behaves the way it did the last time
someone verified it by hand.

```bash
npm run reliability:test
```

This is **not** a parallel publishing engine and it is **not** a live-publish
smoke test. Every check calls the same, real, shipped use-cases and classes
the app itself uses (`core/application/use-cases/publishing/*`,
`core/application/use-cases/review`, `core/application/use-cases/content`,
`infrastructure/publishers/blotato/*`) — only the outermost repository/client
ports are faked, the same pattern `tests/*.test.ts` already uses throughout
this codebase. **It never sends a real Blotato post, never requires
production credentials, and never mutates any live social account.**

## Purpose

Before Sprint 7.1, "does publishing still work?" meant manually re-running
the four scenarios from Sprint 6A's browser verification by hand. This suite
turns that into one command with a clear PASS/FAIL/SKIP per guarantee, a
single score, and a single release recommendation — runnable by a person, a
pre-release checklist, or (once adopted) CI.

## Usage

```bash
npm run reliability:test
```

- Exits `0` when the release is safe to ship (`READY` or
  `READY WITH WARNINGS`).
- Exits non-zero (`1`) only when the recommendation is `NOT READY` — i.e. at
  least one MANDATORY check actually failed.
- Runs deterministically, with no interactive prompts, no browser, and (for
  the checks that can run at all without it) no Docker requirement.
- Writes `reports/reliability/latest.json` (machine-readable) and
  `reports/reliability/latest.md` (operator-readable) on every run,
  overwriting the previous run's report.

Optional environment variables:

| Variable | Default | Effect |
|---|---|---|
| `RELIABILITY_CHECK_BLOTATO_CONNECTION` | unset (`false`) | Set to `true` to also run the read-only Blotato connectivity check (needs a real `BLOTATO_API_KEY` in `.env.local`). |

Everything else the suite needs, it detects on its own — see "Environment
requirements" below.

## Test categories

Every check is classified exactly one of three ways, and the console/JSON/
Markdown reports always show the classification next to the result so
nothing MANDATORY can be mistaken for merely advisory:

- **MANDATORY** — failure blocks release (`NOT READY`). These are the
  guarantees this sprint's mission required: draft/review/publishing
  workflow correctness, duplicate prevention, worker claim exclusivity,
  media resolution safety, Blotato payload shape, status polling
  correctness, retry behaviour, scheduling eligibility, worker restart
  recovery, queue analytics formulas, and organisation isolation.
- **ADVISORY** — failure produces a warning (`READY WITH WARNINGS`), never
  blocks release. Currently one check: audit-trail recording on publishing
  transitions.
- **EXTERNAL** — depends on Blotato or Supabase Cloud actually being
  reachable over the network. Never silently required; only run when
  explicitly requested (see the Blotato connectivity section below), and a
  failure here changes `externalDependencyStatus` without touching the Core
  Reliability Score.

## The two tiers of checks

The mission's test matrix (sections A–N) is implemented across two tiers,
both always attempted on every run:

1. **In-memory tier** (`scripts/reliability/in-memory-checks.ts`) — 16
   checks, zero external dependencies. Covers draft/review workflow,
   immediate job creation, duplicate prevention (application-layer), media
   resolution, Blotato payload construction for all 4 platforms, status
   polling (all six scenarios in the mission's section G), retry behaviour,
   scheduled-job eligibility, worker restart recovery, queue analytics
   formulas, organisation isolation (application layer), and audit-trail
   recording. These always run, everywhere, including a bare CI runner with
   no database.
2. **DB tier** (`scripts/reliability/db-tier-checks.ts`) — 4 checks that are
   fundamentally Postgres-level guarantees an in-memory fake cannot honestly
   prove: worker job claim exclusivity (`FOR UPDATE SKIP LOCKED`), worker
   restart recovery against a real stale row, the database's own unique
   constraints rejecting a duplicate publish, and organisation-scoped
   repository queries never leaking another organisation's row. These only
   run against the **local** Supabase stack (never cloud — see "Environment
   requirements"), and cleanly SKIP with a clear reason when it isn't
   running.

Both tiers are still classified MANDATORY — the DB tier existing separately
is an implementation detail about *how* a guarantee is proven, not a
statement that it matters less.

## Environment requirements

- **In-memory tier**: none. No `.env.local`, no Docker, no network.
- **DB tier**: requires `npm run dev:local` (or at least `npx supabase
  start`) to be running, with `.env.local` present and pointing at a
  **local** Supabase instance. The suite reuses the exact same
  local-only-hostname guard `dev-local.js`/`cloud-check.ts`/
  `cloud-bootstrap.ts` already enforce (`localhost`, `127.0.0.1`, `0.0.0.0`,
  `::1`, or a `.local` suffix) — if `NEXT_PUBLIC_SUPABASE_URL` points
  anywhere else, every DB-tier check reports SKIP rather than risk touching
  a shared or production database. If local Supabase is simply not running,
  the same clean SKIP applies.
- **Blotato connectivity (EXTERNAL)**: only requires real credentials
  (`BLOTATO_API_KEY`) when you explicitly opt in with
  `RELIABILITY_CHECK_BLOTATO_CONNECTION=true`. A normal run needs no Blotato
  credentials at all.

No test run ever requires production Supabase or production Blotato
credentials, by design.

## DB-tier fixtures and cleanup

Each DB-tier check creates one uniquely-slugged fixture organisation (and one
draft on it) per run, via `createFixtureOrg()`. A pre-existing, intentional
database guard on `content_draft_versions` (every draft's auto-created
version-1 row is immutable, and `organisations → content_drafts →
content_draft_versions` cascades through it) means the fixture organisation
itself **cannot** be deleted once it has a draft — attempting to do so is
expected to fail with Postgres error `42501`, and the suite treats that
specific, known error as a non-failure. What each check's cleanup actually
guarantees instead: every `publishing_jobs` row it created is updated to a
terminal `cancelled` status before the check returns, so it can never again
be picked up by `claim_next_publishing_job` (`WHERE status = 'queued'`) or
`recover_stale_publishing_jobs` (`WHERE status = 'processing'`) in a later
run. The fixture organisations themselves accumulate harmlessly in the local
database (clearly named `Reliability Suite — <label>`); run `npm run
db:reset:local` if you want to clear them out, same as any other local
fixture buildup.

## Safe Blotato connectivity check (opt-in, external)

`scripts/reliability/blotato-connectivity.ts` — the only check in the suite
that can touch the real network, and only when explicitly requested:

```bash
RELIABILITY_CHECK_BLOTATO_CONNECTION=true npm run reliability:test
```

When enabled, it calls `HttpBlotatoClient.listAccounts()` — `GET
/v2/users/me/accounts` — a read-only call that never publishes anything,
never uploads media, and never mutates any connected account. The API key is
redacted in every line of output. Its result never counts toward the Core
Reliability Score (it's classified EXTERNAL); it only affects
`externalDependencyStatus`. When it isn't requested at all,
`externalDependencyStatus` reads `"not_requested"`.

## Report format

### Console output

A human-readable run of every check with its classification, PASS/FAIL/SKIP,
and duration, followed by the score, mandatory pass count, external status,
and release recommendation — see the example below.

### `reports/reliability/latest.json`

Machine-readable, matching `ReliabilityReport` in
`scripts/reliability/types.ts`: run ID, timestamp, git commit, environment,
total/passed/failed/skipped counts, `coreReliabilityScore`,
`externalDependencyStatus`, `releaseRecommendation`, per-check `results[]`
(name, classification, status, duration, message/detail), and
`knownLimitations[]`.

### `reports/reliability/latest.md`

The same data rendered as a Markdown table plus dedicated Failures/Skipped/
Known limitations sections, meant to be readable by a non-technical
operator deciding whether it's safe to release.

Both report files are regenerated (overwritten) on every run and are
**gitignored** — see `reports/reliability/README.md`. Only `.gitkeep` and
`README.md` are tracked, so the reports directory exists in a fresh clone
without ever committing timestamped run noise.

### Example console output

```
VILLIZ SOCIAL MANAGER
PUBLISHING RELIABILITY REPORT

Environment: isolated-test
Run ID:      <uuid>
Git commit:  <sha>
Started:     <iso timestamp>
Duration:    <n>ms

[PASS] (MANDATORY)  Draft creation —     0ms
[PASS] (MANDATORY)  Submit for review —     1ms
[PASS] (MANDATORY)  Approval transition —     0ms
[PASS] (MANDATORY)  Immediate job creation —     1ms
[PASS] (MANDATORY)  Duplicate publish prevention —     0ms
[PASS] (MANDATORY)  Worker job claim —     0ms
[PASS] (MANDATORY)  Media resolution —     0ms
[PASS] (MANDATORY)  Blotato payload construction —     0ms
[PASS] (MANDATORY)  Provider status polling —     4ms
[PASS] (MANDATORY)  Failure persistence —     0ms
[PASS] (MANDATORY)  Retry publish —     0ms
[PASS] (MANDATORY)  Scheduled job eligibility —     1ms
[PASS] (MANDATORY)  Worker restart recovery —     0ms
[PASS] (MANDATORY)  Queue analytics —     0ms
[PASS] (MANDATORY)  Organisation isolation —     0ms
[PASS] (ADVISORY)   Audit trail on publishing transitions —     0ms
[PASS] (MANDATORY)  Worker job claim (real database exclusivity) —    78ms
[PASS] (MANDATORY)  Worker restart recovery (real database) —    49ms
[PASS] (MANDATORY)  Duplicate publish prevention (real unique constraint) —    38ms
[PASS] (MANDATORY)  Organisation isolation (real database, cross-organisation lookups) —    63ms
[SKIP] (EXTERNAL)   Blotato connectivity (external, opt-in) —     0ms
         RELIABILITY_CHECK_BLOTATO_CONNECTION is not 'true' — external Blotato connectivity was not requested for this run.

Core Reliability Score: 100%
Mandatory checks passed: 19/19
External dependency status: not_requested
Skipped checks: 1
Result: READY
```

If local Supabase isn't running, the 4 DB-tier checks each report `[SKIP]`
with a reason instead of `[PASS]`, `Mandatory checks passed` reads `15/15`
(the DB-tier checks are excluded from the denominator, not counted against
it), and the result is `READY WITH WARNINGS`.

## Interpreting failures

- **A MANDATORY check FAILs**: read `message` in the JSON report (or the
  indented line under the check in the console/Markdown output) — it's a
  plain-English description of exactly what didn't hold, written the same
  way an `assertTrue`/`assertEqual` failure in `tests/*.test.ts` would read.
  Treat this the same as a failing vitest test: do not release until it's
  fixed or you understand why it's a false positive in the check itself.
- **A MANDATORY check SKIPs**: only the 4 DB-tier checks can do this, and
  only because local Supabase wasn't reachable. This is not a pass — it
  means the suite could not prove that particular guarantee this run. The
  recommendation reflects that (`READY WITH WARNINGS`, never a bare
  `READY`).
- **An ADVISORY check FAILs**: worth investigating (the audit trail exists
  for real operator/compliance value) but does not block a release on its
  own.
- **EXTERNAL check FAILs or is SKIPped**: only relevant when you explicitly
  opted into it; check whether it's a real Blotato-side outage or a stale
  local `BLOTATO_API_KEY` before treating it as urgent.

## Release decision rules

```
coreReliabilityScore = mandatoryPassed / mandatoryRan × 100
  (mandatoryRan excludes SKIPped mandatory checks — a SKIP is neutral,
   never counted as a failure against the score)

releaseRecommendation:
  NOT READY            — any MANDATORY check FAILed
  READY WITH WARNINGS  — no MANDATORY FAILed, but at least one MANDATORY
                          was SKIPped, or an ADVISORY FAILed, or the
                          (opt-in) EXTERNAL check FAILed
  READY                 — otherwise (every MANDATORY check ran and PASSed;
                          no ADVISORY failure; no EXTERNAL failure)
```

`npm run reliability:test` exits non-zero **only** for `NOT READY` — a
`READY WITH WARNINGS` run (e.g. local Supabase not running, so the DB tier
SKIPped) still exits `0`, since it does not represent a proven regression,
only an incomplete proof.

## Adding a new reliability check

1. Decide which tier it belongs in: if it needs nothing but faked ports, add
   it to `scripts/reliability/in-memory-checks.ts` next to the existing
   checks (each is a plain `ReliabilityCheck = { name, classification, run
   }`; use `assertTrue`/`assertEqual` from `scripts/reliability/fixtures.ts`
   inside `run()` and throw a descriptive `Error` on failure). If it needs a
   real Postgres guarantee that no fake can honestly stand in for, add it to
   `scripts/reliability/db-tier-checks.ts` instead, wrapped with the
   existing `wrap()` helper so it gets the local-only guard and SKIP
   behaviour for free.
2. Pick the right classification (MANDATORY unless it's genuinely optional
   or unprovable without live external services — see "Test categories"
   above).
3. Export it and add it to that file's `allInMemoryChecks`/`allDbTierChecks`
   array — `scripts/reliability-test.ts` picks up everything in those
   arrays automatically; no other wiring is needed.
4. If your check reveals a genuine gap in the app (not the check itself),
   fix the app using the smallest safe change, exactly like a failing
   vitest test would prompt — the reliability suite tests the existing
   system, it never grows its own parallel implementation of publishing
   behaviour.

## Known limitations

- Worker job claim exclusivity, worker restart recovery, the database's own
  duplicate-publish unique constraint, and organisation isolation are only
  proven against a real Postgres connection when the local Supabase stack
  (`npm run dev:local` / `npx supabase start`) is running — otherwise those
  specific mandatory checks report SKIP with a clear reason, and are
  excluded from the Core Reliability Score rather than silently failing or
  passing.
- Provider status polling for "429 with Retry-After" and "500 provider
  error" verifies that such errors propagate cleanly (never silently
  reported as a false success) — the current architecture has no in-poll
  retry-after/backoff handling inside `BlotatoPublisherBase.pollForFinalStatus`
  itself; recovery for a job stuck mid-flight happens via the worker's
  existing stale-job recovery pass, not an in-poll retry. This is documented
  existing behaviour, not a gap introduced by this suite.
- Organisation isolation is proven at the application/repository layer
  (organisation-scoped queries never return another organisation's row)
  against a real database. It does not additionally simulate a signed
  end-user JWT to exercise RLS policies directly — the service-role client
  this suite uses bypasses RLS by design, the same way the background
  worker itself does.
- Blotato connectivity (`GET /users/me/accounts`) only runs when
  `RELIABILITY_CHECK_BLOTATO_CONNECTION=true` is explicitly set, and only
  ever performs read-only calls — it is never required for a normal run and
  never affects the Core Reliability Score.
- ~~This sprint deliberately does not wire the suite into GitHub Actions~~ —
  **done in Sprint 7.2**: see [docs/CI.md](./CI.md) for the `quality-gate.yml`
  workflow and how to make it a required check via branch protection.

## Worker resilience (the real bug this sprint found and fixed)

While building the DB-tier checks, the underlying worker poll loop
(`scripts/publishing-worker-core.ts`) was found to have exactly the
regression the mission asked to look for: a transient claim error (e.g. the
`Supabase: TypeError: fetch failed` seen once during the cloud pilot) had no
`try`/`catch` around it inside `pollOnce()`. Since `pollOnce()` is invoked as
`void pollOnce(deps)` under `setInterval`, an error thrown from inside it
became an **unhandled promise rejection** — which terminates a Node.js
process by default (Node 15+). One bad network blip could kill the entire
worker process, silently, mid-shift.

**Fix** (smallest safe change, in `scripts/publishing-worker-core.ts`):

- `pollOnce()` now catches any error thrown while claiming a job, classifies
  it (`classifyPollError` — `"network"` for fetch/DNS/connection-reset style
  messages, `"unknown"` otherwise), logs a structured `poll_error` event
  with that category, and waits using a bounded exponential backoff
  (`nextBackoffMs`: starts at `PUBLISHING_WORKER_BACKOFF_BASE_MS` — default
  1000ms — doubling up to `PUBLISHING_WORKER_BACKOFF_MAX_MS` — default
  30000ms) before looping around to poll again. The process is never
  terminated by a poll-loop error.
- The backoff resets to zero the moment a poll succeeds (job claimed or
  confirmed empty), so a transient blip never permanently slows down normal
  operation.
- The wait is implemented with a cancellable `BackoffController` so graceful
  shutdown (`SIGINT`/`SIGTERM`) still interrupts an in-progress backoff wait
  immediately rather than blocking exit.
- A per-job processing error (thrown by `processJob`, not the claim itself)
  is still caught and logged per-job — one bad job cannot corrupt or crash
  processing of the next one, which was already true before this fix and
  remains true after it.
- Programming/configuration errors that should stop startup (e.g. missing
  Supabase credentials) are untouched by this change — only the poll-loop's
  own claim-error path gained resilience; nothing here silently swallows a
  genuine configuration failure.

Proven by `tests/publishing-worker-resilience.test.ts` (10 tests): error
classification, backoff math, the cancellable backoff controller (using
`vi.useFakeTimers()`), and an integration test of `pollOnce()` itself proving
one transient claim failure does not throw, and the very next claim attempt
still runs normally.
