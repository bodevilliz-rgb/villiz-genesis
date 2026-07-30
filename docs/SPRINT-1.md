# Sprint 1

**Scope:** Authentication · Dashboard shell · Organisation Management · MemBrain v1
**Status:** Feature-complete and verified. Migrations execute, RLS isolation is
proven, lint and production build pass.

| Gate | Result |
| --- | --- |
| `npm run db:test` (10 migrations from zero + 77 assertions) | pass |
| `npm run db:types:check` (schema drift) | pass |
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 0 warnings |
| `npm run test` (22 assertions) | pass |
| `npm run build` | pass, 18 routes, 102 kB shared JS |

Run all of it with `npm run verify` (plus `npm run db:test` for the database).

---

## How the database was verified

`npx supabase start` requires Docker, which is unavailable in this environment
and could not be installed. Rather than leave the SQL unexecuted, the schema is
proven against a real **PostgreSQL 16.14** server using a platform shim at
`supabase/tests/harness/00_platform_shim.sql`.

The shim creates only what hosted Supabase provisions before user migrations
run: the `anon` / `authenticated` / `service_role` roles, `auth.users`,
`auth.uid()`, and the two `storage` tables our policies key on. Tests then
assume a role with `SET LOCAL ROLE` and set the same JWT claim GUC PostgREST
sets, so **RLS is exercised on the same code path as production** rather than
simulated.

This also removes the Docker dependency from CI.

```bash
npm run db:reset:local   # drop everything, replay all 10 migrations
npm run db:test          # reset, seed, run every suite, print a report
```

`db-test.sh` exits non-zero on any failed assertion, so it wires straight into CI.

---

## Tests performed

**98 assertions. All passing.**

### SQL integration — 77 assertions, 7 suites

| Suite | Assertions | Covers |
| --- | --- | --- |
| `isolation` | 23 | Cross-organisation access, forged IDs, invalid IDs |
| `membrain` | 15 | Creation, retrieval, updating, version history |
| `unauthenticated` | 11 | Anonymous and inactive-staff access |
| `organisations` | 10 | Creation, provisioning, editing, constraints |
| `identity` | 8 | Activation, domain policy, privilege escalation |
| `context` | 6 | Retrieval ranking, archived exclusion, telemetry |
| `limits` | 4 | Guardrail enforcement, usage measurement |

### Vitest — 22 assertions, 3 files

Context-pack assembly and truncation, access-control rules, route surface,
Sprint 2 route absence, and service-role containment.

---

## The two test organisations

`Villiz Pixels` and `Genesis Test Client` exist for exactly one purpose:
proving knowledge cannot cross between clients. Each is led by a different
strategist with no relationship to the other account.

Genesis Test Client holds a deliberately sensitive entry — a commercial pricing
floor — and the suite then attempts to reach it as the strategist for Villiz
Pixels through every available route:

- direct table reads on entries, versions, categories, members and limits
- `membrain_search()` with the other organisation's ID
- `membrain_context()` with the other organisation's ID, with and without a query
- inserts into the other organisation
- updates and renames against the other organisation
- unknown and non-existent organisation IDs

All refused or filtered. **Three control assertions** confirm the data genuinely
exists and is readable by its owner — without those, every isolation pass could
be an empty table telling you nothing.

---

## Bugs found and fixed

Six defects, all found by executing the schema rather than reading it.

### 1. All MemBrain search was broken

`membrain_search()` uses the trigram `%` operator, but pins `search_path = ''`
for security. A bare `%` resolves against nothing, so the function failed **at
call time**, not at create time — it deployed cleanly and would have passed any
review. Every search in the product would have returned an error.

Fixed by qualifying the operator explicitly: `OPERATOR(extensions.%)`.

### 2. The schema granted no table privileges

Every query failed with `permission denied for table organisations`. Migrations
0000–0700 contained three `GRANT` statements between them and not one on a
table. The schema worked on hosted Supabase only because the platform
pre-configures default privileges on `public` at project creation — an
undeclared dependency on a platform default.

