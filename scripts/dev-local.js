/**
 * The one official way to start local development.
 *
 * Verifies Docker, brings up local Supabase if needed, applies any pending
 * migrations, applies the idempotent seed data, then boots Next.js on 3001 —
 * all against the LOCAL stack only. This script must never be able to touch
 * the remote/hosted Supabase project: that is the exact failure mode ("History
 * of Issues #4") this environment was previously burned by, so every command
 * below is deliberately `--local`, never a bare `db push`.
 *
 * It does NOT reset the database. `npm run db:reset:local` remains the only
 * destructive command, and it is never called from here.
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EXPECTED_SEEDED_ORGANISATION, verifySeededOrganisation } = require('./local-seed-verification');

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

const REPO_ROOT = path.resolve(__dirname, '..');
const ORG_ID = EXPECTED_SEEDED_ORGANISATION.id;

/**
 * Git does not copy ignored .env.local files into linked worktrees. Resolve the
 * primary checkout through Git's common directory and load its local-only env
 * into this process when the current worktree has no file of its own. Next's
 * child process inherits these values; no secret is copied or committed.
 */
function resolveLocalEnv() {
  const worktreeEnv = path.join(REPO_ROOT, '.env.local');
  if (fs.existsSync(worktreeEnv)) return { envPath: worktreeEnv, source: 'worktree' };

  const commonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const primaryEnv = path.join(path.dirname(commonDir), '.env.local');
  if (!fs.existsSync(primaryEnv)) return { envPath: worktreeEnv, source: 'missing' };

  // @next/env uses Next's own dotenv semantics and never prints values.
  require('@next/env').loadEnvConfig(path.dirname(commonDir), true, console, true);
  return { envPath: primaryEnv, source: 'primary-worktree' };
}

function runCmd(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: options.silent ? 'pipe' : 'inherit', cwd: REPO_ROOT, ...options });
  } catch (err) {
    if (options.ignoreError) return null;
    throw err;
  }
}

function fail(message) {
  console.error(red(`✘ ${message}`));
  process.exit(1);
}

/** Reads project_id out of supabase/config.toml so the Docker container name is never a hardcoded guess. */
function localDbContainerName() {
  const toml = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8');
  const match = toml.match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!match) fail('Could not read project_id from supabase/config.toml.');
  return `supabase_db_${match[1]}`;
}

console.log(blue('=== Starting Villiz One Local Development Environment ==='));

// 1. Docker must be running before anything else can work.
console.log(blue('\nStep 1/6: Verifying Docker...'));
try {
  runCmd('docker info', { silent: true });
  console.log(green('✔ Docker is running.'));
} catch {
  fail('Docker is not running. Start Docker Desktop and try again.');
}

