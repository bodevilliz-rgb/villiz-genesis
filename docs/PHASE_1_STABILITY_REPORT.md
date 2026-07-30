# Project Genesis — Phase 1 Stability Report

Baseline architectural audit, produced after Sprint 1 (Platform & Client
Management), Sprint 2 (MemBrain), Sprint 3 (Content Studio Foundation), and
Sprint 3.1 (Product Polish). This document is read-only in nature: it was
produced without modifying application code, and it is intended to become the
reference baseline for every Phase 2 decision.

Locked architecture, restated for reference:

```
Awo → Genesis → n8n → Blotato → Social Platforms
```

Genesis is the operating system. Awo is the intelligence layer. n8n is
orchestration. Blotato is publishing. Nothing in this report recommends moving
a responsibility between those layers.

---

## 1. Project Overview

Genesis is a Next.js 15 / React 19 / Supabase Postgres internal platform used
exclusively by Villiz staff to run client accounts. Four modules exist today:

| Module | Maturity |
| --- | --- |
| Platform (auth, staff directory, dashboard, guardrails) | **Complete** |
| Clients (organisation CRUD, team, settings, limits) | **Complete** |
| MemBrain (institutional knowledge base) | **Complete** |
| Content Studio (drafts, workflow, MemBrain-informed briefs) | **Complete**, scoped to end at Approved |
| Campaign Foundation | **Not started** |
| Approval Centre (dedicated cross-client reviewer inbox) | **Not started** — a per-draft approval workflow exists inside Content Studio, which is a different thing (see §7) |
| Publisher | **Not started** — correctly out of scope; Blotato's responsibility |
| Analytics | **Not started** — schema exists (`ai_usage_events`, `scheduled_posts`), no reporting surface |
| Automation (n8n-facing) | **Not started** beyond the one read-only API endpoint built for exactly this consumer |

Everything shipped so far is internally consistent, builds clean, and passes
its full verification suite (`lint` · `typecheck` · `test` · `build`). The
system is small enough that one person can hold the entire architecture in
their head, which is itself a property worth protecting going into Phase 2.

---

## 2. Route Inventory

### Dashboard

| Route | Purpose | Status |
| --- | --- | --- |
| `/` | Redirects to `/dashboard` | Complete |
| `/dashboard` | Portfolio overview: account counts, MemBrain totals, at-risk guardrails, recent activity | Complete |

### Clients

| Route | Purpose | Status |
| --- | --- | --- |
| `/organisations` | Client list, grouped by status (active/prospect/paused/offboarded) | Complete |
| `/organisations/new` | Onboard a new client (platform admin only) | Complete |
| `/organisations/[orgId]` | Client overview: recent MemBrain activity, account record, guardrails, team, knowledge-source legend | Complete |
| `/organisations/[orgId]/team` | Assign/remove staff and roles on this account | Complete |
| `/organisations/[orgId]/settings` | Client record fields + usage limits (admin) | Complete |

### MemBrain

| Route | Purpose | Status |
| --- | --- | --- |
| `/organisations/[orgId]/membrain` | Overview: readiness card, category grid, search/filter, results, AI context inspector | Complete |
| `/organisations/[orgId]/membrain/new` | Add a knowledge entry | Complete |
| `/organisations/[orgId]/membrain/[entryId]` | Entry detail, AI-context status, provenance | Complete |
| `/organisations/[orgId]/membrain/[entryId]/edit` | Edit (creates a new version) | Complete |
| `/organisations/[orgId]/membrain/[entryId]/history` | Immutable version timeline | Complete |

### Content Studio

| Route | Purpose | Status |
| --- | --- | --- |
| `/organisations/[orgId]/content` | Overview: stats, Knowledge Coverage widget, search/filter, draft cards, guided empty state | Complete |
| `/organisations/[orgId]/content/new` | Create a draft | Complete |
| `/organisations/[orgId]/content/[draftId]` | Document editor: title/body, autosave, status workflow stepper, recommendation panel | Complete |
| `/organisations/[orgId]/content/[draftId]/history` | Immutable version timeline (read-only, no restore) | Complete |

### Team / Settings

