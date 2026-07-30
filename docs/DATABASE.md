# Database

Ten migrations in `supabase/migrations/`, applied in filename order.
Roughly 1,350 lines of SQL, executed and tested from zero. Every table has RLS enabled.

| Migration | Contains |
| --- | --- |
| `…090000_foundation` | Extensions, private `app` schema, shared trigger helpers |
| `…090100_identity` | `profiles`, platform roles, staff activation |
| `…090200_organisations` | `organisations`, `organisation_members`, access helpers |
| `…090300_guardrails` | `organisation_limits` + the tables usage is measured from |
| `…090400_membrain` | Entries, categories, tags, versioning triggers |
| `…090500_membrain_retrieval` | `membrain_search()`, `membrain_context()` RPCs |
| `…090600_usage` | `organisation_usage_snapshot` view, limit enforcement |
| `…090700_storage` | Private media bucket and path-scoped policies |
| `…090800_privileges` | Explicit table grants; `anon` granted nothing |
| `…090900_organisation_lifecycle` | Onboarding date stamped by trigger |

Extensions (`pgcrypto`, `pg_trgm`, `unaccent`) install into a dedicated
`extensions` schema rather than `public`, so application objects and extension
objects never collide.

---

## The `app` schema

A private schema holding authorisation helpers and trigger functions. It is not
exposed through PostgREST, so nothing here is callable over the API.

| Function | Purpose |
| --- | --- |
| `app.is_active_staff()` | Caller has an activated profile |
| `app.is_platform_admin()` | Caller is `owner` or `admin` |
| `app.is_org_member(uuid)` | Caller belongs to the organisation |
| `app.can_write_org(uuid)` | Member with `lead` or `contributor`, or platform admin |
| `app.can_manage_org(uuid)` | `lead`, or platform admin |
| `app.slugify(text)` | Deterministic URL slug |
| `app.touch_updated_at()` | Shared `updated_at` trigger |

The org helpers are `SECURITY DEFINER` with `search_path` pinned. This is
deliberate and load-bearing: a policy on `organisation_members` that queries
`organisation_members` recurses infinitely. Moving the lookup into a definer
function breaks the cycle. Pinning `search_path` prevents the classic definer
privilege-escalation attack.

---

## Identity

**`profiles`** — one row per `auth.users` row, created by the
`app.handle_new_auth_user()` trigger on insert.

Two rules live in that trigger:

- The **first** profile created becomes `owner`, activated. Bootstrapping needs no
  manual SQL.
- Every subsequent profile is `member`, and is activated **only** if its email
  domain appears in `platform_settings.allowed_email_domains`. An outsider who
  somehow obtains an auth row still cannot read anything.

`app.guard_profile_self_escalation()` rejects any update where a user raises their
own `platform_role` or flips their own `is_active`. Role changes must come from
another admin.

`platform_settings` is a singleton (enforced by a one-row check constraint) holding
the domain allowlist, so the policy can be changed without a redeploy.

---

## Organisations

**`organisations`** — the client account. `name`, `slug` (format-checked),
`legal_name`, `industry`, `website_url`, `status`, `brand_colour` (hex-checked),
primary contact fields, `notes`, `onboarded_at`, `created_by`.

`status` is an enum: `prospect` → `active` → `paused` → `offboarded`.
`onboarded_at` is stamped automatically the first time a record becomes `active`.

**`organisation_members`** — which staff work on which account, with a role of
`lead`, `contributor`, or `reviewer`. `app.assign_creator_as_lead()` adds the
creator as `lead` on insert, so an organisation is never orphaned.

**Policies.** Read requires membership or platform admin. Write requires
`app.can_write_org()`. Delete requires platform admin. The last `lead` cannot be
removed — enforced in the use case, since it is a workflow rule about who is
accountable rather than a data-integrity invariant.

---

## Guardrails

**`organisation_limits`** — one row per organisation, provisioned by trigger.

| Limit | Default |
| --- | --- |
| `max_social_accounts` | 6 |
| `max_posts_per_week` | 25 |
| `max_storage_bytes` | 10 GiB |
| `max_ai_tokens_per_month` | 2,000,000 |
| `max_membrain_entries` | 2,000 |

Measured against four real tables — `social_accounts`, `media_assets`,
`scheduled_posts`, `ai_usage_events` — which exist and are empty in Sprint 1.

**`organisation_usage_snapshot`** is a view with `security_invoker = on`,
computing current usage through lateral joins. Because it runs as the caller, the
view cannot be used to read around RLS.

`app.enforce_membrain_entry_limit()` runs `BEFORE INSERT` on `membrain_entries` and
raises `P0001` when the limit is reached. `translateError()` maps that to
`LimitExceededError`, which surfaces as a 429 on the API and an inline form message
in the interface.

