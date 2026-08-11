# AWO Engagement Intelligence — learning loop, operations and publish-to-learn

## Outcome

AWO now separates two questions that Sprint 10 presented as one confidence number:

- **Brand fit** measures how well a recommendation follows active MemBrain evidence. It remains capped at 70.
- **Performance confidence** is deterministic, based on comparable published posts, and is unavailable below the minimum sample.

Recommendations add a required objective (`awareness`, `engagement`, `enquiries`, or `bookings`) and creative guidance grounded in attached-media metadata. Genesis does not claim pixel-level visual inspection. Operators can select or dismiss a recommendation; that decision is recorded as an immutable event and never publishes content.

## Learning lifecycle

1. A Contributor or Lead generates a recommendation for a saved social draft.
2. The operator chooses **Apply to draft**. Genesis shows the current and replacement payload before confirmation.
3. One database transaction updates the caption and hashtags, creates a new draft version and records the exact recommendation attribution. A partial apply is impossible.
4. The existing review and publishing workflow remains the only route to publication.
5. After Blotato confirms the post, the collector reads `GET /v2/posts/{id}/analytics` and stores immutable provider snapshots.
6. The operator may add append-only enquiry, booking and GBP revenue snapshots for the exact published attempt.
7. A later recommendation uses comparable seven-day observations for the same organisation, platform, objective and provider account.

Feedback is attribution evidence, not proof that wording caused performance. At publish execution Genesis stores a non-reversible fingerprint of the exact caption and ordered hashtag payload. A metric snapshot is linked to feedback only when that fingerprint and the destination platform match the recorded choice exactly; otherwise attribution stays null. Posts without a matched choice may still contribute to the account baseline.

When at least two variants each have three attributed observations, Genesis labels the higher-scoring cohort the current champion and the next cohort the challenger. This is an observational test cue, not an automatic winner or causal claim; the operator remains responsible for the next test.

## Scoring and confidence rules

Metrics are normalized from provider aliases into views, reach, impressions, likes, comments, shares, saves, clicks, profile visits, enquiries, bookings and watch time. Negative or non-finite values are discarded.

The displayed **directional score** is objective-specific and normalized per 1,000 reach, falling back to views. It is an internal comparison aid, not a platform prediction:

- awareness emphasizes views, shares and saves;
- engagement emphasizes likes, comments, shares and saves;
- enquiries emphasizes clicks, profile visits and recorded enquiries;
- bookings emphasizes clicks, enquiries and recorded bookings.

Only the latest **seven-day checkpoint** per external post counts toward sample size. Earlier 24-hour and 72-hour checkpoints remain visible but cannot unlock performance-informed language:

- 0–9 comparable posts: insufficient data; performance confidence is null;
- 10–29: directional performance context;
- 30+: performance-informed context;
- performance confidence is capped at 85.

AWO must never state that a caption, hashtag, or creative choice guarantees or caused reach, engagement, enquiries, or bookings.

## Trust and data boundaries

- Recommendations, feedback and metric snapshots are organisation-scoped with composite foreign keys.
- Recommendations and feedback are append-only for authenticated users.
- Provider metric writes have no authenticated-user policy; only service-role collector code can insert snapshots, and database triggers reject updates.
- Automation events are metadata-only. They exclude captions, hashtags, evidence and raw provider metrics.
- A stale recommendation cannot be selected after its draft version changes.
- Human review remains required. The feature cannot approve, schedule or publish.
- Media guidance uses filenames, MIME types, dimensions, duration, descriptions, alt text and tags only.

## Analytics collector

`POST /api/internal/engagement/collect` runs a bounded manual collection pass using `PUBLISHING_WORKER_SECRET`. `GET` runs the scheduled pass using the separate `CRON_SECRET`. Both fail closed when their own secret is missing or shorter than 16 characters.

The draft panel also provides a scoped refresh for authorized operators. It verifies membership and draft ownership before using the service-role writer for that organisation and draft only.

Simulated publishing attempts are excluded. Provider snapshots are insert-only and idempotent per organisation. Their key combines the Blotato account, post ID, provider timestamp (or `undated`) and a deterministic metric-payload hash, so a provider correction at the same timestamp becomes a new observation instead of overwriting history.

## Sprint 13 operational controls

Sprint 13 makes the learning loop usable without turning it into an autonomous publishing system:

- Vercel invokes `GET /api/internal/engagement/collect` once daily at 04:15 UTC. The request must carry `Authorization: Bearer $CRON_SECRET`; the manual `POST` endpoint continues to require the separate `PUBLISHING_WORKER_SECRET`.
- Database filters now restrict collection to completed attempts with external post IDs, newest first, before application-level simulation checks.
- Each metric snapshot records the exact `blotatoAccountId` captured by the publishing attempt. Performance baselines include only that destination account; legacy null-account rows never enter an account baseline.
- Organisations with multiple active accounts for one platform receive no blended performance score until a destination is unambiguous.
- Provider history is bounded to the latest 20 valid snapshots per post per run. Invalid or more-than-five-minutes-future provider timestamps are ignored.
- Collector responses distinguish new inserts (`recorded`) from idempotent existing observations (`alreadyRecorded`).
- The draft panel displays the latest recorded selection, the latest available published result and the live account-scoped learning summary.
- Champion language remains observational: the interface labels variants as candidates, never causal winners.

Set `CRON_SECRET` in Vercel Production to a randomly generated value of at least 16 characters before deploying `vercel.json`. Do not reuse the Blotato API key or Supabase service-role key.

## Sprint 14 publish-to-learn controls

