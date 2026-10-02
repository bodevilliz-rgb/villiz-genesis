# GEN-PUB-A — One-Message Intake Contract (Operator Runbook)

**Contract version:** 1.0 · **Branch:** `feat/awo-intake-contract` · **Status:** drafted, pending independent QA

The owner states **one message** ("post client X flier 14 Oct" / "schedule fliers
from Drive folder Y 2026-10-21 09:15") and Awo maps it to a governed Genesis
publishing operation without improvising. This runbook is the operator-facing
half of the contract; the machine half is the deterministic parser at
`src/core/application/use-cases/intake/owner-directive.ts` with round trips in
`tests/owner-directive-intake.test.ts`.

---

## 1. What one message must contain

| Field | Grammar | Default when absent |
| --- | --- | --- |
| Client | `client <name>` — matched against the kept index (multi-word OK) | required for attribution; folder→client index can infer it |
| Asset | `content "<name>"` (verbatim owner text) or `from [Drive] folder <name>` | none — **stop** (`no_resolved_asset`); the bare noun ("flier") resolves via the client-asset index lane; a trailing `platforms:` clause or preposition-platform tail never becomes folder data — the platform choice survives |
| Platforms | `on IG`, `and TikTok`, `to Facebook`, `via LinkedIn`, or `platforms: instagram, tiktok` | Instagram (the GEN-LIVE-1 certified lane) |
| Date/time | `14 Oct`, `Oct 14`, `14 Oct 2027`, `2026-10-14`, `tomorrow`, `today`, `tonight`; optional `HH:MM` or `H.MM[am/pm]` | date missing → **stop**; time missing → **09:00 GMT** |
| Caption | inside `content "…"` = provided verbatim; otherwise drafted-for-approval | drafted (`requiresApproval`) |
| Hashtags | `kept hashtag set: a, b` line overrides the kept set for this message | owner-kept set |
| Declarations | owner statement overrides at parse time | GEN-LIVE-1 precedent (`isAiGenerated: true`, `isYourBrand: true`, `isBrandedContent: false`) |

All times are interpreted in **GMT** (stored as the `Etc/GMT` zone label +
UTC-normalised instant) — the standing owner default. DST-safe zones can be
supplied as explicit IANA names by the asset-resolution lane; the intake
grammar itself stays GMT.

## 2. The five owner gates (what is NOT automated)

1. **Client ↔ asset mapping** — the kept index (`client → folder/content set`)
   is recorded once by the owner; a message naming an unmapped client or
   folder stops with `unknown_client` and names exactly the decision to make.
2. **Caption approval — ONCE per campaign asset**, stored on the campaign
   card and **reusable for every slot of that asset**. An in-message approval
   phrase (`approved to send`, `send it`, `go ahead`, `yes send`, `confirmed`)
   is recorded at parse time and filed to the campaign card at intake
   reporting time. A drafted caption without a stored/in-message approval
   stops with `caption_requires_approval`.
3. **AI / brand declarations** — TikTok hard-requires all three per post
   (preflight blocks live publish on any null; `platform-policy.ts`). The
   GEN-LIVE-1 certified-lane precedent supplies the starting values; any
   content that differs (human-made, paid partnership) must be declared by
   the owner before its TikTok publish (`declaration_statement` gate).
4. **Publishing go** — every real submission uses the standing GEN-LIVE-1
   authority pattern: the owner go toggles execution mode (`live` vs
   `simulation`) per batch at publish time. The intake contract never
   publishes; it produces a stop-free parsed job that then enters that lane.
5. **Asset resolution** — Drive folder / asset-index references become
   resolved media URLs by the asset-resolution lane (GEN-PUB-B scope). Until
   that lane fills `resolvedAssetIds`, `isSchedulable` stays false — a parsed
   message alone never reaches publishing.

## 3. Awo's governed path (what happens after the message)

```
owner message
  → parseOwnerDirective (pure, idempotent — this contract)
       stops? → surface each stop's pendingOwnerDecisions verbatim; HALT
       stop-free? → asset-resolution lane → resolvedAssetIds
                    → caption (drafted? → owner approval once per asset)
                    → job build via createScheduledPublishingJob /
                      createImmediatePublishingJob inputs
                    → GEN-LIVE-1 publishing go (execution mode authority)
                    → worker + preflight + settlement (existing engine)
```

Mapping notes (no schema rewrites):
- `schedule.scheduledFor` → `createScheduledPublishingJob` input `scheduledFor`
  (UTC-normalised instant; past dates refused by the use case itself).
- `schedule.timezone` → input `timezone` (`Etc/GMT` default).
- `platforms` → `PublishingPlatform` values, guarded by `isPublishingPlatform`.
- `hashtags.<platform>.final` → draft's first-class `hashtags` array —
  **never** baked into the caption text (composePublishedText appends
  first-class hashtags only; IG's limit is enforced by the provider-verified
  preflight).
- `aiBrandDeclarations.<platform>` → `isAiGenerated` / `isYourBrand` /
  `isBrandedContent` persisted verbatim per job; null would block TikTok.
- `contentApproval` → filed once on the campaign card; slots of the same
  asset reuse it by reference.

## 4. Stop codes and the decisions they carry

| Stop code | Owner decision that clears it |
| --- | --- |
| `unknown_client` | Add the client (or folder→client mapping) to the kept index |
| `no_resolved_asset` | Provide `content "…"` / a Drive folder, or extend the client-asset index so the noun alone resolves |
| `ambiguous_asset` | Re-send with either quoted content or a Drive folder, not both |
| `unknown_platform` | Use one of Instagram / Facebook / LinkedIn / X / TikTok. Fires when a name in a `platforms:` clause is unknown; a message with no platform words at all defaults to Instagram — bare words elsewhere are never treated as platforms (a client may be named "X") |
| `unparseable_date` | Give a date phrase the grammar supports (or a valid calendar date) |
| `past_date` | Future date/time — for year-less past dates, state the year explicitly |
| `caption_requires_approval` | Owner approves the campaign content once, on the campaign card |

Every stop carries `pendingOwnerDecisions` verbatim — Awo surfaces them as-is;
it never invents a resolution.

## 5. Worked round trips (proven by tests)

1. `post client X flier 14 Oct` → client **X** (index-mapped), asset noun
   **flier** (client-asset-index lane), platforms **[instagram]** (default,
   and a client named "X" is never mistaken for the X platform), schedule
   **2026-10-14 09:00 GMT**, IG kept set **auto-trimmed to 5** keeping the
   head of the owner-ordered set, GEN-LIVE-1 declarations — stops on
   unresolved asset + missing content approval (fail-closed).
2. `schedule fliers from Drive folder Y 2026-10-21 09:15` → folder **Y**
   (trailing date/time never swallowed by the folder name), explicit
   **09:15 GMT**, drafted captions awaiting the once-per-asset approval;
   an unmapped folder stops with `unknown_client`; an indexed folder with a
   card approval parses **stop-free**.
3. `post content "Grand Opening Flier — October" for client Alpha Homes on
   IG and TikTok 2026-10-15 18:00 approved to send …` → verbatim content
   (provided caption, approval by construction), dual platforms, explicit
   18:00 GMT, in-message approval recorded, IG trimmed / TikTok kept rich —
   stop-free before asset resolution.

## 6. Operator notes

- **Idempotence**: same message + same clock + same kept set + same index =
  identical contract. Re-sending a message never double-schedules; the
  use-case idempotency key still gates job creation.
- **No improvising**: anything the grammar cannot resolve is a **stop**, and
  a stop's decision text is what Awo sends back to the owner.
- **Fail-closed everywhere**: no invented limits (platforms without verified
  hashtag limits keep the full set), no default declarations, no silent
  year rolls, no publish without the owner go.
- **Schema preservation**: certified migration files are hash-locked by
  `tests/publishing-schema-drift.test.ts` — this contract adds zero
  migrations.