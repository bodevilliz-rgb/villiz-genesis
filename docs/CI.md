# Continuous Integration (Sprint 7.2 — Continuous Quality Gate)

One GitHub Actions workflow, `.github/workflows/quality-gate.yml`, runs the
same checks a contributor is expected to run locally before merging:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run reliability:test
npm run build
```

## When it runs

- Every `push` to `main`.
- Every `pull_request` targeting `main`.

## Environment

- `ubuntu-latest`, Node.js `22` (via `actions/setup-node@v4`, with npm's
  cache enabled).
- **No repository secrets are required.** Every step above passes with a
  bare checkout and no `.env.local` at all — verified directly before this
  workflow was written by removing `.env.local` and running every command
  locally. `next build` renders every route dynamically at request time (no
  page needs real Supabase credentials during the build itself), and
  `npm run reliability:test`'s four DB-tier checks (the ones that need a
  real Postgres connection) SKIP cleanly with a clear reason instead of
  failing when the local Supabase stack isn't running — exactly the
  behaviour documented in
  [RELIABILITY_TESTING.md](./RELIABILITY_TESTING.md#environment-requirements).
  A CI run without local Supabase reports `READY WITH WARNINGS` and exits
  `0`, the same as it would on a contributor's machine with Docker not
  started.

## What fails the job

Each step is a plain `run:` command — its own exit code is what fails the
workflow. Nothing here catches or downgrades a failure:

- `typecheck`/`lint`/`test`/`build` fail the job on any error, exactly as
  running them locally would.
- `reliability:test` fails the job **only** when its release recommendation
  is `NOT READY` — i.e. at least one MANDATORY reliability check genuinely
  FAILed (not SKIPped). See
  [RELIABILITY_TESTING.md](./RELIABILITY_TESTING.md#release-decision-rules)
  for the exact score/recommendation rules.

## Artifacts

The last step uploads `reports/reliability/latest.json` and
`reports/reliability/latest.md` as a workflow artifact named
`reliability-report`, kept for 30 days. It runs with `if: ${{ !cancelled()
}}`, so a report is still uploaded even when an earlier reliability check
failed — the whole point is to make a failing run's report downloadable for
diagnosis, not just its console log.

## Enabling branch protection (requires repository admin access)

The workflow existing does not, by itself, block a merge — a repository
admin has to tell GitHub to require it. This only needs doing once:

1. On GitHub, go to the repository's **Settings → Branches**.
2. Under **Branch protection rules**, click **Add rule** (or edit the
   existing rule for `main` if one already exists).
3. Set **Branch name pattern** to `main`.
4. Enable **Require a pull request before merging** (recommended, so every
   change to `main` goes through a PR the workflow can run on).
5. Enable **Require status checks to pass before merging**.
6. In the status checks search box, find and select **Quality Gate** (the
   job name from `quality-gate.yml`). It will only appear in this list
   after the workflow has run at least once on a branch or PR in this
   repository — push a commit or open a PR first if it isn't showing up
   yet.
7. Optionally enable **Require branches to be up to date before merging**,
   so a PR must be rebased/merged with the latest `main` before the check
   is trusted.
8. Click **Save changes** (or **Create**).

Once saved, GitHub blocks merging any pull request into `main` whose
**Quality Gate** run hasn't completed successfully — a red ✕ or a still-running
check both block the merge button, exactly like any other required status
check.

### Verifying it's working

Open a pull request with a trivial change (or intentionally break a
mandatory check, e.g. introduce a lint error, in a scratch branch) and
confirm:

- The **Quality Gate** check appears on the PR and starts running
  automatically.
- The PR's merge button is disabled while the check is pending or failing,
  and a reviewer can see exactly which step failed by opening the check's
  details.
- A passing run's **Files changed**/**Checks** tab offers the
  `reliability-report` artifact for download.

## Known limitations

- This workflow only ever proves the in-memory tier and the safe,
  gitignored parts of the reliability suite — the four DB-tier checks
  always SKIP in this CI environment, since no local Supabase stack is
  provisioned here. That is expected and intentional for this sprint (see
  [RELIABILITY_TESTING.md](./RELIABILITY_TESTING.md)); provisioning a
  disposable Postgres in CI to exercise those four checks for real is future
  work, not something this sprint's mission asked for.
- The Blotato connectivity check also never runs in CI (it's opt-in via
  `RELIABILITY_CHECK_BLOTATO_CONNECTION=true`, which this workflow does not
  set, deliberately — no Blotato credentials are stored as repository
  secrets).
- Branch protection itself cannot be configured by this workflow file or by
  an automated agent — it's a repository setting only an admin with
  **Settings** access can change, which is why it's documented as a manual
  procedure above rather than shipped as config.