// 2. Environment sanity check — refuse to run against a remote project by accident.
console.log(blue('\nStep 2/6: Verifying .env.local points at LOCAL Supabase...'));
const { envPath, source: envSource } = resolveLocalEnv();
if (!fs.existsSync(envPath)) {
  fail('.env.local is missing from this worktree and the primary checkout. Copy .env.example to .env.local (values are printed by `npx supabase status` once started).');
}
const envContents = fs.readFileSync(envPath, 'utf8');
const urlLine = envContents.split('\n').find((l) => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='));
const localUrlPattern = /NEXT_PUBLIC_SUPABASE_URL=.*(127\.0\.0\.1|localhost)/;
if (!urlLine || !localUrlPattern.test(urlLine)) {
  fail(
    '.env.local NEXT_PUBLIC_SUPABASE_URL does not point at a local address (127.0.0.1/localhost). ' +
      'Refusing to start against what looks like a remote project — this is exactly the "alternating between remote and local Supabase" failure mode from History of Issues #4. Fix .env.local and try again.',
  );
}
console.log(green('✔ .env.local targets local Supabase.'));
if (envSource === 'primary-worktree') {
  console.log(green('✔ Loaded the primary checkout\'s local environment for this isolated Git worktree (no file copied).'));
}

// 3. Start local Supabase if it is not already running.
console.log(blue('\nStep 3/6: Checking local Supabase status...'));
const isRunning = (() => {
  try {
    runCmd('npx supabase status', { silent: true });
    return true;
  } catch {
    return false;
  }
})();

if (!isRunning) {
  console.log(yellow('Supabase is stopped. Starting local containers (first start can take a minute)...'));
  try {
    runCmd('npx supabase start');
    console.log(green('✔ Supabase started.'));
  } catch {
    fail('Failed to start local Supabase containers. Run `npx supabase start` directly to see the full error.');
  }
} else {
  console.log(green('✔ Supabase is already running.'));
}

// 4. Apply any pending migrations — LOCAL ONLY. Never `db push` (that targets
// the linked remote project) and never `db reset` (that would wipe data).
console.log(blue('\nStep 4/6: Applying pending migrations (local only)...'));
try {
  const output = runCmd('npx supabase migration up --local', { silent: true });
  console.log(green('✔ Local database is up to date with migrations.'));
  if (output && !output.includes('"applied":[]')) console.log(output.trim());
} catch (err) {
  fail(`Failed to apply local migrations: ${err.message}`);
}

// 5. Apply the idempotent seed data. Piped straight into the running
// Postgres container's own `psql` — this machine has no system `psql`, and
// `supabase db query --file` cannot run a multi-statement file (Postgres's
// extended query protocol rejects "multiple commands in one prepared
// statement"), so the container's own client is the correct, dependency-free
// way to run a real .sql file. Verified idempotent: running seed.sql twice in
// a row produces zero errors and zero duplicate rows.
console.log(blue('\nStep 5/6: Applying idempotent seed data...'));
try {
  const container = localDbContainerName();
  const seedPath = path.join(REPO_ROOT, 'supabase', 'seed.sql');
  const seedSql = fs.readFileSync(seedPath);
  execSync(`docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1`, {
    input: seedSql,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log(green('✔ Seed data applied (idempotent — safe to run every time).'));
} catch (err) {
  fail(`Failed to apply seed data: ${err.message}`);
}

// 6. Verify the seed actually landed before handing control to the developer.
console.log(blue('\nStep 6/6: Verifying seeded organisation exists...'));
try {
  const container = localDbContainerName();
  const result = execSync(
    `docker exec -i ${container} psql -U postgres -d postgres -t -A -F '|' -c "select id, name from public.organisations where id = '${ORG_ID}'"`,
  ).toString().trim();
  const [id = '', name = ''] = result.split('|');
  const verification = verifySeededOrganisation({ id, name });
  if (!verification.ok) fail(`Seed verification failed: ${verification.error}.`);
  console.log(green(`✔ Seeded organisation "${EXPECTED_SEEDED_ORGANISATION.name}" (${ORG_ID}) confirmed.`));
} catch (err) {
  fail(`Could not verify seed data: ${err.message}`);
}

console.log(blue('\n=== Environment Ready ==='));
console.log(`Local Web App:     ${green('http://localhost:3001')}`);
console.log(`Supabase Studio:   ${green('http://127.0.0.1:54323')}`);
console.log(`Mail Catcher:      ${green('http://127.0.0.1:54324')}`);
console.log(`Staff Account:     ${green('Bodevilliz@gmail.com')} (role: lead)`);
console.log(`Client Workspace:  ${green(EXPECTED_SEEDED_ORGANISATION.name)} (${ORG_ID})`);
console.log(`Database resets:   ${yellow('manual only')} — run \`npm run db:reset:local\` yourself when you need one.`);
console.log(blue('==========================\n'));

// 7. Refuse to boot a second Next.js instance on top of one already running.
//
// A previous incident: repeated `dev:local` runs across sessions left several
// orphaned `next dev` processes all bound to port 3001 (including one from
// this repo's pre-move path). Requests were then served nondeterministically
// by whichever process's listener happened to accept the connection — and
// since a React Server Action's reference ID is generated per compiled
// process, a page rendered by one instance but submitted while a *different*
// instance answered would silently fail (net::ERR_ABORTED, no server log, no
// user-facing error) with the draft left exactly as it was. That looked like
// an application bug in the approval workflow; it was actually this.
console.log(blue('\nChecking port 3001 is not already in use...'));

/**
 * The working directory of a running process, or null if it cannot be read.
 *
 * This is the identity check. macOS has no /proc and `ps` cannot report another
 * process's cwd, so `lsof -d cwd` is the only reliable source. It reads nothing
 * but a path — no environment, no secrets.
 */
function processCwd(pid) {
  const output = runCmd(`lsof -a -p ${pid} -d cwd -Fn`, { silent: true, ignoreError: true });
  if (!output) return null;
  const line = output.split('\n').find((l) => l.startsWith('n'));
  if (!line) return null;
  try {
    return fs.realpathSync(line.slice(1).trim());
  } catch {
    return null;
  }
}

const portOwnerOutput = runCmd('lsof -tiTCP:3001 -sTCP:LISTEN', { silent: true, ignoreError: true });
const portOwnerPids = portOwnerOutput ? [...new Set(portOwnerOutput.trim().split('\n').filter(Boolean))] : [];

if (portOwnerPids.length) {
  // Answering on the port is liveness, not identity, and the two are not the
  // same thing. Every sibling Git worktree of this repo serves a byte-identical
  // /login, so a 200 here only ever proved "some Genesis-shaped app replied" —
  // never "the app in *this* worktree, built from *this* source". Establish the
  // listener's identity from the OS first, and only then ask whether it works.
  const rootRealPath = fs.realpathSync(REPO_ROOT);
  const foreign = portOwnerPids
    .map((pid) => ({ pid, cwd: processCwd(pid) }))
    .filter((owner) => owner.cwd !== rootRealPath);

  if (foreign.length) {
    const describe = foreign
      .map((owner) => `pid ${owner.pid} (${owner.cwd ? `working directory ${owner.cwd}` : 'working directory unreadable'})`)
      .join(', ');
    fail(
      `Port 3001 is held by a process that does not belong to this worktree: ${describe}. ` +
        `This worktree is ${rootRealPath}. ` +
        'Refusing to reuse it — serving a different checkout at the address this worktree expects is how "I fixed it but nothing changed" happens. ' +
        'Refusing to kill it too, because it may be another worktree you are deliberately running. ' +
        'Stop it yourself, or free the port, then run `npm run dev:local` again.',
    );
  }

  // The listener is genuinely this worktree's server, so a duplicate must not be
  // spawned on top of it (orphaned instances answering the same port served
  // React Server Action IDs from a process that never compiled them — the
  // silent "stuck in review" failure). But it still has to actually be serving:
  // removing .next underneath a running `next dev` leaves the process alive and
  // listening while every route 500s on a missing .next/routes-manifest.json,
  // and it never rebuilds that file. Reusing that is reusing a dead environment.
  const loginStatus = (() => {
    try {
      return runCmd('curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/login --max-time 5', {
        silent: true,
      }).trim();
    } catch {
      return 'no response';
    }
  })();

  if (loginStatus === '200') {
    console.log(green('✔ This worktree\'s dev server is already running and healthy on port 3001 — reusing it, not spawning a duplicate.'));
    console.log(blue('\n=== Environment Ready (already running) ==='));
    console.log(`Local Web App:     ${green('http://localhost:3001')}`);
    console.log(blue('==========================\n'));
    process.exit(0);
  }

  fail(
    `This worktree's own dev server (pid ${portOwnerPids.join(', ')}) is still listening on port 3001 but is no longer serving: /login answered ${loginStatus} instead of 200. ` +
      'The usual cause is that `.next` was deleted while the server was running — Next.js keeps the process alive and listening, fails every request with ENOENT on `.next/routes-manifest.json`, and never rebuilds it, so it will not recover on its own. ' +
      `Stop it and start clean: \`kill ${portOwnerPids.join(' ')}\`, then run \`npm run dev:local\` again. ` +
      'Stop the server before deleting `.next`, never the other way round.',
  );
}
console.log(green('✔ Port 3001 is free.'));

console.log(blue('Booting Next.js on port 3001...\n'));
const devServer = spawn('npm', ['run', 'dev', '--', '-p', '3001'], {
  stdio: 'inherit',
  shell: true,
  cwd: REPO_ROOT,
  env: { ...process.env, PORT: '3001' },
});

devServer.on('error', (err) => {
  console.error(red('✘ Failed to start Next.js development server:'), err.message);
});

process.on('SIGINT', () => {
  devServer.kill('SIGINT');
  process.exit(0);
});
