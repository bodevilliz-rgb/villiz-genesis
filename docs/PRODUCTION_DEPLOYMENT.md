# Production Deployment — Vercel (Sprint 8.0)

Villiz Social Manager's web application deploys to Vercel from this
repository's `main` branch. This document covers the web app only — the
background publishing worker is a separate service on Render (see
[RENDER_WORKER.md](./RENDER_WORKER.md)), and Supabase auth URL configuration
is covered separately in [AUTH_PRODUCTION_SETUP.md](./AUTH_PRODUCTION_SETUP.md).

## Locked architecture (this sprint)

```
Web application ................ Vercel
Database / Auth / Storage ...... existing Supabase Cloud project
Background publishing worker .... Render Background Worker
Publishing provider ............. Blotato
```

Nothing here builds a new product feature — this is hosting configuration
for the app exactly as it already exists after Sprint 7.2.

## What already makes this app deployable (Sprint 8.0 deployment audit)

Confirmed by direct code inspection, not assumption:

- `next build`/`next start` are the only build/start commands (`package.json`)
  — no custom pre/postinstall step, no filesystem writes anywhere in `src/`.
- No `next/image` usage anywhere (media renders via signed-URL `<img>` tags)
  — no `images.remotePatterns` configuration is needed.
- `middleware.ts`, `/auth/callback`, and the magic-link `emailRedirectTo`
  all derive their URLs from the real incoming request or from
  `NEXT_PUBLIC_SITE_URL` — never a hardcoded `localhost` value.
- No server action or route handler runs a poll loop or long-running
  process — publishing only ever happens in the separate worker process,
  never inside a Vercel serverless function.
- `/api/dev/session` (the dev-login shortcut) is inert whenever
  `NODE_ENV !== "development"`, which a real Vercel production build always
  is, regardless of `ENABLE_DEV_LOGIN`'s value.
- One real blocker was found and fixed this sprint: `worker-publishing-cloud.ts`
  required an `.env.cloud.local` **file** to exist on disk, which doesn't
  apply to Render (env vars are injected directly) — see
  [RENDER_WORKER.md](./RENDER_WORKER.md) for the fix. This does not affect
  the Vercel web app.
- `package.json`'s `engines.node` is now `>=22.0.0` (was `>=20.11.0`), and a
  `.nvmrc` (`22`) was added — matching this sprint's Node 22 requirement.

## Vercel project configuration

| Setting | Value |
|---|---|
| Framework preset | Next.js (auto-detected) |
| Production branch | `main` |
| Node.js version | 22.x (Project Settings → General → Node.js Version) |
| Build command | `npm run build` (default — no override needed) |
| Install command | `npm ci` (default — no override needed) |
| Output directory | `.next` (default — no override needed) |
| Root directory | repository root (no monorepo subfolder) |

Vercel never runs `npm run dev:local`, `npm run dev:cloud`, any seed script,
or the publishing worker — those are local/Render-only. `npm run build`
alone is sufficient because the production application talks to Supabase
Cloud directly (via `NEXT_PUBLIC_SUPABASE_URL` pointed at the cloud
project), not a local Supabase instance.

## Environment variables

Set every variable in **Project Settings → Environment Variables**, scoped
to **Production** (Preview/Development scopes are out of scope for this
sprint — see [AUTH_PRODUCTION_SETUP.md](./AUTH_PRODUCTION_SETUP.md#step-4--preview-deployment-handling)
on why preview deployments deliberately aren't wired up for authenticated
testing yet).

See [.env.production.example](../.env.production.example) for the full,
commented list of variable names and safe placeholders. Quick reference —
every one of these belongs in Vercel (a ✓ in the Render column means it's
also needed there; see [RENDER_WORKER.md](./RENDER_WORKER.md) for the
worker's own list):

| Variable | Vercel | Render | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | ✓ | | Set only after your first deploy gives you a real URL — see [AUTH_PRODUCTION_SETUP.md](./AUTH_PRODUCTION_SETUP.md). |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ | The production Supabase Cloud project's URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | ✓ | Public by design; the shared Supabase client requires it at worker startup and RLS is the real boundary. |
| `SUPABASE_URL` | optional | | Not read by any code — see the `.env.production.example` comment. Safe to omit. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ | Server-only. Never prefix with `NEXT_PUBLIC_`. |
| `ALLOWED_EMAIL_DOMAINS` | ✓ | | e.g. `villiz.com`. |
| `ENABLE_DEV_LOGIN` | ✓ (`false`) | | Must be `false` in production. |
| `CLOUD_PILOT_SELF_APPROVAL` | ✓ | | Real safety-bypass flag for the single-operator beta — see the `.env.production.example` comment before setting `true`. |
| `BLOTATO_API_KEY` | ✓ | ✓ | Needed by both: Vercel's Test Connection button, Render's actual publish calls. |
| `BLOTATO_ENABLED` | ✓ | ✓ | Master integration switch. |
| `BLOTATO_LIVE_PUBLISHING_ENABLED` | not functionally used | ✓ | Only `BlotatoPublisherBase` (worker-only code) reads this — harmless to set on Vercel too for visibility, but Render is where it actually matters. |

Run `npm run production:check` against whatever you're about to set (e.g.
`vercel env pull .env.production.local` then load it) before deploying —
it fails clearly on anything missing, a leftover localhost URL, or a secret
accidentally exposed through a `NEXT_PUBLIC_` variable. See the command's
own output for exactly what it checks.

## Initial deployment

1. Push this repository to GitHub if it isn't already (it is —
   `origin` is already configured).