| Route | Purpose | Status |
| --- | --- | --- |
| `/settings` | The signed-in operator's own profile and platform role | Complete |

### Unauthenticated / Auth

| Route | Purpose | Status |
| --- | --- | --- |
| `/login` | Magic-link sign-in, domain-restricted | Complete |
| `/auth/callback` | Server-side code exchange, open-redirect guarded | Complete |
| `/auth/error` | Auth failure explanation | Complete |

### API (machine consumers)

| Route | Purpose | Status |
| --- | --- | --- |
| `GET /api/organisations/[orgId]/membrain/context` | MemBrain retrieval as JSON, for n8n/automation outside the render tree. Session-cookie authenticated, same RLS as the UI, no service-role path. | Complete |

Nav placeholders (`Campaigns`, `Publishing queue`, `Media library`) are shown
**disabled** rather than linking to nothing — a deliberate, tested pattern
(`routes-and-surface.test.ts` asserts the word "disabled" appears in the nav
component). The Content Studio placeholder that used to sit alongside these
was correctly removed in Sprint 3.1 once the module shipped.

---

## 3. Domain Model Inventory

Five entity files under `core/domain/entities`, zero framework imports in any
of them (verified by inspection, not just by convention).

**`identity.ts`** — `PlatformRole` (owner/admin/member), `OrganisationRole`
(lead/contributor/reviewer). `StaffProfile` is the stored profile; `Actor`
extends it with a computed `isPlatformAdmin` flag — the only place platform
admin status is decided. Three pure permission functions live here:
`canEditOrganisation`, `canWriteContent`, `canApproveContent` (the last added
in Sprint 3 specifically because Reviewer needed a capability MemBrain never
required). No aggregate root — this is a value-object file.

