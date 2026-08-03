# Hosted Smoke Test — Instagram Publishing (Sprint 8.0)

A manual, non-destructive checklist proving the full hosted pipeline works
end-to-end: **Villiz Social Manager (Vercel) → Supabase Cloud → Publishing
Queue → Render worker → Blotato → Instagram.** This is a checklist to run
**by hand, deliberately, once you're ready** — nothing in this document
runs automatically, and no step here publishes a real post until you
explicitly reach the step that says so.

Complete [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md),
[AUTH_PRODUCTION_SETUP.md](./AUTH_PRODUCTION_SETUP.md), and
[RENDER_WORKER.md](./RENDER_WORKER.md) first — this checklist assumes both
the web app and the worker are already deployed and configured.

## Before you start

- [ ] `npm run production:check` passes with no errors against the exact
      environment variables set in Vercel (see
      [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)).
- [ ] Confirm `BLOTATO_LIVE_PUBLISHING_ENABLED` is still `"false"` in
      Render **until** you deliberately reach the step below that asks you
      to flip it — every step before that is safe to run with it off, and
      publishing will simply simulate instead of going live.
- [ ] Confirm a real Instagram account is connected in Blotato and visible
      under **Connected accounts** on `/settings/publishing`.

## 1. Hosted login

- [ ] Visit the production URL's `/login`.
- [ ] Request a sign-in link with a real `@villiz.com` address.
- [ ] Click the link from the actual email — confirm it lands on
      `/dashboard`, signed in (see
      [AUTH_PRODUCTION_SETUP.md Step 5](./AUTH_PRODUCTION_SETUP.md#step-5--testing-the-magic-link-for-real)
      if this fails).

## 2. Villiz Pixels workspace

- [ ] From the dashboard, open **Clients** and confirm the seeded "Villiz
      Pixels" organisation is visible and selectable.
- [ ] Confirm you land on its Overview page with no errors.

## 3. Media upload to Supabase Cloud

- [ ] Open **Media Library** → upload a real, small image (a JPEG under
      2MB — see the known limitation on upload size in
      [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)).
- [ ] Confirm the asset appears in the catalog with a working thumbnail —
      this proves the signed upload reached the **production** Supabase
      Storage bucket, not a local one.

## 4. Draft creation

- [ ] Content Studio → **New draft** → give it a title and a short body
      appropriate for an Instagram test post (e.g. "Villiz Social Manager
      hosted beta — internal test, please ignore").
- [ ] Attach the media asset uploaded in Step 3.
- [ ] Save the draft.

## 5. Submission and approval

- [ ] Submit the draft for review.
- [ ] Approve it (see [AUTH_PRODUCTION_SETUP.md](./AUTH_PRODUCTION_SETUP.md)
      and the `CLOUD_PILOT_SELF_APPROVAL` note in
      [.env.production.example](../.env.production.example) — this beta
      pilot organisation currently has one operator, so self-approval is
      expected to be enabled and is not a bug).
- [ ] Confirm the draft's status shows **Approved**.

## 6. Instagram destination

- [ ] From the approved draft, open the Publishing panel and select
      **Instagram** as the destination platform.

## 7. Publishing queue

- [ ] Click **Publish Now** → confirm through the pre-publish check dialog.
- [ ] Confirm the job appears in **Publishing Queue** with status
      **Queued** (or briefly **Publishing** if the worker claims it
      immediately).

## 8. Render worker claim

- [ ] Open the Render dashboard → the worker service's **Logs** tab.
- [ ] Confirm a claim/processing log line appears for this job within one
      poll interval (a few seconds) — this proves the Render-hosted worker,
      not a local process, picked it up. If nothing appears, see
      [RENDER_WORKER.md's health/heartbeat section](./RENDER_WORKER.md#health--heartbeat-strategy).

## 9. Blotato submission

**Stop here if `BLOTATO_LIVE_PUBLISHING_ENABLED` is still `"false"`** — the
job will complete as a *simulated* success (deterministic mock ID), proving
the entire pipeline above end-to-end without ever calling Blotato for real.
This alone is a legitimate, complete smoke test if you are not yet ready to
publish for real.

To prove the **real** Blotato submission specifically:

- [ ] In Render's environment settings, set `BLOTATO_LIVE_PUBLISHING_ENABLED=true`
      and redeploy/restart the worker.
- [ ] Repeat Steps 4–7 with a new draft (idempotency keys are per-draft;
      don't reuse the same job).
- [ ] Confirm the job detail page's Attempt history shows a real Blotato
      `postSubmissionId` (not the `mock-instagram-...` pattern) once the
      attempt completes.

## 10. Instagram publication

- [ ] Confirm the job reaches status **Published**.
- [ ] Open Instagram directly (the app or instagram.com) and confirm the
      post actually appears on the connected account.

## 11. Final public URL

- [ ] From the job detail page, confirm `externalUrl` is present and opens
      to Blotato's dashboard (`https://my.blotato.com`) — see
      [PUBLISHING_ENGINE.md](./PUBLISHING_ENGINE.md#blotato-integration-sprint-6b)
      for why this points at Blotato's dashboard rather than a direct
      Instagram permalink.
- [ ] Cross-check the post is genuinely live by finding it on Instagram
      directly (Step 10), not just trusting the recorded URL.

## 12. Retry after a controlled failure

- [ ] Create one more draft, approve it, and queue it for Instagram — but
      this time, deliberately induce a failure to prove retry works: either
      temporarily set `BLOTATO_API_KEY` to an invalid value in Render (then
      restore it after this step), or use an intentionally-invalid media
      URL if the draft supports it.
- [ ] Confirm the job reaches status **Failed** with a real recorded error
      message.
- [ ] Restore the correct configuration, then click **Retry Publish**.
- [ ] Confirm a **new** attempt is created (Attempt 2, "Retry of attempt
      1"), the original failed attempt is untouched, and the job reaches
      **Published**.

## 13. Mobile browser test

- [ ] Repeat Steps 1–2 on an actual phone browser (not just a resized
      desktop window) — sign in, open Villiz Pixels.
- [ ] Confirm the hamburger menu opens the navigation drawer and the
      organisation switcher is reachable from it (see the mobile
      responsiveness audit in this sprint's completion report for what was
      fixed here).
- [ ] Open the same approved draft from Step 5 on the phone and confirm the
      Approve/Request Changes/Reject and Publish Now/Schedule buttons are
      all comfortably tappable with one hand.
- [ ] Upload a photo directly from the phone's camera roll in Media Library
      and confirm it appears in the catalog (proves the file input works
      with a real mobile browser's photo picker, not just a desktop file
      dialog).

## After the test

- [ ] If Step 9 was run for real, decide deliberately whether
      `BLOTATO_LIVE_PUBLISHING_ENABLED` should stay `true` (ready to onboard
      real client posts) or be set back to `false` (return to simulated
      publishing) — this is a product decision, not a technical one, and
      this document does not make it for you.
- [ ] Archive or delete the test drafts/posts created here so they don't
      confuse a future operator looking at real client content.