Fixed by `20260728090800_privileges.sql`, which grants explicitly and sets
default privileges so later tables cannot ship with a silent gap.

`anon` is deliberately granted **nothing**, which is stricter than Supabase's
own default. Genesis has no unauthenticated surface, so those requests are
refused at the privilege layer before RLS is consulted.

### 3. Onboarding dates were being lost

`onboarded_at` was stamped in the TypeScript repository, in the create path
only. An organisation created as `prospect` and later promoted to `active` — the
normal commercial path — never recorded an onboarding date at all.

Fixed by `20260728090900_organisation_lifecycle.sql`. The trigger stamps on
insert or status change and never overwrites an existing date, so re-activating
a paused client keeps the original. The duplicated TypeScript was deleted.

### 4. The context pack lied to the model

When knowledge existed but exceeded the character budget, the assembled prompt
said *"No knowledge has been recorded for this client yet."* That statement is
false, and it fails hardest in exactly the case that matters most — where the
dropped entry is a legal restriction or a banned claim.

Fixed so the highest-ranked entry is always included, truncated and explicitly
labelled. The model now works from visible partial knowledge instead of invisible
absent knowledge.

### 5. Migrations were not replayable

`create trigger` and `create policy` had no drop guards, so a half-applied
migration left an operator with no safe move. 17 guards added; the full set now
replays cleanly three times over.

### 6. A dead client-side Supabase path

`browser-client.ts` described itself as powering the sign-in form. Sign-in
actually runs entirely through a Server Action, and nothing imported the file.

Deleted. This removes the only code path that could ever have inlined a Supabase
credential into a browser bundle, and a regression test now asserts no component
imports a Supabase package or a `NEXT_PUBLIC_SUPABASE_*` variable.

### Also corrected

The usage view's columns are nullable as far as Postgres can prove — views
cannot express nullability — while the repository assumed otherwise. The mapper
now defaults rather than overriding the generated type with a claim the compiler
cannot check. A meter reading zero is recoverable; one reading `NaN` is not.

Three further failures were **faults in the tests, not the product**, and are
recorded because the corrections matter:

- v1 of an entry is auto-sealed with the reason "Entry created" and can never be
  annotated. Correct behaviour; the test targeted the wrong version.
- A cross-user profile update is *filtered* by RLS rather than rejected, so no
  error is raised and zero rows change. The test now asserts the outcome, since
  "no error was raised" is a dangerously weak thing to assert about security.
- The retrieval counter is incremented by `membrain_mark_retrieved()`, not by
  `membrain_context()`. The test now exercises the function that does the work.

---

## Service role key containment

Verified three ways:

1. **Source**: `SUPABASE_SERVICE_ROLE_KEY` appears in exactly two files —
   `src/lib/env.ts` and `src/infrastructure/supabase/admin-client.ts`. Both are
   `server-only`. A test fails the build if a third file references it.
2. **Bundle**: the production build was run with a sentinel value in place of
   the key. It appears in **zero** files under `.next/static/`, and the variable
   name appears in zero client chunks.
3. **Configuration**: `.env.example` is asserted never to expose it under a
   `NEXT_PUBLIC_` prefix.

No client bundle contains any Supabase credential at all, including the public
anon key, because no client code constructs a Supabase client.

---

## Deliberately not built

**Vector search.** Lexical retrieval is exact, explainable, free per query, and
needs no embedding provider. pgvector fits behind the same two function
signatures when semantic recall becomes the limiting factor.

**Client-facing anything.** Clients do not log in.

**Rich text.** Knowledge is consumed by a model, which does not read formatting.

**Light mode.** Dark only, per the brief. The token system makes a light theme a
variable block rather than a rewrite.

---

## Remaining limitations