**`organisation.ts`** — `Organisation` is the aggregate root and the
isolation boundary for every other entity in the system. `OrganisationSummary`
is a read-model extension (viewer's role, member count, MemBrain count).
`OrganisationMember` is the join entity between an organisation and a staff
profile, carrying the role.

**`membrain.ts`** — `MembrainEntry` is the aggregate root; `MembrainCategory`
and `MembrainTag` are per-organisation taxonomy value entities;
`MembrainVersion` is immutable history. `MembrainSearchHit` and
`MembrainContextItem`/`MembrainContextPack` are read-models for the two
retrieval surfaces (search UI, AI context assembly) — never the write model.
`MembrainStatus` (draft/active/archived) and `MembrainSource` (six values,
e.g. `client_brief`, `discovery_call`) are enums. `ALWAYS_IN_CONTEXT_THRESHOLD`
is a named constant (importance ≥ 4), not a magic number.

**`content.ts`** — `ContentDraft` is the aggregate root; `ContentDraftVersion`
is immutable history, structurally identical to MemBrain's. `ContentDraftStatus`
(draft/needs_review/approved) and `ContentDraftType` (six values) are enums.
`ContentDraftAwoStatus` (not_requested/ready_for_awo) is a deliberately
orthogonal flag, not a fourth workflow status — a draft can be `draft` and
`ready_for_awo` simultaneously, because preparing work and reviewing it are
different concerns. `ContentGenerationRequest` is a value object: a frozen
record of a creative brief plus the MemBrain context pack assembled for it,
never mutated after creation. `CONTENT_DRAFT_STATUS_TRANSITIONS` is a small
explicit state machine keyed by the `(from, to)` pair rather than by target
status alone — necessary because the same target (`needs_review`) is reached
two ways with two different permission requirements (first submission vs.
reopening an approved draft).

**`usage.ts`** — `OrganisationUsage` and `UsageMetric` are pure read-models
computed from a database view; `toUsageMetrics`/`aggregateUsage` are pure
functions with no I/O.

**Relationships, summarised:**

```
Organisation 1──* OrganisationMember *──1 StaffProfile
Organisation 1──* MembrainCategory 1──* MembrainEntry *──* MembrainTag
MembrainEntry 1──* MembrainVersion (append-only)
Organisation 1──* ContentDraft ──(optional FK)──> MembrainCategory
ContentDraft 1──* ContentDraftVersion (append-only)
ContentDraft 1──* ContentGenerationRequest (each snapshots a MemBrain pull)
Organisation 1──1 OrganisationUsage (computed view, not a stored write model)
```

---

## 4. Repository Inventory

All five repositories are thin Supabase-backed implementations of an
application-layer port; none is called directly from a route or component.

| Repository | Implements | Depends on | Notable gap |
| --- | --- | --- | --- |
| `SupabaseIdentityGateway` | `IdentityGateway` | `profiles`, Supabase Auth session | None found |
| `SupabaseOrganisationRepository` | `OrganisationRepository` | `organisations`, `organisation_members`, `membrain_entries` (count), `profiles` | `delete()` is a real hard delete on the port and repository, but no use-case or route was found calling it — a dormant, ungated capability (see §10) |
| `SupabaseUsageRepository` | `UsageRepository` | `organisation_usage_snapshot` view, `organisation_limits` | None found |
| `SupabaseMembrainRepository` | `MembrainRepository` | categories/tags/entries/entry_tags/entry_versions, `membrain_search`/`membrain_context`/`membrain_mark_retrieved` RPCs, `ai_usage_events` | None found relative to what the UI uses |
| `SupabaseContentRepository` | `ContentRepository` | `content_drafts`/`content_draft_versions`/`content_generation_requests`, `membrain_categories`, `profiles` | No delete/archive method exists at all for drafts — by design this sprint, but a real Phase 2 gap once mistaken drafts accumulate; `listDrafts`' title search is a plain `ILIKE`, with no ranking or index behind it, unlike MemBrain's FTS |

Every repository funnels Postgres errors through one shared
`translateError`/`unwrap` pair (`infrastructure/repositories/errors.ts`),
mapping constraint violations to typed domain errors (`23505` → Conflict,
`42501` → Forbidden, `P0001` → LimitExceeded, `PGRST116` → NotFound). This is
applied with zero exceptions across all five repositories — a genuinely
consistent pattern, not just a convention.

---

## 5. Database Inventory

**Schemas:** `public` (application data) and `app` (private — every
authorisation helper and trigger function lives here, `SECURITY DEFINER`,
`search_path` pinned to `''`, revoked from `public`/`anon`).

**Extensions:** `pgcrypto`, `pg_trgm`, `unaccent`.

**Genesis-owned tables:** `platform_settings` (singleton), `profiles`,
`organisations`, `organisation_members`, `organisation_limits`,
`social_accounts`, `media_assets`, `scheduled_posts`, `ai_usage_events`,
`membrain_categories`, `membrain_tags`, `membrain_entries`,
`membrain_entry_tags`, `membrain_entry_versions`, `content_drafts`,
`content_draft_versions`, `content_generation_requests`. One view:
`organisation_usage_snapshot` (`security_invoker = on`, computed live from six
underlying tables via lateral joins — never cached, never estimated).

**Enums:** `platform_role`, `organisation_role`, `organisation_status`,
`membrain_status`, `membrain_source`, `social_platform`, `connection_status`,
`post_status`, `content_draft_status`, `content_draft_type`,
`content_draft_awo_status`. Notably, `content_draft_status` was deliberately
kept separate from `post_status` — reusing the publishing-queue enum for
Content Studio's workflow would have blurred the exact boundary the
architecture requires (Content Studio ends at Approved; `scheduled` /
`published` / `failed` describe a later stage owned by a different table).

**RLS:** enabled on every `public` table, no exceptions. Policies are built
from a small set of `SECURITY DEFINER` helper functions rather than inlined
per policy: `is_org_member` (any active member), `can_write_org`
(lead/contributor), `can_manage_org` (lead only), `can_approve_org`
(lead/reviewer, added for Content Studio). `anon` is revoked at the GRANT
layer entirely — stricter than Supabase's default — so an unauthenticated
request is refused before RLS is even consulted.

**Triggers:** a consistent pair-of-pairs pattern applied identically to both
MemBrain entries and Content drafts — a bump-version trigger, a
record-version trigger (idempotent via `on conflict do nothing`), and an
append-only guard trigger on the version table that permits exactly one
mutation (attaching a change reason) and rejects everything else, including
`DELETE`. Provisioning triggers seed `organisation_limits` and the MemBrain
taxonomy automatically on organisation creation. A `BEFORE INSERT` trigger
enforces the MemBrain entry limit by raising `P0001` — the limit is enforced
in the database, not merely rendered in the UI.

**Stored procedures / RPC surface (public schema):** `membrain_search`
(ranked full-text + trigram, `ts_headline` snippets, `SECURITY INVOKER` so RLS
still applies even to a forged organisation id), `membrain_context` (the AI
retrieval path — importance ≥ 4 always included, then relevance-filled),
`membrain_mark_retrieved` (telemetry, `SECURITY DEFINER` so read-only
Reviewers can still register a retrieval).

**Versioning:** identical design for MemBrain and Content Studio — the
database writes history, application code cannot forget to. Restore (where it
exists, MemBrain only) moves forward rather than rewriting the past.

**Search:** MemBrain has a genuine search engine (weighted `tsvector`, GIN +
trigram indexes, ranked RPC). Content Studio's draft search is a simple
`ILIKE '%query%'` with no supporting index — functionally adequate today,
architecturally the weaker of the two (see §10, §12).

**Cross-repository structural note:** Genesis and Awo Chief-of-Staff are
linked to the **same** Supabase project. Because the Supabase CLI's migration
ledger is per-project, not per-repository, this Genesis checkout's
`supabase/migrations/` folder contains nine migrations that originated in the
Awo repository (`projects`/`tasks`/`decisions`/`executive_users`, Google OAuth
persistence, the knowledge/meetings/playbooks tables, RLS enablement). This is
not a bug — RLS keeps the two applications' data isolated — but it means the
two codebases' schema histories are physically interleaved with no
repo-level ownership boundary. See §10 and §13.

---

## 6. Permission Model

| Role | Can do today |
| --- | --- |
| **Lead** | Everything Contributor and Reviewer can do, plus: edit the organisation record, manage the team, change nothing platform-wide. Effectively the account owner. |
| **Contributor** | Create and edit MemBrain entries; create and edit Content drafts; submit a draft for review; send a creative brief to Awo. Cannot approve a draft, cannot edit the organisation record or team. |
| **Reviewer** | Read everything. In MemBrain: strictly read-only, cannot write anything — this matches the role's own stated description ("Reads everything and approves work... Cannot edit."). In Content Studio: cannot create or edit draft content, but **can** approve a draft, send it back to Draft, or reopen an Approved draft — a real capability MemBrain has no equivalent of. |
| **Admin** (platform `owner`/`admin`, `isPlatformAdmin`) | Bypasses every organisation-role check. Exclusively theirs: onboarding a new client, changing an account's usage limits, managing platform settings and staff roles/activation. |

**Enforcement is doubled, consistently, everywhere:** RLS at the database
(coarse — org membership, then a write-tier helper) and a `requireRole()`-
style check at the use-case layer (fine — the specific action). Neither layer
is trusted alone; both were found in every write path inspected.

**Inconsistency worth documenting, not fixing:** Reviewer means something
different in the two modules — pure read-only in MemBrain, read-plus-approve
in Content Studio. This is intentional (a knowledge base has no approval
concept; content does) but is easy to mistake for a bug by someone reading
the code cold, since `canWriteContent` alone would suggest Reviewer can never
write anything, and in Content Studio a Reviewer's approval action *is* a
write. Recommend a one-paragraph note in `ARCHITECTURE.md` making this
explicit (see §15).

**Latent risk:** `OrganisationRepository.delete()` is a real, unguarded hard
delete at the repository layer with no corresponding use-case or route found
calling it. It is currently unreachable, not currently exploited, but it is a
loaded gun sitting in the port interface with no safety on it.

---

## 7. Module Status

| Module | Status | Explanation |
| --- | --- | --- |
| Platform | **Complete** | Auth, staff directory, dashboard, portfolio guardrails all built and tested. |
| Clients | **Complete** | Full CRUD, team assignment, per-account limits, status lifecycle. |
| MemBrain | **Complete** | Categories, tagged entries, immutable versioning, ranked search, AI context retrieval, readiness scoring, guided onboarding. |
| Content Studio | **Complete** (for its defined scope) | Draft CRUD, autosave, immutable versioning, status workflow (draft → needs_review → approved), search/filter/cards, deterministic recommendations, MemBrain-informed brief handoff to Awo. Deliberately ends at Approved. |
| Campaigns | **Not Started** | No table, no route beyond a disabled nav placeholder. |
| Approval | **Partial** | A per-draft approval workflow exists and is fully functional (StatusWorkflow, `canApproveContent`, the transition state machine). A dedicated **Approval Centre** — a cross-client queue telling a Reviewer everything currently awaiting them — does not exist. Someone in the Reviewer role today must already know which client and which draft to go check. |
| Publisher | **Not Started** | Correctly out of scope — Blotato's responsibility per the locked architecture. `scheduled_posts`/`social_accounts` tables exist, empty, reserved. |
| Analytics | **Not Started** | `ai_usage_events` is written to on every MemBrain retrieval and could back a real report today; nothing renders it beyond raw guardrail meters. |
| Automation | **Not Started** | The one deliberately-built exception is the read-only `/api/.../membrain/context` endpoint, designed specifically as the seam n8n/Awo would consume — it exists and works, nothing else does. |

---

## 8. UX Audit

**Strengths.** One shared component library (`Card`, `Badge`, `Stat`,
`EmptyState`, `Skeleton`, `Field`) used identically by both feature areas —
no per-module visual fork was found anywhere. Search and filter state lives
in the URL in both MemBrain and Content Studio (shareable, survives a
refresh, rendered server-side) rather than in client state. Empty states are
guided, not generic — MemBrain's onboarding checklist is generated directly
from the same six readiness signals the readiness score itself measures, so
the guidance and the scoring can never drift apart. The Content Studio
workflow stepper gives an at-a-glance answer to "where is this in the
process" that the badge alone didn't. Autosave has an honestly-labelled
state machine (`Saving…` / `Saved just now`), not a silent background action.

**Weaknesses.** Content Studio's search is materially weaker than MemBrain's
— a plain substring match with no ranking, snippet, or fuzzy fallback, next
to MemBrain's full ranked FTS engine. This asymmetry will be noticeable to
anyone who uses both regularly. There is no Approval Centre (§7) — the single
most consequential missing piece of the Content Studio workflow as it exists
today, since "submit for review" currently has nowhere for a Reviewer to
*see* what was submitted except navigating back into that specific client.
`loading.tsx` skeleton coverage is inconsistent: MemBrain and both Content
Studio routes have one, but the dashboard, client list, team, and settings
routes do not. Autosave intentionally does not refresh the version number in
the page header between explicit saves — a correct performance tradeoff
(§12), but one a writer has no visible cue about; a returning-to-this-tab
writer might reasonably wonder why the version badge hasn't moved.

---

## 9. Test Coverage

**51 assertions across 6 files, all passing** (`npm test`, re-run once during
this audit to confirm the current, accurate count rather than rely on memory
of past sprints):

| Suite | Assertions | Covers |
| --- | --- | --- |
| `access-rules.test.ts` | 10 | `canEditOrganisation`/`canWriteContent`/`canApproveContent` |
| `content-draft-status.test.ts` | 9 | The `(from, to)`-keyed status transition state machine |
| `content-recommendations.test.ts` | 10 | The deterministic recommendation rule set |
| `context-pack.test.ts` | 8 | MemBrain AI-context prompt assembly |
| `membrain-readiness.test.ts` | 7 | The six-signal readiness calculation |
| `routes-and-surface.test.ts` | 7 | Page-on-disk inventory, service-role-key containment, no client-side Supabase credential path |

**Design pattern:** every test targets a pure function or a static assertion
about the file tree/source text. There is deliberately no repository or
integration test against a real or fake Postgres anywhere in the suite —
which is a coherent choice given how much of the business logic really is
pure (readiness, recommendations, status transitions), but it does mean RLS
policies, trigger behaviour, and PostgREST embed correctness are verified only
by direct, manual inspection during each sprint, never by an automated gate.

**Untested / risk areas, found during this audit:**

- Content Studio's use-cases (`createDraft`, `updateDraft`, `updateDraftStatus`,
  `createGenerationRequest`) have **zero** direct test coverage — unlike
  MemBrain, whose readiness and context-assembly logic is thoroughly tested,
  nothing exercises Content Studio's permission-gating or validation paths in
  isolation from the UI.
