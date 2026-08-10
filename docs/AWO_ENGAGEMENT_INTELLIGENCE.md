# AWO Engagement Intelligence — Sprint 11 learning loop

## Outcome

AWO now separates two questions that Sprint 10 presented as one confidence number:

- **Brand fit** measures how well a recommendation follows active MemBrain evidence. It remains capped at 70.
- **Performance confidence** is deterministic, based on comparable published posts, and is unavailable below the minimum sample.

Recommendations add a required objective (`awareness`, `engagement`, `enquiries`, or `bookings`) and creative guidance grounded in attached-media metadata. Genesis does not claim pixel-level visual inspection. Operators can select or dismiss a recommendation; that decision is recorded as an immutable event and never publishes content.

## Learning lifecycle

1. A Contributor or Lead generates a recommendation for a saved social draft.
2. The operator chooses **Use & record** on the recommendation or an alternative, or records a dismissal.
3. The existing review and publishing workflow remains the only route to publication.
4. After Blotato confirms the post, the collector reads `GET /v2/posts/{id}/analytics` and stores immutable provider snapshots.
5. A later recommendation for the same organisation, platform and objective uses the latest observation for each distinct post as a directional baseline.

Feedback is attribution evidence, not proof that wording caused performance. At publish execution Genesis stores a non-reversible fingerprint of the exact caption and ordered hashtag payload. A metric snapshot is linked to feedback only when that fingerprint and the destination platform match the recorded choice exactly; otherwise attribution stays null. Posts without a matched choice may still contribute to the account baseline.

When at least two variants each have three attributed observations, Genesis labels the higher-scoring cohort the current champion and the next cohort the challenger. This is an observational test cue, not an automatic winner or causal claim; the operator remains responsible for the next test.

## Scoring and confidence rules

Metrics are normalized from provider aliases into views, reach, impressions, likes, comments, shares, saves, clicks, profile visits, enquiries, bookings and watch time. Negative or non-finite values are discarded.

The displayed **directional score** is objective-specific and normalized per 1,000 reach, falling back to views. It is an internal comparison aid, not a platform prediction:

- awareness emphasizes views, shares and saves;
- engagement emphasizes likes, comments, shares and saves;
- enquiries emphasizes clicks, profile visits and recorded enquiries;
- bookings emphasizes clicks, enquiries and recorded bookings.

Only the latest snapshot per external post counts toward sample size:

- 0–9 comparable posts: insufficient data; performance confidence is null;
- 10–29: directional performance context;
- 30+: performance-informed context;
- performance confidence is capped at 85.

AWO must never state that a caption, hashtag, or creative choice guarantees or caused reach, engagement, enquiries, or bookings.

## Trust and data boundaries

- Recommendations, feedback and metric snapshots are organisation-scoped with composite foreign keys.
- Recommendations and feedback are append-only for authenticated users.
- Provider metric writes have no authenticated-user policy; only service-role collector code can insert or update snapshots.
- Automation events are metadata-only. They exclude captions, hashtags, evidence and raw provider metrics.
- A stale recommendation cannot be selected after its draft version changes.
- Human review remains required. The feature cannot approve, schedule or publish.
- Media guidance uses filenames, MIME types, dimensions, duration, descriptions, alt text and tags only.

## Analytics collector

`POST /api/internal/engagement/collect` runs a bounded collection pass (20 completed publishing attempts by default, maximum 50). It uses the existing `PUBLISHING_WORKER_SECRET` bearer token and fails closed when the secret is missing or shorter than 16 characters. `GET` returns 405.

The draft panel also provides a scoped refresh for authorized operators. It verifies membership and draft ownership before using the service-role writer for that organisation and draft only.

Simulated publishing attempts are excluded. Provider snapshots are insert-only and idempotent per organisation. Their key combines the Blotato post ID, provider timestamp (or `undated`) and a deterministic metric-payload hash, so a provider correction at the same timestamp becomes a new observation instead of overwriting history.

## Deployment order

1. Apply `20260810180000_engagement_learning_loop.sql` after the Sprint 10 migration.
2. Deploy the application code.
3. Generate a recommendation and verify the objective, split confidence and metadata-aware creative guidance.
4. Select an option and confirm `engagement.recommendation_selected` contains identifiers only.
5. Trigger the collector with `Authorization: Bearer $PUBLISHING_WORKER_SECRET`.
6. Refresh analytics in the draft panel and generate a new recommendation.
7. Confirm performance confidence remains unavailable until 10 distinct comparable posts exist.

If Blotato analytics is unavailable, the collector records a failed item and continues; recommendation generation falls back to brand-only behavior. Existing drafting, review and publishing remain unaffected.
