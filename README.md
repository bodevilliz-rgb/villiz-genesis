# Project Genesis

The internal operating platform for **Villiz Holdings**.

Genesis is used **exclusively by Villiz staff** to run client accounts. Clients never
receive a login. Every screen is built for an operator managing several organisations
at once, not for an end customer managing one.

The first application on the platform is **Villiz Social Manager**.

---

## Contents

| Document | Purpose |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layer boundaries, dependency rules, and why each was chosen |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Full schema, RLS model, triggers, RPCs |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Supabase + Vercel setup, first user, environment variables |
| [`docs/SPRINT-1.md`](docs/SPRINT-1.md) | Test report, bugs found and fixed, deployment steps |
| [`docs/TESTING.md`](docs/TESTING.md) | How to run the suites and add to them |

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15.5 (App Router, React 19, Server Components, Server Actions) |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` |
| Styling | Tailwind CSS v4, shadcn/ui primitives (new-york) |
| Database | Supabase Postgres with row-level security on every table |
| Auth | Supabase Auth, passwordless magic link, domain-restricted |
| Storage | Supabase Storage, private bucket, path-scoped policies |
| Hosting | Vercel |

---

## Repository layout

```
src/
  app/                      Routes only. Thin: fetch, compose, render.
    (workspace)/            Authenticated shell (sidebar + org context)
    login/  auth/           Unauthenticated surface
    api/                    JSON endpoints for machine consumers
  components/
    ui/                     Primitives. No business knowledge.
    common/                 Cross-feature composites (page header, usage meter)
    organisations/          Feature components
    membrain/               Feature components
  core/                     ← contains ZERO Supabase imports
    domain/                 Entities, value rules, typed errors
    application/
      dto/                  Zod schemas — the trust boundary for all input
      ports/                Interfaces the outside world must satisfy
      use-cases/            Business operations, dependency-injected
  infrastructure/
    supabase/               Clients + hand-maintained Database contract
    mappers/                Database rows → domain entities
    repositories/           Port implementations
  server/
    container.ts            Composition root (request-scoped, React-cached)
    actions/                Server Actions — the only mutation entry points
  lib/                      Framework-agnostic helpers (routes, format, env)
supabase/migrations/        8 migrations, ordered, idempotent-safe
```

**The dependency rule:** `app` → `server` → `core` ← `infrastructure`.
`core` depends on nothing. If you can't unit-test a use case with a plain object
in place of a repository, the boundary has been broken.

---

## Getting started

```bash
npm install
cp .env.example .env.local        # then fill in the values
npx supabase link --project-ref <your-project-ref>
npx supabase db push              # applies all 8 migrations
npm run dev                       # http://localhost:3000
```

You will not be able to sign in until a user exists — see
[first user bootstrap](docs/DEPLOYMENT.md#first-user-bootstrap).

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Anon key. Safe to expose — RLS is the boundary. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Bypasses RLS. Never imported into a client component. |
| `NEXT_PUBLIC_SITE_URL` | server | Magic-link redirect target |
| `ALLOWED_EMAIL_DOMAINS` | server | Comma-separated staff domains, e.g. `villiz.com` |
| `GENESIS_AUTOMATION_API_KEY` | server | Bearer token for the read-only n8n/Awo gateway |

All five are validated by Zod at first use (`src/lib/env.ts`). A missing variable
fails loudly on the first request rather than producing a confusing 500 later.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Local development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` — run before every commit |
| `npm run lint` | Next.js lint |
| `npm run test` | Vitest unit and surface tests |
| `npm run verify` | typecheck + lint + test + build, in that order |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:reset` | Rebuild via the Supabase CLI (needs Docker) |
| `npm run db:reset:local` | Rebuild against a plain Postgres (no Docker) |
| `npm run db:test` | Reset, seed, run all SQL suites, print a report |
| `npm run db:types` | Regenerate `database.types.ts` from the live schema |
| `npm run db:types:check` | Fail if the checked-in types have drifted |

---

## API

One endpoint ships in Sprint 1. It exists so that automation outside the render
tree — n8n workflows, and the Content Studio generation service in Sprint 2 —
reads knowledge through the same use case as the UI, rather than querying tables
directly and drifting from the ranking rules.

```
GET /api/organisations/:orgId/membrain/context
      ?q=<brief>            optional; omit for the highest-importance knowledge
      &limit=12             max entries
      &maxCharacters=24000  budget; truncation is reported, never silent
      &record=true          set false to preview without recording telemetry
```

Authenticated by the operator's own session cookie, so retrieval is subject to
exactly the same RLS as the interface. There is no service-role path.

```jsonc
{
  "organisationId": "…",
  "estimatedTokens": 1840,
  "truncated": false,
  "entries": [{ "id": "…", "title": "Tone of voice", "importance": 5, "version": 3 }],
  "prompt": "…assembled context…"
}
```

---

## Status

**Sprint 1 is verified.** Authentication, Dashboard, Organisation Management,
MemBrain v1.

| Gate | Result |
| --- | --- |
| 10 migrations, replayed from zero | pass |
| 77 SQL assertions across 7 suites | pass |
| 22 Vitest assertions | pass |
| `typecheck` · `lint` · `build` | pass |

Six defects were found by executing the schema — including one that would have
broken every MemBrain search in production. All are documented in
[`docs/SPRINT-1.md`](docs/SPRINT-1.md).

**The HTTP authentication flow is untested** — magic-link issue, callback
exchange and middleware redirects need a manual pass on a real Supabase project.
Everything else about auth is proven at the database layer.

Sprint 2 — Content Studio, Campaign Manager, Publishing Queue, Media Library —
is not started. Navigation entries for it are visible but disabled, so the shape
of the product is legible from day one without pretending the features exist.