- `routes-and-surface.test.ts`'s page-inventory array does not include a
  single Content Studio route, even though four now exist. The suite's
  `describe("Sprint 2 surface is advertised but inert")` block is also
  testing a premise (Content Studio not shipped) that is no longer true,
  though the specific paths it asserts don't exist (`(workspace)/content`,
  a different path than the real `organisations/[orgId]/content`) still
  correctly don't exist — the test still passes, but for a narrower reason
  than its own description now suggests.
- No test exercises the Supabase repository layer's query construction
  directly (e.g. the new `listDrafts` filter-combination logic in
  `supabase-content-repository.ts`).

---

## 10. Technical Debt

**High**

- **Shared Supabase project with no repo-level migration ownership.**
  Genesis and Awo Chief-of-Staff are two independent applications linked to
  the same Supabase project. The migration ledger is per-project, so this
  Genesis checkout's `supabase/migrations/` folder physically contains nine
  Awo-originated migrations. `npm run db:push` from either repository will
  happily apply either application's pending schema changes. RLS keeps the
  *data* isolated; nothing currently keeps the *schema history* isolated.
  Nothing is broken today, but this is a structural production-stability risk
  that will only get harder to unwind the longer both codebases keep growing
  their own migration sequences inside a shared, undifferentiated ledger.

