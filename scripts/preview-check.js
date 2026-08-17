/**
 * The one official health check for the local environment.
 *
 * Every check here is read-only against the LOCAL stack — nothing here writes
 * data or touches the linked remote Supabase project. Session cookies for the
 * authenticated checks are obtained through the same dev-only magic-link
 * mechanism as `src/server/actions/dev-auth.ts` (generate a link server-side,
 * exchange it through the real `/auth/callback` route), so this script proves
 * the exact same code path a developer's browser uses — not a bypass of it.
 */
const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EXPECTED_SEEDED_ORGANISATION, verifySeededOrganisation } = require('./local-seed-verification');

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

const REPO_ROOT = path.resolve(__dirname, '..');
const BASE = 'http://localhost:3001';
const ORG_ID = EXPECTED_SEEDED_ORGANISATION.id;
const STAFF_PROFILE_ID = '0eea9074-18f3-4934-9e20-b2bfde1fef05';
const DEV_LOGIN_EMAIL = 'Bodevilliz@gmail.com';

let failed = false;
function ok(msg) {
  console.log(green(`✔ ${msg}`));
}
function bad(msg) {
  console.error(red(`✘ ${msg}`));
  failed = true;
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000, ...options }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/** Reads project_id out of supabase/config.toml — never a hardcoded guess. */
function localDbContainerName() {
  const toml = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8');
  const match = toml.match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error('Could not read project_id from supabase/config.toml.');
  return `supabase_db_${match[1]}`;
}

/**
 * Runs a single-statement read-only query directly against the local Postgres
 * container. Deliberately NOT `npx supabase db query` (no `--local` flag on
 * that command targets whatever project is linked — this repo IS linked to a
 * remote project, so that command would silently check the wrong database,
 * reproducing History of Issues #4). Going straight at the container's own
 * `psql` is unambiguous: there is no other database inside it.
 */
