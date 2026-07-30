# Testing

Two suites, two purposes.

```bash
npm run db:test   # SQL: schema, triggers, RLS, isolation      (77 assertions)
npm run test      # TypeScript: pure logic and surface          (22 assertions)
npm run verify    # typecheck → lint → test → build
```

Both exit non-zero on failure and are safe to wire into CI.

---

## Why the SQL suite exists

Security in Genesis lives in Postgres. A test suite that only exercises
TypeScript would prove nothing about the thing actually protecting client data.

`supabase/tests/` runs against a real Postgres. Each suite assumes an identity
with `SET LOCAL ROLE authenticated` and sets the same JWT claim GUC that
PostgREST sets per request, so policies are evaluated exactly as in production —
not simulated, not mocked.

### No Docker required

`npx supabase start` needs Docker. `supabase/tests/harness/00_platform_shim.sql`
creates the small surface hosted Supabase provides ahead of user migrations —
three roles, `auth.users`, `auth.uid()`, two `storage` tables — so the schema can
be proven anywhere Postgres runs.

The shim must mirror the real platform's shape. If it drifts, the tests stop
meaning anything.

```bash
export PGURL="postgresql://postgres@localhost:54322/postgres"
export PGBIN=/usr/lib/postgresql/16/bin   # if psql is not on PATH
npm run db:test
```

### Layout

| File | Suite |
| --- | --- |
| `harness/00_platform_shim.sql` | Supabase emulation |
| `harness/01_assert.sql` | `test.ok` / `test.eq` / `test.throws` / `test.act_as` |
| `10_seed.sql` | Fixtures: four users, two organisations |
| `20_identity.sql` | Activation, domain policy, escalation |
| `30_organisations.sql` | Lifecycle, provisioning, constraints |
| `40_membrain.sql` | Versioning, append-only history, search |
| `50_isolation.sql` | Cross-organisation access |
| `60_unauthenticated.sql` | Anonymous and inactive staff |
| `70_limits_context.sql` | Guardrails, context ranking |

`test.ok` and `test.eq` are `SECURITY DEFINER` so results record under any role.
`test.throws` is deliberately **not** — it executes the statement under test, and
running that as the owner would bypass the very RLS being proven.

---

## Writing a good security test

Two rules, both learned by getting them wrong.

**Assert the outcome, not the mechanism.** RLS usually *filters* rather than
rejects: a forbidden `UPDATE` matches no visible row, changes nothing, and raises
no error. A test that only checks "an error was thrown" will pass against a
policy that has been deleted.

```sql
-- Weak: passes even with no policy at all.
select test.throws('isolation', 'cannot rename', $$update ...$$);

-- Strong: asserts nothing changed.
update public.organisations set name = 'Hijacked' where id = <other org>;
select test.eq('isolation', 'cannot rename another organisation',
  (select count(*)::int from public.organisations where name = 'Hijacked'), 0);
```

**Always include a control.** Every isolation assertion would pass against an
empty table. `50_isolation.sql` ends by proving, as the other strategist, that
the data genuinely exists and is readable by its owner. Without that, the suite
proves only that you queried nothing.

---

## The TypeScript suite

`tests/` covers what is pure and worth protecting:

- **`context-pack.test.ts`** — budget arithmetic, truncation reporting, and the
  guarantee that a full budget never presents as "this client has no knowledge".
- **`access-rules.test.ts`** — who may edit an organisation and who may write
  knowledge, for every role including non-members.
- **`routes-and-surface.test.ts`** — every route has a page, no Sprint 2 route
  exists yet, and no Supabase credential can reach a client bundle.

Use cases take an explicit dependency object, so testing one needs a plain object
literal rather than a mocking framework:

```ts
await createOrganisation({ actor, organisations: fakeRepository }, input);
```

---

## Schema drift

`database.types.ts` is generated, not hand-written.

```bash
npm run db:types         # regenerate from a running database
npm run db:types:check   # fail if the checked-in file has drifted
```

`supabase gen types` requires Docker even when given a connection string, so
`scripts/gen-db-types.py` introspects the same catalogues and emits the same
contract. Two properties it must preserve, both learned by breaking them:

- Row types are **type aliases, not interfaces**. Interfaces have no implicit
  index signature, fail Supabase's `Record<string, unknown>` constraint, and
  silently degrade every query to `never`.
- **Foreign keys are declared.** PostgREST resolves embedded selects from that
  metadata; an empty `Relationships` array turns every join into `never` and
  switches off the compiler exactly where an isolation bug would hide.

---

## What is not covered

**The HTTP authentication flow.** Magic-link issue, the `/auth/callback`
exchange and middleware redirects need a real Supabase project. Checks 1–3 in the
Sprint 1 deployment guide exist for this reason.

**Storage policies.** They create correctly; there is no local storage engine to
upload against.

**Rendering.** No component tests. Pages are thin by design, and the logic worth
protecting sits in `core/`, which is covered.