**Authentication is proven at the database layer only.** Domain rejection,
activation, first-user bootstrap and self-escalation blocking are all tested. The
HTTP flow — magic-link issue, the `/auth/callback` code exchange, middleware
redirects — is **untested**, because the shim has no GoTrue. This is the largest
remaining gap and needs a manual pass on a real project.

**The shim is not hosted Supabase.** Real `auth.users` carries more columns and
its own triggers, and the real platform's grants are looser than what is now
written. Behaviour should be confirmed once against a hosted project.

**Storage policies are unexercised.** They parse and create correctly; there is
no storage engine locally to test uploads against. The Media Library is Sprint 2.

**No pagination on MemBrain search.** Capped at 50 results. `membrain_search()`
already returns `total_count` and accepts an offset, so only the UI is missing.

**No optimistic concurrency on entry edits.** Two simultaneous editors: last
write wins, and both versions land in history. Recoverable, but a version check
on submit would be better.

**No CI pipeline.** Everything needed is a script; nothing runs them
automatically. Minimum worth wiring: `npm run verify` plus `npm run db:test`.

---

## Exact deployment steps

### 1. Supabase

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push          # applies all 10 migrations
```

Confirm in the dashboard:

- 14 tables in **Table editor**, every one showing **RLS enabled**
- a **private** `organisation-media` bucket in **Storage**

In **Authentication → Providers**: enable Email, disable *Confirm email*,
disable *Enable email signups*.

In **Authentication → URL Configuration**: set Site URL, and add both
`https://<your-domain>/auth/callback` and `http://localhost:3000/auth/callback`.

Set your own SMTP under **Project Settings → Auth → SMTP** before real use;
Supabase's shared sender is rate-limited and lands in spam.

### 2. Vercel

```bash
npx vercel link
npx vercel --prod
```

### 3. Environment variables

All five, for Production, Preview and Development:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page. Safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. **Never** prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>`, no trailing slash |
| `ALLOWED_EMAIL_DOMAINS` | `villiz.com` |

`ALLOWED_EMAIL_DOMAINS` and `platform_settings.allowed_email_domains` must agree.
They are separate deliberately: the database check is the one that matters and
keeps working if an environment variable is misconfigured.

### 4. First user

There is no public sign-up. Supabase dashboard → **Authentication → Users →
Invite user** → your Villiz address. The trigger makes the first profile `owner`
and activates it; everyone after arrives as an inactive `member`.

To activate a colleague:

```sql
update public.profiles set is_active = true where email = 'colleague@villiz.com';
```

Self-promotion is blocked by trigger, so an admin must do this for someone else.

### 5. Post-deploy checks

Nine checks on the live URL, in order:

1. `/` redirects to `/login` when signed out.
2. A magic link to a non-Villiz address returns the same message as a valid one,
   and does not arrive.
3. A magic link to your address signs you in and lands on `/dashboard`.
4. Creating an organisation immediately shows a limits row, seven MemBrain
   categories, and you as `lead`.
5. Creating an entry then editing it produces v2 with your change reason.
6. Restoring v1 produces v3 — not a rewritten v1.
7. The Context Inspector returns every importance-5 entry for an unrelated query.
8. `/api/organisations/<id>/membrain/context` returns 401 in a logged-out window.
9. An organisation you do not belong to returns 404, not 403.

Checks 1–3 are the ones the automated suite cannot cover. Do not skip them.

### Rollback

Vercel: promote the previous deployment. Instant.

Supabase: migrations are forward-only by design. A down migration that drops a
column destroys client data, and the temptation to run one under pressure is not
worth the convenience. Reverse a schema change by writing a new migration.

---

## Sprint 2 proposal

Content Studio first, and only Content Studio. It is the feature that makes
MemBrain pay, and the retrieval endpoint it needs is already live and tested.

Recommended order: **Content Studio → Media Library → Campaign Manager →
Publishing Queue.** Publishing Queue is last because platform OAuth and
per-network rate limits are a sprint in themselves.

Awaiting approval before starting.