2. In the Vercel dashboard: **Add New → Project → Import Git Repository** →
   select this repo.
3. Vercel auto-detects Next.js. Confirm the production branch is `main`
   (Project Settings → Git → Production Branch).
4. Set Node.js to 22.x (Project Settings → General).
5. Add every environment variable from the table above, Production scope.
   `NEXT_PUBLIC_SITE_URL` can be a temporary placeholder for this very
   first deploy (you don't have a real URL yet) — you'll correct it in
   Step 6 immediately after.
6. Click **Deploy**. Once it succeeds, copy the assigned
   `https://<project>.vercel.app` URL, update `NEXT_PUBLIC_SITE_URL` to it,
   and redeploy (Step "Redeployment" below covers how).
7. Complete [AUTH_PRODUCTION_SETUP.md](./AUTH_PRODUCTION_SETUP.md) before
   attempting a real sign-in.

## Redeployment

Vercel redeploys automatically on every push to `main` (this is what the
existing [GitHub Actions Quality Gate](./CI.md) runs alongside, as an
independent check — Vercel's own build is not gated by GitHub Actions
passing, so treat a red Quality Gate as a signal to stop and fix, not
something Vercel will catch for you). To redeploy without a new commit
(e.g. after only changing an environment variable): **Deployments → (latest
Production deployment) → Redeploy**, or `vercel --prod` from a local
checkout with the Vercel CLI linked.

## Custom domain setup

1. **Project → Domains → Add** → enter your domain (e.g. `app.villiz.com`).
2. Follow Vercel's DNS instructions (typically a `CNAME` for a subdomain, or
   `A`/`ALIAS` records for an apex domain) at your DNS provider.
3. Wait for Vercel to show **Valid Configuration** — SSL is provisioned
   automatically once DNS resolves.
4. Complete [AUTH_PRODUCTION_SETUP.md's Step 6](./AUTH_PRODUCTION_SETUP.md#step-6--custom-domain-replacement-procedure)
   to update `NEXT_PUBLIC_SITE_URL` and Supabase's redirect configuration to
   match.

## Rollback using a previous deployment

Every previous deployment stays available and instantly promotable — no
Vercel CLI required:

1. **Deployments** tab → find the last known-good deployment (Vercel marks
   which one is currently in Production).
2. Click its **⋯** menu → **Promote to Production**.
3. Production traffic switches to that build immediately — this is a
   pointer change, not a rebuild, so it's fast and doesn't re-run
   `npm run build`.

This only rolls back the **web app**. It does not affect Supabase data,
migrations, or the Render worker — those are rolled back independently if
ever needed (Supabase migrations are forward-only by design; see
[docs/DEPLOYMENT.md](./DEPLOYMENT.md#rollback) for why).

## Known limitations

- Preview deployments are not wired up for authenticated testing in this
  sprint (see [AUTH_PRODUCTION_SETUP.md](./AUTH_PRODUCTION_SETUP.md#step-4--preview-deployment-handling)).
  UI-only review on preview URLs still works fine.
- `npm run production:check` validates this app's own environment
  variables only — it cannot verify Supabase's dashboard auth
  configuration or Render's environment, both of which are separate manual
  steps documented in their own files.
- Server Actions cap uploads at 2MB (`experimental.serverActions.bodySizeLimit`
  in `next.config.ts`) — pre-existing product behavior, identical on Vercel
  and local development. Larger media (e.g. longer-form video) would need
  this raised in a future sprint; out of scope here.