**Medium**

- **Onboarding documentation is stale and actively misleading.**
  `README.md` and `docs/ARCHITECTURE.md` describe an 8–10-migration,
  "Sprint 2 not started" state with 22 Vitest assertions and a `browser-client`
  Supabase client. None of that matches the current repository: there are 21
  migrations, Content Studio has fully shipped, there are 51 assertions, and
  `browser-client.ts` does not exist (confirmed absent, and its absence is
  itself asserted by `routes-and-surface.test.ts`). A new engineer reading
  these docs today would form an incorrect model of the system before writing
  a line of code.
- **Content Studio's search has no ranking or index**, an asymmetry with
  MemBrain's FTS + trigram engine that will become more noticeable as draft
  volume grows per client.
- **No direct test coverage for Content Studio's use-case layer**, and
  `routes-and-surface.test.ts`'s inventory/assumptions are stale relative to
  shipped routes (see §9).
- **Autosave writes a version row on every 2-second debounce tick.** This was
  a deliberate, documented tradeoff in Sprint 3.1 (the alternative — a
  non-versioned autosave column — would have been a schema change and a new
  architectural layer, both explicitly out of scope that sprint), but nothing
  currently caps or prunes `content_draft_versions`, which will now grow much
  faster during active editing than `membrain_entry_versions` ever does.