function queryLocalDb(sql) {
  const container = localDbContainerName();
  return execSync(`docker exec -i ${container} psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();
}

/** Minimal cookie jar: last-value-wins per cookie name, sent back as one header. */
function parseSetCookie(setCookieHeaders, jar) {
  if (!setCookieHeaders) return;
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Signs in through `/api/dev/session` — a NODE_ENV-gated, dev-only route that
 * generates a magic link server-side and verifies it through the same GoTrue
 * call a real click resolves to (see that route's doc comment for why this is
 * `verifyOtp` against a `hashed_token`, not the PKCE `/auth/callback` exchange:
 * admin-generated links never carry a PKCE code). Requires ENABLE_DEV_LOGIN=true
 * in .env.local, same as the login page's own dev-only shortcut.
 */
async function signIn() {
  const jar = new Map();
  const res = await fetchUrl(`${BASE}/api/dev/session?email=${encodeURIComponent(DEV_LOGIN_EMAIL)}`);
  parseSetCookie(res.headers['set-cookie'], jar);

  if (res.statusCode === 404) {
    throw new Error(
      'Dev sign-in route is disabled. Set ENABLE_DEV_LOGIN="true" in .env.local to let preview:check verify authenticated routes.',
    );
  }
  if (res.statusCode !== 200) {
    throw new Error(`/api/dev/session returned HTTP ${res.statusCode}: ${res.body}`);
  }
  if (jar.size === 0) throw new Error('/api/dev/session did not set any session cookies.');

  return jar;
}

async function getAuthed(jar, urlPath) {
  return fetchUrl(`${BASE}${urlPath}`, { headers: { Cookie: cookieHeader(jar) } });
}

async function main() {
  console.log(blue('=== Running Local Preview Environment Health Checks ==='));

  // 1. Docker
  try {
    execSync('docker info', { stdio: 'pipe' });
    ok('Docker is running.');
  } catch {
    bad('Docker is not running.');
  }

  // 2. Supabase (local stack, not the linked remote project)
  try {
    const res = await fetchUrl('http://127.0.0.1:54321/rest/v1/');
    if (res.statusCode) ok('Local Supabase API gateway is online on port 54321.');
    else bad(`Local Supabase responded with an invalid status ${res.statusCode}.`);
  } catch (err) {
    bad(`Local Supabase is not responding on port 54321: ${err.message}`);
  }

  // 3. Build Health — typecheck is the fast, meaningful signal; a full `next
  // build` is covered separately by `npm run build` in the quality gate.
  try {
    execSync('npm run typecheck', { cwd: REPO_ROOT, stdio: 'pipe' });
    ok('Build health: typecheck passes with zero errors.');
  } catch (err) {
    bad(`Build health: typecheck failed.\n${err.stdout?.toString() ?? err.message}`);
  }

  // 4. Login page (public, unauthenticated)
  let loginRes;
  try {
    loginRes = await fetchUrl(`${BASE}/login`);
    if (loginRes.statusCode === 200 && loginRes.body.includes('Villiz Social Manager') && loginRes.body.includes('Email me a sign-in link')) {
      ok('Login page renders correct UI elements.');
    } else {
      bad(`Login page did not render expected content (HTTP ${loginRes.statusCode}).`);
    }
  } catch (err) {
    bad(`Login page check failed: ${err.message}`);
  }

  // 5. CSS / Tailwind tokens
  try {
    const cssMatch = loginRes?.body.match(/href="(\/_next\/static\/css\/[^"]+\.css(?:\?[^"]*)?)"/);
    if (!cssMatch) {
      bad('Could not find a compiled stylesheet link in the login page HTML.');
    } else {
      const cssRes = await fetchUrl(`${BASE}${cssMatch[1]}`);
      const hasBackgroundToken = /--background:\s*#080808/.test(cssRes.body);
      const hasPrimaryToken = /--primary:\s*#ff6a00/.test(cssRes.body);
      if (cssRes.statusCode === 200 && hasBackgroundToken && hasPrimaryToken) {
        ok('Tailwind CSS is compiled with Villiz design tokens present.');
      } else {
        bad('Compiled stylesheet is missing expected Villiz design tokens.');
      }
    }
  } catch (err) {
    bad(`CSS check failed: ${err.message}`);
  }

  // 6. Seed data — read directly from the local container, never through an
  // unflagged `supabase db query`, which would silently ask the linked remote
  // project instead of this machine's Docker containers.
  try {
    const row = queryLocalDb(`select id || '|' || name from public.organisations where id = '${ORG_ID}'`);
    const [id = '', name = ''] = row.split('|');
    const verification = verifySeededOrganisation({ id, name });
    if (verification.ok) ok(`Seed data: organisation "${EXPECTED_SEEDED_ORGANISATION.name}" (${ORG_ID}) exists.`);
    else bad(`Seed data: ${verification.error}.`);
  } catch (err) {
    bad(`Seed data: organisation query failed: ${err.message}`);
  }
  try {
    const role = queryLocalDb(
      `select role from public.organisation_members where organisation_id = '${ORG_ID}' and profile_id = '${STAFF_PROFILE_ID}'`,
    );
    if (role === 'lead') ok('Seed data: staff membership exists with role "lead".');
    else bad(`Seed data: expected role "lead" for seeded staff membership, got "${role || '(none)'}".`);
  } catch (err) {
    bad(`Seed data: membership query failed: ${err.message}`);
  }

  // 7. Authentication — obtain a real session the same way a browser would,
  // then reuse it for every check below that needs to be signed in.
  let jar = null;
  try {
    jar = await signIn();
    ok('Authentication: dev magic-link generated and exchanged for a live session.');
  } catch (err) {
    bad(`Authentication check failed: ${err.message}`);
  }

  if (jar) {
    // 8. Dashboard
    try {
      const res = await getAuthed(jar, '/dashboard');
      if (res.statusCode === 200 && !res.body.includes('NEXT_REDIRECT') && res.body.length > 500) {
        ok('Dashboard loads for an authenticated user.');
      } else {
        bad(`Dashboard did not render correctly for an authenticated user (HTTP ${res.statusCode}).`);
      }
    } catch (err) {
      bad(`Dashboard check failed: ${err.message}`);
    }

    // Also confirm the security boundary still holds for signed-out visitors.
    try {
      const res = await fetchUrl(`${BASE}/dashboard`);
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location?.includes('/login')) {
        ok('Dashboard route is correctly protected for signed-out visitors.');
      } else {
        bad(`Security check failed: /dashboard did not redirect a signed-out visitor (HTTP ${res.statusCode}).`);
      }
    } catch (err) {
      bad(`Dashboard protection check failed: ${err.message}`);
    }

    // 9. Organisation overview
    try {
      const res = await getAuthed(jar, `/organisations/${ORG_ID}`);
      if (res.statusCode === 200 && res.body.includes('Villiz Pixels')) {
        ok('Organisation overview loads and displays seeded organisation name.');
      } else {
        bad(`Organisation overview did not render correctly (HTTP ${res.statusCode}).`);
      }
    } catch (err) {
      bad(`Organisation overview check failed: ${err.message}`);
    }

    // 10. Remaining required routes
    const requiredRoutes = [
      ['/', 'Public website'],
      [`/organisations/${ORG_ID}/campaigns`, 'Campaigns'],
      [`/organisations/${ORG_ID}/content`, 'Content Studio'],
      [`/organisations/${ORG_ID}/content?view=calendar`, 'Content Studio (calendar view)'],
      [`/organisations/${ORG_ID}/content?view=board`, 'Content Studio (board view)'],
      ['/review', 'Review Queue'],
    ];
    for (const [routePath, label] of requiredRoutes) {
      try {
        const res = await getAuthed(jar, routePath);
        if (res.statusCode === 200 && !res.body.includes('NEXT_REDIRECT')) {
          ok(`Route loads: ${label} (${routePath}).`);
        } else {
          bad(`Route failed: ${label} (${routePath}) returned HTTP ${res.statusCode}.`);
        }
      } catch (err) {
        bad(`Route failed: ${label} (${routePath}): ${err.message}`);
      }
    }

    // 11. API — an authenticated, RLS-backed API route.
    try {
      const res = await getAuthed(jar, `/api/organisations/${ORG_ID}/membrain/context?record=false`);
      if (res.statusCode === 200) {
        ok('API: authenticated MemBrain context endpoint responds.');
      } else {
        bad(`API check failed: MemBrain context endpoint returned HTTP ${res.statusCode}.`);
      }
    } catch (err) {
      bad(`API check failed: ${err.message}`);
    }
  } else {
    bad('Skipped Dashboard, Organisation, Routes, and API checks — no authenticated session was available.');
  }

  if (failed) {
    console.log(red('\n=== Health Checks FAILED ==='));
    process.exit(1);
  } else {
    console.log(green('\n=== All Health Checks PASSED ==='));
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(red(`✘ Unexpected error: ${err.message}`));
  process.exit(1);
});
