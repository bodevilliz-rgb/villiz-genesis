# AWO Engagement Intelligence — Sprint 10 vertical slice

## Outcome

AWO can now generate and persist a structured recommendation for a saved
social-content draft. The recommendation contains a caption, alternatives,
hook, CTA, grouped hashtags, rationale, predicted strengths, limitations,
confidence and the exact MemBrain evidence used.

This is **brand-informed guidance**, not performance prediction. Genesis does
not yet ingest account-level reach, saves, shares, clicks, enquiries or
bookings, so brand-only confidence is capped at 70 and every recommendation
states that limitation.

## Operator journey

1. Open a saved social-content draft.
2. In **AWO Engagement Intelligence**, select a platform and optionally enter
   the intended outcome.
3. Generate the recommendation.
4. Review the caption, hook, CTA, hashtags, rationale and evidence.
5. Copy the preferred material into the draft and continue through the normal
   review and publishing workflow.

AWO cannot edit, approve, schedule or publish a draft through this feature.
If the draft version changes, the stored recommendation is visibly marked
outdated.

## Trust and data boundaries

- Only a Lead, Contributor or platform administrator can generate advice.
- Reviewers can read existing recommendations but cannot create them.
- MemBrain retrieval uses the existing organisation-scoped, active-only
  context surface.
- Recommendations are tied to both `organisation_id` and `draft_id` through a
  composite foreign key.
- Recommendation rows are immutable to authenticated users.
- The automation event contains identifiers, platform, data basis and
  confidence only. It excludes captions, hashtags and MemBrain evidence.
- Model output is schema-validated, hashtags are deduplicated and brand-only
  confidence is deterministically capped after generation.

## Migration and deployment order

1. Keep live publishing in its current safe configuration.
2. Apply `20260810160000_engagement_intelligence.sql`.
3. Deploy the application code.
4. Open an existing saved social draft with active MemBrain knowledge.
5. Generate a recommendation and confirm it remains after refresh.
6. Edit and save the draft; confirm the older recommendation is marked
   outdated.
7. Confirm the automation gateway receives only
   `engagement.recommendation_generated` metadata.

If the model provider is unavailable, generation returns an operator-safe
error and writes no recommendation. Existing drafting, review and publishing
flows remain unaffected. Roll back the application deployment if necessary;
the additive table can remain unused without changing existing behaviour.

## Performance-informed phase — deliberately not claimed complete

`performance_informed` exists in the domain and database vocabulary so the
next phase can be added without renaming stored records. It must not be emitted
until Genesis has:

- organisation-to-social-account mapping;
- post-to-publishing-job attribution;
- reach, impressions, likes, comments, shares and saves;
- clicks, enquiries or bookings where measurable;
- metric collection timestamps and platform source metadata;
- sufficient samples and a minimum-data rule;
- outcome feedback for accepted, modified and dismissed recommendations.

Until those conditions are met, no screen or prompt may state that AWO has
proven a caption or hashtag set will increase engagement.