**Low**

- `OrganisationRepository.delete()` is a real, callable hard delete with no
  use-case wrapper or permission gate found anywhere upstream of it. Dormant,
  not currently reachable, worth either wiring up properly (admin-gated) or
  removing so the interface doesn't advertise a capability nothing uses safely.
- No archive/delete path exists for Content Drafts at all. By design this
  sprint, but mistaken or duplicate drafts will have no way to be removed
  once Content Studio sees real usage.
- `typedRoutes` is disabled in `next.config.ts` (a documented, reasonable
  choice given dynamic UUID routes) — worth revisiting only if Next.js's
  typed-route support for dynamic segments improves.

---

## 11. Deferred Features

These are intentional, scoped-out decisions, not debt:

- **Campaign Foundation** — no table, no route; a nav placeholder is the only
  trace, correctly marked disabled.
- **Awo Intelligence** — Content Studio already produces a stable, structured
  `ContentGenerationRequest` contract (brief + assembled MemBrain context);
  Awo actually consuming it to generate content is explicitly Awo's future
  work, not Genesis's.
- **Approval Centre** — the per-draft approval workflow exists; a dedicated
  cross-client reviewer inbox does not (see §7, §8).
- **Publishing** — Blotato's domain per the locked architecture. Nothing in
  Genesis should ever talk to a social platform directly, and nothing does.