- `public.apply_engagement_recommendation` is a security-invoker transaction. It locks the draft, rechecks organisation, recommendation, version, variant and hashtag payload, rejects locked drafts, updates caption and hashtags, and inserts attribution together.
- Selected feedback cannot be created through the old record-only application path. Dismissals remain record-only.
- The panel puts selection state, 7-day learning progress, last analytics sync, next 04:15 UTC collection and exclusion counts at the top.
- Long caption, alternatives, creative guidance, hashtags and reasoning are collapsed by default.
- Metric observations are labelled `under_24h`, `24h`, `72h` or `7d`; only `7d` is comparable evidence.
- Commercial outcomes are append-only snapshots tied by composite foreign key to the exact organisation, draft and publishing attempt. The latest snapshot for an attempt supplies enquiries and bookings to objective scoring; revenue is recorded for operator decisions but does not inflate the engagement score.
- Human approval remains mandatory after apply. Sprint 14 cannot schedule or publish.

## Deployment order

1. Apply `20260810180000_engagement_learning_loop.sql` after the Sprint 10 migration.
2. Apply `20260810190000_engagement_learning_operations.sql`.
3. Apply `20260810200000_publish_to_learn.sql`.
4. Apply `20260810210000_linkedin_personal_profile_audit_guard.sql` before deploying Sprint 15.1.
5. Keep the existing production `CRON_SECRET`; verify it contains no leading or trailing whitespace.
6. Deploy the application code and `vercel.json`.
7. Generate a recommendation, open the replacement preview, confirm apply, and verify the draft body, hashtags, version history and recorded selection all changed together.
8. Complete human review and publish through the existing workflow.
9. Trigger the collector manually and verify checkpoint and exclusion visibility.
10. Record a commercial outcome only after a real eligible post exists.
11. Confirm performance confidence remains unavailable until 10 distinct seven-day comparable posts exist for the same organisation, platform, objective and provider account.

If Blotato analytics is unavailable, the collector records a failed item and continues; recommendation generation falls back to brand-only behavior. Existing drafting, review and publishing remain unaffected.

## Sprint 15 LinkedIn personal-profile optimiser

Sprint 15 reuses the existing LinkedIn channel and Engagement Intelligence workflow. It does not create a separate application or use scraping/browser automation.

- LinkedIn recommendations are explicitly generated for a personal profile, not a company Page.
- The system may use only MemBrain-supported identity, role, experience, proof and claims. Missing spokesperson evidence must never be invented.
- Every recommendation includes a six-part editorial rubric: opening hook, single clear idea, personal voice, credibility, scanability and conversation CTA.
- The displayed readiness score is calculated from those six rubric values. It is editorial guidance, not predicted reach, engagement or commercial performance.
- The operator sees the reader value, credibility anchor, conversation prompt and the highest-value improvements before applying the caption.
- Existing atomic Apply to draft, human review, scheduling, exact attribution and account-scoped learning controls remain unchanged.
- LinkedIn personal profiles publish through the connected Blotato account without a company Page ID.
- Older recommendations remain readable because LinkedIn guidance is optional in the stored JSON structure.

No database migration is required for Sprint 15. Native LinkedIn analytics XLSX import and profile-audit tooling remain separate follow-on work; the initial pilot validates post optimisation with Villiz Pixels and Mervic Signatures first.

## Sprint 15.1 grounding and workflow hardening

- A conservative deterministic classifier blocks explicit content-writing instructions such as “write a LinkedIn post” or “professional introduction of myself”. Draft length alone never blocks a post. The operator is directed to AI Generate, then must review and save the finished caption before Engagement Intelligence runs.
- The server repeats the same brief check, so bypassing the interface cannot send an instruction-like brief to the optimiser.
- LinkedIn generation and evaluation are separate model calls with separate schemas and prompts. The audit does not inherit the generator's scores.
- The audit checks the recommended caption, every applyable alternative, hashtags, rationale, predicted strengths and all displayed guidance against the retrieved MemBrain pack. Personal credentials, roles, statistics, locations, results and performance claims without direct evidence are blocking findings.
- Credibility scores above zero require at least one exact MemBrain entry ID from the supplied evidence index. Unknown or invented evidence IDs fail validation.
- If the first candidate fails, Genesis performs one bounded repair using the audit findings and audits the replacement. A second failure stops without persisting a recommendation.
- Audit-produced improvement actions are restricted to changes that can be completed before publication. Post-publication advice and visibility promises are excluded.
- The interface shows whether the independent audit passed normally or after the bounded repair. Legacy LinkedIn recommendations display “Audit required” and cannot be applied.
- The application use case and database transaction both reject unaudited LinkedIn recommendations, preventing a direct RPC call from bypassing the interface guard.
- A custom LinkedIn edit cannot inherit another caption's audit. Operators must save custom wording as the draft and generate a new audit; the application and database both reject the custom-apply shortcut.

Sprint 15.1 adds no autonomous publishing action. Apply `20260810210000_linkedin_personal_profile_audit_guard.sql` before deploying the application code.

## Sprint 15.2 LinkedIn editorial calibration

- Captions over 80 words are generated as 3 to 7 short paragraphs separated by blank lines, with a maximum of 60 words per paragraph.
- A dense first candidate receives the existing one bounded repair opportunity. If the repaired caption remains dense, deterministic calibration lowers scanability and adds a specific pre-publish action instead of presenting a misleading perfect score.
- Credibility is forced to zero without accepted MemBrain evidence. A 5/5 credibility score additionally requires a concrete professional detail in the caption; otherwise it is capped at 4/5 with an evidence-led improvement action.
- The readiness calculation deducts points for unresolved pre-publish improvement actions. A recommendation cannot display 100/100 while still asking the operator to improve it.

Sprint 15.2 requires no database migration and does not alter publishing permissions or the independent grounding gate.
