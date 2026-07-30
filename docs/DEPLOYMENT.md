# Deployment

Three stages: database, hosting, first user. Budget about twenty minutes.

---

## 1. Supabase

```bash
# Create the project at https://supabase.com/dashboard (choose a region close to London)

npx supabase login
npx supabase link --project-ref <your-project-ref>
```

**Verify the migrations locally before touching the hosted project.** They have
been written carefully but have not been executed against a live Postgres:

```bash
npx supabase start      # requires Docker
npm run db:reset        # applies all 8 migrations from scratch
```

Fix anything that fails, then push:

```bash
npm run db:push
```

Confirm in the dashboard:

- **Table editor** shows `profiles`, `organisations`, `organisation_members`,
  `organisation_limits`, `membrain_*`, `social_accounts`, `media_assets`,
  `scheduled_posts`, `ai_usage_events`.
- **Authentication → Policies** shows `RLS enabled` on every one of them. If any
  table shows RLS disabled, stop and investigate — that is a data leak, not a
  cosmetic issue.
- **Storage** shows a `organisation-media` bucket marked **private**.

### Auth settings

In **Authentication → Providers**:

- Enable **Email**. Disable **Confirm email** — magic link is the only path in.
- Disable **Enable email signups**. Staff are invited, never self-registered. The
  application already sends `shouldCreateUser: false`, but the server should refuse
  independently.

In **Authentication → URL Configuration**:

- Site URL: your production URL.
- Redirect URLs: add both `https://<your-domain>/auth/callback` and
  `http://localhost:3000/auth/callback`.

Magic links from Supabase's shared SMTP are rate-limited and land in spam. Before
real use, set your own SMTP under **Project Settings → Auth → SMTP**.

---

## 2. Vercel

```bash
npx vercel link
npx vercel --prod
```

Or import the repository through the Vercel dashboard. Framework detection needs
no help.

Add all five environment variables under **Settings → Environment Variables**,
for Production, Preview, and Development:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page. Safe to expose; RLS is the boundary. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. **Server only.** Never prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` — no trailing slash |
| `ALLOWED_EMAIL_DOMAINS` | `villiz.com` |

`ALLOWED_EMAIL_DOMAINS` controls the application-layer check. The database has its
own copy in `platform_settings.allowed_email_domains`. **Both must agree.** They
are separate on purpose — the database check is the one that matters, and it keeps
working if someone misconfigures an environment variable.

---

## First user bootstrap

There is no public sign-up, so the first account is created by hand — once.

1. Supabase dashboard → **Authentication → Users → Invite user**.
2. Enter your Villiz email address.
3. Accept the emailed invitation.

The `handle_new_auth_user` trigger makes the first profile `owner` and activates
it. Everyone after that arrives as an inactive `member`.

To activate a colleague, either flip `is_active` in the table editor, or run:

```sql
update public.profiles
   set is_active = true, platform_role = 'member'
 where email = 'colleague@villiz.com';
```

Self-promotion is blocked by trigger, so an admin must do this for someone else.

---

## Post-deploy checks

Work through these on the live URL:

1. `/` redirects to `/login` when signed out.
2. A magic link to a **non**-Villiz address returns the same confirmation message
   as a valid one, and does not arrive. (Enumeration protection.)
3. A magic link to your address signs you in and lands on `/dashboard`.
4. Creating an organisation immediately shows a limits row, seven MemBrain
   categories, and you as `lead`.
5. Creating a MemBrain entry, then editing it, produces **v2** with your change
   reason in history.
6. Restoring v1 produces **v3** — not a rewritten v1. History still shows all three.
7. The Context Inspector returns a prompt containing every importance-5 entry, even
   when the query is unrelated to them.
8. `/api/organisations/<id>/membrain/context` returns 401 in a logged-out private
   window.
9. Visiting an organisation you are not a member of returns 404, not 403.

Nine passes and Sprint 1 is genuinely deployed.

---

## Suggested commit sequence

The work was built as one continuous session. To land it as reviewable history:

```bash
git init && git add . && git commit -m "chore: scaffold Next.js 15 + Supabase + Tailwind v4"

git commit -m "feat(db): foundation, identity and organisation schema with RLS"
git commit -m "feat(db): guardrails, MemBrain schema, retrieval RPCs and storage"
git commit -m "feat(core): domain entities, ports, DTOs and typed errors"
git commit -m "feat(infra): Supabase clients, mappers and repositories"
git commit -m "feat(auth): passwordless staff sign-in with domain allowlist"
git commit -m "feat(dashboard): portfolio overview with live guardrail usage"
git commit -m "feat(organisations): CRUD, team assignment and per-account limits"
git commit -m "feat(membrain): knowledge capture, search, versioning and retrieval"
git commit -m "feat(api): authenticated MemBrain context endpoint"
git commit -m "docs: architecture, database and deployment guides"
```

---

## Rollback

Vercel: **Deployments → previous deployment → Promote to Production**. Instant.

Supabase: migrations are forward-only. There are no down migrations, deliberately —
a down migration that drops a column destroys client data, and the temptation to
run one under pressure is not worth the convenience. To reverse a schema change,
write a new migration.
