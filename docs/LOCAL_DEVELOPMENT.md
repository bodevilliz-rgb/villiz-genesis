# Local Development

This is the single source of truth for running Villiz One on your machine. If
something here is wrong, fix this document in the same change that fixes the
underlying script — it should never drift from what actually happens when you
run these commands.

The objective of this environment is simple: clone the repository, run one
command, and start developing. No manual database surgery, no guessing which
Supabase project you're pointed at, no silent failures that only show up once
you're already deep into a feature.

## Prerequisites

- Node.js >= 20.11.0 (see `engines` in `package.json`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), running
- The [Supabase CLI](https://supabase.com/docs/guides/cli), available via `npx supabase` — no global install required
- Python 3 (only needed if you regenerate database types via `npm run db:types`)

You do **not** need a system-wide `psql`. Every script in this repo that talks
to Postgres does so through the Postgres client already inside the Supabase
CLI's own Docker container, specifically to avoid depending on a local
install that may not exist or may be the wrong version.

## First-time setup

```bash
git clone <repo> && cd villiz-genesis
npm install
cp .env.example .env.local
```

`npm run dev:local` (below) verifies `.env.local` points at the local Supabase
stack before doing anything else, so you can leave the placeholder values from
`.env.example` — Docker hasn't started yet, so there's nothing to point at
until the first run completes and prints real local credentials.

## Starting the environment

```bash
npm run dev:local
```

This is the one command. It:

1. Verifies Docker is running.
2. Verifies `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` points at `127.0.0.1` or
   `localhost` — refusing to start if it looks like a remote Supabase project,
   which is exactly the failure mode ("alternating between remote and local
   Supabase") this project was previously burned by.
3. Starts local Supabase via Docker if it isn't already running (leaves it
   alone if it is — repeated `dev:local` runs don't restart healthy containers).
4. Applies any pending migrations, strictly `--local` — never against the
   linked remote project.
5. Re-applies `supabase/seed.sql` (idempotent: safe to run every time, never
   creates duplicates).
6. Verifies the seeded organisation actually exists in the database before
   declaring success.
7. Starts Next.js on **port 3001**.

It deliberately does **not** reset the database on every run. Your local data
(drafts you've created while testing, for example) survives a normal restart.

When it's ready, you'll see:

```
Local Web App:     http://localhost:3001
Supabase Studio:   http://127.0.0.1:54323
Mail Catcher:      http://127.0.0.1:54324
Staff Account:     Bodevilliz@gmail.com (role: lead)
Client Workspace:  Villiz Pixels (00000000-0000-4000-b000-000000000001)
```

## Shutting down

`Ctrl+C` stops the Next.js dev server. Local Supabase's Docker containers keep
running in the background (so the next `dev:local` is fast) — stop them
explicitly when you're done for the day:

```bash
npx supabase stop
```

## Signing in

Villiz is staff-only: there is no self-service signup, by design. Two ways in:

### The real flow — magic link

On `/login`, enter a `villiz.com` (or, in this local environment, `gmail.com`
— see `ALLOWED_EMAIL_DOMAINS` in `.env.local`) address and request a sign-in
link. Locally, no real email is sent — open **Mail Catcher**
(`http://127.0.0.1:54324`) to see it and click through.

### The local-only shortcut

Waiting on an email, even a fake one, is friction you don't need while
developing. Add this line to `.env.local`:

```bash
ENABLE_DEV_LOGIN=true
```

Restart `npm run dev:local` (or let Next.js pick up the change — it reloads
`.env.local` automatically in dev mode) and `/login` shows an extra button
that signs you in as the seeded staff account
(`Bodevilliz@gmail.com`) with one click, no email round-trip.

This is impossible to ship or trigger by accident:

- It only renders when `process.env.NODE_ENV === "development"` **and**
  `ENABLE_DEV_LOGIN === "true"` are both true, checked server-side. `NODE_ENV`
  is baked into every production build by Next.js itself — this branch cannot
  exist in a shipped bundle regardless of any environment variable.
- `ENABLE_DEV_LOGIN` has no default, is never read on the client, and has no
  `NEXT_PUBLIC_` equivalent, so simply running `next dev` without deliberately
  adding this line leaves it off.

Under the hood (`src/server/actions/dev-auth.ts`), it generates a magic link
server-side via the Supabase admin API and verifies it immediately with
`verifyOtp` — the same GoTrue call a real link click resolves to. No new
session-handling code exists for this shortcut.

## Health checks

```bash
npm run preview:check
```

Verifies, against the **running** local environment (Supabase and Next.js
must already be up — run `dev:local` first): Docker, local Supabase, build
health (`typecheck`), the login page, compiled CSS/design tokens, seeded
organisation and staff membership data, an authenticated session, the
dashboard (both as a signed-in user and confirming it's protected when
signed out), the organisation overview, every mandated route (campaigns,
Content Studio in list/calendar/board views, Review Queue), and an
authenticated API endpoint.

The authenticated checks (dashboard, organisation, routes, API) require
`ENABLE_DEV_LOGIN=true` in `.env.local` — without it, those checks report
that dev sign-in is disabled and skip, rather than failing confusingly. All
other checks run regardless.

**Passing this script is necessary but not sufficient.** It proves the pages
respond and contain expected markers — it does not replace opening a browser
and looking. The browser is the source of truth.

## Manual database reset

`npm run dev:local` never resets data. When you actually want a clean slate
(migrations changed, seed data changed, or the database is in a state you
don't trust):

```bash
npm run db:reset
```

This runs `supabase db reset` — drops the local database, replays every
migration in order, then re-applies `supabase/seed.sql`. It only ever touches
the local Docker-managed database; it has no path to the linked remote
project.

(`npm run db:reset:local` is a different, CI-oriented script — it rebuilds
schemas against a bare Postgres instance outside Docker, for proving
migrations work without the full Supabase stack. It is not part of the normal
local development loop and currently expects a system `psql` at a Linux path,
so it won't run as-is on macOS without `PGBIN` pointed at a local install.)

## Troubleshooting

**"Docker is not running"** — Start Docker Desktop, then re-run `dev:local`.

**".env.local NEXT_PUBLIC_SUPABASE_URL does not point at a local address"** —
Your `.env.local` has a remote Supabase project URL. Copy the local values
`npx supabase status` prints (after `npx supabase start`) into `.env.local`.

**Seed data missing after a reset, or the app throws on missing
tables/columns** — Run `npm run db:reset` to replay migrations and seed data
from scratch. If `preview:check`'s seed-data checks still fail afterwards,
something is wrong with the migration or seed files themselves, not the
environment.

**Magic link / dev sign-in fails with "Email logins are disabled"** — Check
`supabase/config.toml`'s `[auth.email]` section has `enable_signup = true`.
Despite the name, this is the actual switch (confirmed against this Supabase
CLI version) for whether the email provider works at all — including
sign-in for users who already exist. It is unrelated to whether brand-new
accounts can self-register; that's independently blocked by the top-level
`[auth] enable_signup = false`, the application's own
`shouldCreateUser: false`, and the database trigger that leaves any
non-allowlisted-domain profile permanently inactive.

**"Signups not allowed for otp"** — Expected, and correct, for any email that
isn't already an active staff profile. Villiz has no self-service signup.

**Port 3001 already in use** — Something else is already running the dev
server (maybe from a previous session). Stop it, or find and stop whatever
else owns port 3001.

**Stylesheet / Tailwind classes missing in the browser** — Check
`preview:check`'s CSS step first; if it passes but the browser still looks
unstyled, hard-refresh (a stale Next.js dev bundle is the usual cause) before
assuming Tailwind itself broke.

## Recovery: starting completely over

If the local environment is in a state you don't trust and the steps above
haven't resolved it:

```bash
npx supabase stop
docker system prune -f --volumes   # only if you're sure — this removes ALL stopped containers/volumes, not just this project's
npm run dev:local
```

`dev:local` will detect Supabase isn't running, start fresh containers, apply
every migration from scratch, seed, and verify — the same path a brand-new
clone takes.
