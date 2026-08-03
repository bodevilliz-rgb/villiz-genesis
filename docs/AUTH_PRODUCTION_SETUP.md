# Authentication — Production URL Setup (Sprint 8.0)

Villiz Social Manager's only sign-in path is a Supabase magic link
(`requestSignInLink` in `src/server/actions/auth.ts`), exchanged server-side
at `/auth/callback` (`src/app/auth/callback/route.ts`). Both the app and
Supabase need to agree on the production URL before a hosted sign-in can
ever work. **This document is deliberately written without a guessed URL in
it** — Vercel does not assign your production domain until after the first
deployment, so every step below tells you where to find the real value
rather than assuming one.

## Why this matters

The magic-link email is built as:

```
${NEXT_PUBLIC_SITE_URL}/auth/callback
```

(see `emailRedirectTo` in `src/server/actions/auth.ts:44`). If
`NEXT_PUBLIC_SITE_URL` in Vercel doesn't match a URL Supabase is configured
to allow redirecting to, Supabase silently substitutes its configured
**Site URL** instead — so the symptom of a misconfiguration isn't an error,
it's a sign-in link that quietly lands somewhere other than your app.

## Step 1 — Deploy once first, to get a real URL

Follow [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) far enough to
get a first successful deployment. Vercel assigns a URL of the form
`https://<project-name>-<hash>-<team>.vercel.app` for that specific
deployment, and a stable `https://<project-name>.vercel.app` that always
points at whatever is currently in Production. **Use the stable one** — copy
it from the Vercel dashboard (Project → Domains) or run:

```bash
vercel ls --prod
```

## Step 2 — Set `NEXT_PUBLIC_SITE_URL` in Vercel

Project Settings → Environment Variables → `NEXT_PUBLIC_SITE_URL` →
Production scope → the stable URL from Step 1, no trailing slash. Redeploy
(or the next deploy will pick it up).

## Step 3 — Configure Supabase Authentication URLs

In the Supabase dashboard for the **production** project (Project Settings
→ Authentication → URL Configuration):

- **Site URL**: the same stable production URL from Step 1
  (`https://<project-name>.vercel.app`, or your custom domain once Step 6 is
  done). This is the fallback Supabase uses if a redirect isn't on the
  allow-list below.
- **Redirect URLs** — add each of these as a separate entry:
  - `https://<project-name>.vercel.app/auth/callback` — production.
  - `http://localhost:3001/auth/callback` — keeps local development
    (`npm run dev:local`) working; safe to leave in place, it only matters
    if someone's browser is actually pointed at localhost.
  - Your custom domain's callback URL, once attached (Step 6) —
    `https://<your-domain>/auth/callback`.

Supabase's redirect allow-list supports exact matches and wildcard
subdomain patterns; for Vercel **preview deployments** in particular, see
Step 4 below rather than trying to allow-list every hash-suffixed preview
URL individually.

## Step 4 — Preview deployment handling

Vercel creates a new URL for every PR/branch preview deployment (a
different hash each time). Two supported approaches:

- **Simplest (recommended for this beta):** don't add magic-link sign-in
  redirect support for preview URLs at all. Preview deployments are for
  reviewing UI changes, not for testing the authenticated app end-to-end —
  do that against production or `npm run dev:local` instead. This avoids
  ever having to widen the Supabase redirect allow-list to match Vercel's
  unpredictable preview hostnames.
- **If you do need it:** Supabase's redirect URL field supports a single
  `*` wildcard per entry (e.g. `https://villiz-genesis-*-your-team.vercel.app/auth/callback`,
  matching your Vercel project's actual preview URL pattern — check
  Vercel's Deployments tab for the exact pattern your project uses, since
  team/project naming affects it). Only add this if you have a specific
  reason to sign in on a preview deployment; it does widen what Supabase
  will redirect to.

## Step 5 — Testing the magic link for real

1. Visit the production URL's `/login` page.
2. Enter a `@villiz.com` address (or whatever `ALLOWED_EMAIL_DOMAINS` is set
   to in Vercel) and submit.
3. Check that inbox — the email arrives from Supabase's shared sender
   unless you've configured custom SMTP (Project Settings → Auth → SMTP;
   worth doing before real client use, since the shared sender is
   rate-limited and can land in spam).
4. Click the link. It should land on `/dashboard`, not `/auth/error`. If it
   lands on `/auth/error?reason=expired`, the link was already used or its
   one-hour window passed — request a new one. If it lands somewhere
   unexpected entirely, re-check Steps 2–3: the Site URL/redirect
   allow-list and `NEXT_PUBLIC_SITE_URL` almost certainly disagree.
5. Confirm you're actually signed in (the dashboard renders your name, not
   a redirect back to `/login`).

## Step 6 — Custom domain replacement procedure

Once a custom domain (e.g. `app.villiz.com`) is attached in Vercel (Project
→ Domains → Add):

1. Wait for Vercel's DNS/SSL verification to finish (the dashboard shows
   "Valid Configuration" once done).
2. Update `NEXT_PUBLIC_SITE_URL` in Vercel to the custom domain
   (`https://app.villiz.com`) and redeploy.
3. In Supabase, update **Site URL** to the custom domain and add
   `https://app.villiz.com/auth/callback` to **Redirect URLs**.
4. Re-run Step 5's magic-link test against the custom domain specifically
   — the `*.vercel.app` URL will usually keep working too (Vercel doesn't
   remove it), but the custom domain is now what real users should use, so
   it's the one that actually needs to be proven.
5. Only remove the old `*.vercel.app` entry from Supabase's redirect
   allow-list if you're deliberately retiring it — leaving it is harmless
   and gives you a fallback if the custom domain's DNS ever breaks.

## Known limitation

Supabase's Site URL and redirect allow-list are dashboard-only settings —
there is no migration or code in this repository that configures them, so
this document is the only record of what to set. Nothing here can be
verified by `npm run production:check` (which only validates this app's own
environment variables, not Supabase's dashboard configuration) — Step 5's
manual magic-link test is the actual proof this is wired correctly.