- **Analytics** — `ai_usage_events` and `scheduled_posts` are schema-ready and
  already being written to (usage events, at least); no reporting layer
  exists on top of them.
- **Scheduling** — `scheduled_posts` exists, empty, reserved for the future
  publishing queue.
- **Automation** — n8n integration beyond the one read-only API endpoint
  built specifically as its consumption seam.

---

## 12. Performance Review

**Query strategy.** Every repository uses targeted `.eq()`/`.select()` chains
with explicit PostgREST foreign-key hints wherever a table has more than one
relationship to the same target (`organisation_members`↔`profiles`,
`content_drafts`↔`profiles`) — a discipline this codebase adopted after
hitting the ambiguous-embed failure mode in a previous sprint, and it has not
regressed since.

**Pagination.** MemBrain search and Content Studio's `listDrafts` both accept
bounded `limit`/`offset` and are called with sane defaults (25–50). The two
"overview" reads (`getMembrainOverview`, `getContentOverview`) fetch up to a
fixed cap (500 and 8 rows respectively) rather than truly paginating — an
explicit, in-code scale assumption, reasonable today, worth revisiting once
any single client's MemBrain or draft count grows materially past that.

**Autosave.** Deliberately skips `router.refresh()` on background-triggered
saves specifically because a refresh would re-run every Server Component data
fetch on the draft page (draft, categories, generation request, MemBrain
readiness, recommendations) on every debounce tick — a concrete, correct,
already-documented performance decision. The accepted cost is a stale version
number in the page header until the next explicit Save or navigation.

**Search.** MemBrain's is server-side, ranked, index-backed, and cheap per
query. Content Studio's is server-side but an unranked, unindexed `ILIKE` —
correct for today's volume, the weaker of the two designs long-term (§10).

**Server Components.** Nearly every route is an async Server Component
fetching directly through the request-scoped container, consistently using
`Promise.all` wherever multiple independent reads are needed. `cache()` wraps
the per-request actor/context lookup so a layout, page, and several
components in the same render share one auth round trip rather than five.

**Loading strategy.** `loading.tsx` Suspense boundaries exist for MemBrain and
both Content Studio routes (added Sprint 3.1). The dashboard, client list,
team, and settings routes still have none — inconsistent coverage, not a
regression, since none of those existed before either.

**Future scaling concerns.** `countDraftsByStatus` issues three separate
head-count queries per page load (one per status) instead of one grouped
query — fine today, a candidate for consolidation at higher volume. The
`ILIKE` draft search will full-scan title text as draft counts grow, with
nothing analogous to MemBrain's GIN/trigram indexes behind it.

---

## 13. Architecture Compliance

**Layering.** `core/` was checked file-by-file across every entity, DTO,
port, and use-case added since Sprint 1 — none imports Next.js, React, or
Supabase. The stated rule (`app → server → core ← infrastructure`) holds with
no exceptions found.

**Dependency direction.** Content Studio's use-cases import MemBrain's
`retrieveContext` directly (`content/index.ts` → `membrain/index.ts`). This is
a same-layer use-case→use-case dependency, not a layering violation, and it is
exactly the intended relationship: Content Studio consumes MemBrain, and
nothing in this codebase or this audit suggests otherwise.

**Ports and repositories.** Every one of the five repositories implements a
port interface declared in `core/application/ports`. No route or component
was found calling Supabase directly anywhere in `src/app` or `src/components`.

**Permissions.** Every write path carries two independent gates — an RLS
policy at the database and a `requireRole()`-style check at the use-case
layer — applied identically across MemBrain and Content Studio with no
exceptions found.

**Design system.** One shared `components/ui` library serves both feature
areas. The one deliberate stretch of an existing contract (reusing
`EmptyState`'s `action` slot to also carry an ordered onboarding list, in
Sprint 3.1) stayed inside the component's existing prop shape rather than
introducing a new one.

**Locked-architecture compliance.** No LLM provider dependency exists
anywhere in `package.json` — verified directly. No direct social-platform
integration exists in Genesis; `social_accounts` is schema-only and unused.
The one HTTP endpoint built for cross-system consumption is read-only and
subject to the same RLS as the UI — it grants n8n/Awo no elevated access.

