# Architecture

## The one rule

```
app/ ──▶ server/ ──▶ core/ ◀── infrastructure/
```

`core/` imports nothing from Next.js, Supabase, or React. Nothing.

This is enforceable by reading: if `grep -r "@supabase" src/core` returns a line,
the architecture has been broken. Add it to CI when you add CI.

Everything else in this document is a consequence of that rule.

---

## Layers

### `core/domain`

Entities and the rules that are true regardless of storage or transport.

`Organisation`, `Actor`, `MembrainEntry`, `OrganisationUsage` — plus the small
functions that decide things: `canEditOrganisation()`, `canWriteContent()`,
`toUsageMetrics()`, `importanceLabel()`.

Errors are typed and carry HTTP status: `NotFoundError` (404), `ForbiddenError`
(403), `LimitExceededError` (429), `ValidationError` (422). The API route and the
Server Actions both translate them the same way, because they share the same
`isDomainError()` check. There is no `throw new Error("something went wrong")`
anywhere that a user can reach.

### `core/application`

**`dto/`** — Zod schemas. This is the trust boundary. Every Server Action parses
`FormData` through a schema before anything else happens; no unvalidated value
reaches a use case, ever. Field errors come back keyed by field name so forms can
render them inline without a second source of truth.

**`ports/`** — the interfaces the outside world must satisfy: `OrganisationRepository`,
`MembrainRepository`, `UsageRepository`, `IdentityGateway`. Written from the
perspective of the business operation, not the database. `listForActor(actor)` is
a port method; `select("*").eq("id", …)` is not.

**`use-cases/`** — the actual operations. Plain async functions taking an explicit
dependency object:

```ts
export async function createOrganisation(
  deps: { actor: Actor; organisations: OrganisationRepository },
  input: unknown,
) { … }
```

**Why functions and not classes.** In a serverless runtime a class instance lives
for one request and is then discarded; the constructor ceremony buys nothing. A
function with an explicit `deps` parameter is equally testable — pass an object
literal — and makes the dependency list impossible to hide in a field. Nothing
about this choice prevents a later move to classes if a use case ever grows state.

### `infrastructure`

Supabase clients, row → entity mappers, and the repositories that implement the
ports.

Four clients, each with one job:

| Client | Used by | Notes |
| --- | --- | --- |
| `server-client` | RSC, Server Actions, API routes | Cookie-bound, RLS enforced. The default. |
| `browser-client` | The login form only | Sign-in is the only client-side auth call. |
| `middleware-client` | `middleware.ts` | Session refresh only. |
| `admin-client` | Nothing in Sprint 1 | Service role. Exists, documented, unused. |

`repositories/errors.ts` translates Postgres error codes into domain errors —
`23505` → `ConflictError`, `42501` → `ForbiddenError`, `P0001` → `LimitExceededError`,
`PGRST116` → `NotFoundError`. A unique-violation on an organisation slug therefore
reaches the user as "That name is already taken", not as a raw constraint name.

### `server`

**`container.ts`** is the composition root — the single place where interfaces meet
implementations. `getActor()` and `getRequestContext()` are wrapped in React's
`cache()`, so a page that needs the current user in the layout, the header, and
three components performs one database round trip, not five.

**`actions/`** are the only mutation entry points. Each one: parse → authorise via
use case → revalidate → return `ActionState`. They never talk to Supabase directly.

### `app`

Routes are thin. Fetch through the container, compose components, render. Any
route file containing business logic is a bug.

---

## Security model

**Security lives in Postgres, not in React.**

Every table has RLS enabled and policies that reference `auth.uid()`. If the
application layer were deleted entirely and someone connected with the anon key,
they would still see only what they are entitled to see.

The middleware redirect is **not** the security boundary — it is a UX affordance
that saves a user from loading a page that would fail anyway. It is documented as
such in `middleware.ts` so nobody later mistakes it for protection.

Three specific decisions worth knowing:

1. **`auth.getUser()`, never `auth.getSession()`** in any authorisation path.
   `getSession()` reads the cookie without verifying it against the auth server.
   For a display name that is fine; for a permission check it is not.

2. **Unauthorised organisation access returns `notFound()`, not `forbidden()`.**
   A 403 confirms the organisation exists. For an agency whose client list is
   commercially sensitive, "does not exist" and "not yours" should be
   indistinguishable to an outsider.

3. **Sign-in responses are identical** whether or not the address belongs to a
   staff member. Combined with `shouldCreateUser: false`, the login page cannot be
   used to enumerate the team.

---

## MemBrain design

MemBrain is described as an intelligence engine rather than a database because of
three properties a table does not have.

**It versions itself.** Editing an entry fires a trigger that bumps the version and
writes the previous state to `membrain_entry_versions`. Application code cannot
forget to do this, because application code is not doing it. History rows are
append-only: an `UPDATE` is rejected except for attaching a change reason once,
and `DELETE` is rejected outright.

**Restore moves forward.** Restoring v2 does not rewrite history to look like v2
was never superseded — it writes v2's content as v5. The record of what happened
stays true.

**It ranks for retrieval, not for browsing.** `membrain_context()` always includes
importance ≥ 4 regardless of the query, then fills the remaining character budget
with query-relevant entries by weighted relevance. An operator can mark "never
mention competitor pricing" as importance 5 once and know it reaches every
generation.

**Why lexical search and not embeddings.** `tsvector` with weighted fields plus
trigram similarity is exact, explainable, costs nothing per query, and requires no
embedding provider or backfill job. When semantic recall becomes the limiting
factor, pgvector slots in behind the same two function signatures with no change
above the infrastructure layer. Starting with embeddings would have meant paying
that complexity before knowing it was needed.

**The Context Inspector** renders the assembled prompt in the interface before any
generation happens. This is the trust mechanism for the entire product: a
strategist can see that the model has the right knowledge — or see that it does
not — instead of discovering the problem in a draft the client rejects.

---

## Guardrails

Usage is computed by `organisation_usage_snapshot`, a `security_invoker` view over
the real tables, so the numbers a user sees are subject to that user's RLS.

`social_accounts`, `media_assets`, `scheduled_posts` and `ai_usage_events` are
created empty in Sprint 1 precisely so the dashboard can show a **true zero**
rather than a hard-coded one. When Sprint 2 begins writing to them, the meters
start moving with no dashboard change.

The MemBrain entry limit is enforced by a `BEFORE INSERT` trigger raising `P0001`,
which the error translator turns into `LimitExceededError`. Rendering a limit is
not enforcing it.

---

## Design language

Dark only. One accent (`--primary: #ff6a1f`). One signature element: a hairline
orange rail on the active navigation item. One 120ms fade, disabled entirely under
`prefers-reduced-motion`.

Copy is treated as design material. Errors state what happened and what to do next
and do not apologise. Empty states say what to do first — "Start with the things a
new starter would get wrong" — rather than "No items found".

Focus rings are always visible, never removed. Every interactive element is
reachable and operable from the keyboard.
