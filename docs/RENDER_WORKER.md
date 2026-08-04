# Render Background Worker — Publishing Pipeline (Sprint 8.0)

The background publishing worker (`scripts/publishing-worker-core.ts`, run
via its cloud entrypoint `scripts/worker-publishing-cloud.ts` /
`npm run worker:publishing:cloud`) deploys to Render as a **Background
Worker** — no redesign, no new logic, the exact same worker that already
runs locally via `npm run worker:publishing:cloud` against `.env.cloud.local`.
Render is simply a second, always-on place to run that same command,
supplying its configuration through real environment variables instead of a
dotenv file.

## Why a Background Worker, not a Web Service

- It never needs to accept an inbound HTTP request — it only polls
  Supabase for due `publishing_jobs` and calls out to Blotato. Render's
  Background Worker service type is built for exactly this: **no public
  URL, no port binding requirement.**
- It is the *only* process, anywhere, that ever moves a job from
  `queued → processing → published/failed` (see
  [PUBLISHING_ENGINE.md](./PUBLISHING_ENGINE.md)) — Vercel never runs it,
  and must never be asked to (a poll loop cannot live inside a serverless
  function request).

## Deployment configuration

`render.yaml` in the repository root defines the service (Render calls this
a "Blueprint" — importable directly, or used as the source of truth if you
create the service by hand in the dashboard instead):

| Setting | Value |
|---|---|
| Service type | Background Worker |
| Repository | this same GitHub repository |
| Branch | `main` |
| Runtime | Node (pinned to 22 via the `NODE_VERSION` env var, matching `package.json`'s `engines.node` and this repo's `.nvmrc`) |
| Build command | `npm ci` |
| Start command | `npm run worker:publishing:cloud` |
| Auto-deploy | on |

If you prefer to create the service by hand in the Render dashboard instead
of importing `render.yaml` directly: **New → Background Worker** → connect
this repository → set Branch to `main` → Build Command `npm ci` → Start
Command `npm run worker:publishing:cloud` → add the environment variables
below.

## Required environment variables

Set these directly in Render's dashboard (Service → Environment) — **never
in a committed file.** `render.yaml` marks every secret `sync: false` for
exactly this reason: Render will prompt for a value rather than accept one
from the file.

| Variable | Required | Notes |
|---|---|---|
| `NODE_VERSION` | yes | `22` — set as a literal in `render.yaml`, no secret. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | The **production** Supabase Cloud project URL. Must be `https://` and not `localhost`/`127.0.0.1`/`*.local` — the worker refuses to start otherwise (see "Safety guards" below). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | The production project's public anon key. The shared Supabase client validates it during worker startup; RLS remains the security boundary. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only. Same key used by Vercel's server actions — see [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md). |
| `BLOTATO_API_KEY` | yes (to actually publish) | From https://my.blotato.com. Without it, `BLOTATO_ENABLED` has nothing to authenticate with. |
| `BLOTATO_ENABLED` | yes | `"true"` to turn the integration on at all. |
| `BLOTATO_LIVE_PUBLISHING_ENABLED` | yes | The master safety switch. `"false"` = every publish is simulated exactly as before Sprint 6B, regardless of anything else. Only set `"true"` when deliberately ready to go live — see [HOSTED_SMOKE_TEST.md](./HOSTED_SMOKE_TEST.md). |

Variables the worker does **not** need (these are Vercel/UI-only concerns —
see [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)'s variable table
for the full split): `NEXT_PUBLIC_SITE_URL`, `ALLOWED_EMAIL_DOMAINS`,
`ENABLE_DEV_LOGIN`, `CLOUD_PILOT_SELF_APPROVAL`.

## Safety guards already in place (unchanged by this sprint)

`worker-publishing-cloud.ts` — the entrypoint Render actually runs — refuses
to start at all if:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or
  `SUPABASE_SERVICE_ROLE_KEY` is missing.
- `NEXT_PUBLIC_SUPABASE_URL` isn't a valid `https://` URL.
- `NEXT_PUBLIC_SUPABASE_URL` looks local (`localhost`, `127.0.0.1`, `0.0.0.0`,
  `::1`, or a `.local` hostname) — this worker will never quietly connect
  to a local Supabase instance.

**No local `.env*` fallback exists for this entrypoint on Render.** The one
change made this sprint (see the deployment audit in
[PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)) was making the
optional `.env.cloud.local` **file** load conditional on that file actually
existing on disk — Render never creates one, it injects environment
variables directly into the process, and the script's required-variable and
localhost-rejection checks run identically either way. Local cloud-pilot
use (a real `.env.cloud.local` file) is completely unaffected.

## Graceful shutdown

Already implemented in `publishing-worker-core.ts`, unchanged by this
sprint: `runWorker()` registers `SIGINT`/`SIGTERM` handlers that stop
claiming new jobs, cancel any in-progress poll backoff wait, and let the
process exit cleanly. Render sends `SIGTERM` before stopping or restarting
an instance (deploys, manual restarts, scaling), so this matters in
practice, not just in theory.

## Automatic restart on crash

This needs no extra configuration — restarting a crashed instance is
Render's own default platform behavior for every service type, background
workers included. Combined with this worker's own poll-loop resilience
(Sprint 7.1 — a transient Supabase claim error is caught, logged, and
retried with bounded backoff rather than crashing the process at all; see
[RELIABILITY_TESTING.md](./RELIABILITY_TESTING.md)), a full process
restart should only ever be needed for something more serious than a
transient network blip.

## Health / heartbeat strategy

A Background Worker has no public URL for Render to health-check via HTTP,
so "is it alive" is answered by its own **logs**, not a status endpoint:

- On every claim attempt, success, failure, or poll error, the worker logs
  a structured JSON line (`log()` in `publishing-worker-core.ts`) — e.g.
  `poll_error`, `job_processing_error`. Render's **Logs** tab is the
  primary place to confirm the worker is actually polling, not just
  "Running."
- A practical heartbeat proxy that needs no new code: **queue movement**.
  If a job you queue from the hosted app sits in `queued`/due status for
  longer than one poll interval (`PUBLISHING_WORKER_POLL_INTERVAL_MS`,
  default 2s) without moving to `processing`, the worker either isn't
  running or has lost its connection — check Render's Logs and the
  service's Events tab (which records every deploy, restart, and crash).
- `npm run reliability:test`'s DB-tier checks (worker job claim, worker
  restart recovery) prove the *logic* is correct; they intentionally only
  run against local Supabase and are not a substitute for watching the real
  Render service's logs after deployment — see
  [HOSTED_SMOKE_TEST.md](./HOSTED_SMOKE_TEST.md) for the actual hosted
  verification steps.
- Adding a dedicated `/health` endpoint would require turning this into a
  Web Service (a public port) purely to serve a healthcheck — a bigger
  change than this sprint's mission calls for ("do not redesign the
  worker"). Log-based observability was judged sufficient for a beta pilot
  with one background worker instance; a dedicated heartbeat table/endpoint
  is a reasonable Sprint 8.x follow-up if the pilot grows.

## Known limitations

- No dedicated heartbeat/health endpoint (see above) — logs and queue
  movement are the only current signals.
- Render's `starter` plan (set in `render.yaml`) is a reasonable default
  for a single-organisation beta; revisit sizing before onboarding
  additional client organisations.
- This worker still only ever registers Blotato platform adapters
  (LinkedIn, Facebook, Instagram, X) — no change here, and no new platform
  is introduced by this sprint.