**One structural tension worth naming under this heading**, distinct from an
architecture *violation*: the shared Supabase project between Genesis and
Awo (§5, §10) means the *database* layer does not yet have the same clean
separation the *application* layer enjoys. This does not cross the
Awo→Genesis→n8n→Blotato responsibility boundary — it is a tooling/ownership
gap one level below that boundary, at the infrastructure layer both
applications happen to share.

---

## 14. Phase 1 Readiness Score

**79 / 100**

| Category | Weight | Score | Why |
| --- | --- | --- | --- |
| Architecture | 25 | 23 | Layering and dependency direction hold with zero violations found. Deducted 2 for the shared-database/migration-ledger structural coupling. |
| UX | 20 | 16 | Strong, consistent core flows with guided onboarding and honest empty states. Deducted 4 for the missing Approval Centre, the MemBrain/Content-Studio search asymmetry, and inconsistent loading-skeleton coverage. |
| Maintainability | 20 | 15 | Clean, consistent patterns, zero TODO/FIXME markers found anywhere in `src/`. Deducted 5 specifically because the top-level onboarding documentation (README, ARCHITECTURE) is stale enough to actively mislead a new engineer about the system's current state. |
| Testing | 15 | 9 | Disciplined, deterministic pure-function coverage (51 assertions, all passing). Deducted 6 for zero repository/integration coverage and a stale surface-test inventory that doesn't know Content Studio exists. |
| Scalability | 10 | 7 | Sound patterns throughout (bounded pagination, batched fetches, explicit FK hints). Deducted 3 for the unranked/unindexed draft search and the fixed-cap overview reads. |
| Security | 10 | 9 | RLS enabled everywhere with no exceptions, defense-in-depth permissions, verified zero service-role leakage (by an actual automated test, not just inspection). Deducted 1 for the dormant, ungated `delete()` method. |

This is a genuinely stable Phase 1. Every deduction above traces to a named,
concrete finding elsewhere in this report — nothing here is a vibe.

---

## 15. Recommended Roadmap

Order only. Nothing below should be read as an instruction to move a
responsibility between Awo, Genesis, n8n, or Blotato.

1. **Documentation refresh** — bring README.md/ARCHITECTURE.md/DATABASE.md in
   line with the actual current system (migration count, module status, the
   removed `browser-client`, current test count). Cheapest possible fix, and
   it prevents every subsequent recommendation from being planned against a
   wrong mental model.
2. **Test-coverage backfill** — direct use-case tests for Content Studio
   (`createDraft`/`updateDraft`/`updateDraftStatus`/`createGenerationRequest`),
   and refresh `routes-and-surface.test.ts`'s page inventory and its
   "Sprint 2... inert" premise to reflect what has actually shipped.
3. **Approval Centre** — a dedicated cross-client reviewer inbox. The single
   highest-leverage missing workflow surface, and a natural, additive
   extension of the approval state machine that already exists — no new
   external dependency, no touch on Awo/n8n/Blotato.
4. **MemBrain-grade search for Content Studio drafts** — ranked FTS/trigram,
   reusing the exact, already-proven MemBrain pattern rather than inventing a
   new one. Closes the one significant UX asymmetry between the two flagship
   modules.
5. **Resolve the shared-Supabase-project migration question** with whoever
   owns the Awo side of this engagement — before either codebase's migration
   sequence grows any longer inside a ledger neither repo fully owns.
6. **Campaign Foundation** — the first genuinely new business module, still
   entirely inside Genesis's own "operating system" responsibility.
7. **Awo Intelligence integration** — real consumption of the
   `ContentGenerationRequest` contract Content Studio already produces. This
   is Awo-side work; Genesis's half of the contract is already stable.
8. **Approval → Publisher handoff contract** — design only. Publisher itself
   stays Blotato's, per the locked architecture.
9. **Analytics surface** — `ai_usage_events` and `scheduled_posts` are
   already schema-ready and, in the first case, already being written to.
10. **Scheduling and n8n-facing Automation** — last, since both depend on a
    real Publisher existing to schedule or automate toward.

---

*Produced by architectural audit. No application code was modified in the
course of this review; the only artefact this audit produced is this
document.*