---

## MemBrain

### Tables

**`membrain_entries`** — `title`, `summary`, `body`, `category_id`, `status`
(`draft` / `active` / `archived`), `source`, `source_url`, `importance` (1–5),
`version`, `retrieval_count`, `last_retrieved_at`.

`search_vector` is a **generated** `tsvector` column with weighted fields:

| Weight | Field |
| --- | --- |
| A | `title` |
| B | `summary` |
| C | `body` |

Generated, not trigger-maintained, so it cannot drift from the row it describes.
Indexed with GIN; `title` additionally carries a trigram index for fuzzy matching.

**`membrain_categories`** — `app.provision_membrain_taxonomy()` seeds seven system
categories on organisation creation: brand voice, audience, offering, guidelines,
performance, competitors, operations. Every account starts with somewhere sensible
to put things.

**`membrain_tags`** / **`membrain_entry_tags`** — free-form tagging, unique per
`(organisation_id, slug)`. Tag creation is an atomic upsert, so two people adding
the same tag simultaneously cannot produce duplicates.

**`membrain_entry_versions`** — unique on `(entry_id, version)`.

### Versioning

Three triggers, no application involvement:

| Trigger | Timing | Does |
| --- | --- | --- |
| `app.membrain_bump_version()` | `BEFORE UPDATE` | Increments `version` when content changed |
| `app.membrain_record_version()` | `AFTER INSERT/UPDATE` | Writes the version row (v1 on insert) |
| `app.guard_version_history()` | `BEFORE UPDATE/DELETE` | Enforces append-only |

`guard_version_history` permits exactly one thing: setting `change_summary` when it
was previously null. Every other update, and every delete, is rejected. A change
reason can be attached after the fact; a change reason cannot be rewritten.

### Retrieval

Both `SECURITY INVOKER`, so calling them directly with a forged organisation ID
returns nothing — RLS still applies.

**`membrain_search(p_organisation_id, p_query, p_category_ids, p_tag_ids, p_statuses, p_limit, p_offset)`**

`websearch_to_tsquery` for natural phrasing, combined with trigram similarity so
near-misses and typos still match. Returns `ts_headline` output with matched terms
wrapped in `<mark>`, plus a window-function `total_count` so pagination needs one
query rather than two.

**`membrain_context(p_organisation_id, p_query, p_limit)`**

Active entries only. Importance ≥ 4 is always included whatever the query; the rest
is filled by importance-weighted relevance. This is what makes "never mention
competitor pricing" reliable.

**`membrain_mark_retrieved(uuid[])`** — `SECURITY DEFINER`, increments
`retrieval_count` and stamps `last_retrieved_at`. Definer here because telemetry
should not require write permission on knowledge, and it is called through
`Promise.allSettled` so a telemetry failure can never break a retrieval.

---

## Storage

A **private** bucket, `organisation-media`: 500 MB per object, images / video / PDF
only.

Paths follow `organisations/<org_id>/…`. `app.storage_org_id()` parses the
organisation ID out of the object name, and four policies on `storage.objects` gate
select / insert / update / delete on membership of that organisation. A signed URL
is required to read anything; there is no public path to client media.

---

## Regenerating types

`src/infrastructure/supabase/database.types.ts` is hand-maintained and checked in,
so a schema change shows up in code review rather than in a generated diff nobody
reads.

```bash
npm run db:types
```

Two things that file must keep doing, both learned the hard way:

- Row types are **type aliases, not interfaces**. Interfaces have no implicit index
  signature, so they fail Supabase's `Record<string, unknown>` constraint and every
  query silently degrades to `never`.
- **Foreign keys are declared** in each table's `Relationships`. PostgREST resolves
  embedded selects from that metadata; leaving it empty turns every join into
  `never` and switches off the compiler exactly where a data-isolation bug would
  hide.


---

## Privileges

`GRANT` and RLS do different jobs and neither substitutes for the other: a grant
decides whether a role may touch a table at all, a policy decides which rows.

Migration `…090800_privileges` states both explicitly rather than inheriting
Supabase's project-creation defaults. `anon` is granted **nothing** on `public` —
stricter than the platform default, and appropriate for a system with no
unauthenticated surface. An unauthenticated request is refused before RLS is ever
consulted, so a policy mistake costs nothing.

Default privileges are set for future tables, so a table added in a later sprint
cannot ship with a silent privilege gap.

Two tables are further restricted regardless of role: `platform_settings` is
read-only to staff, and `membrain_entry_versions` cannot be deleted by anyone —
belt and braces alongside the append-only trigger.
