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

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

const REPO_ROOT = path.resolve(__dirname, '..');
const ORG_ID = '00000000-0000-4000-b000-000000000001';

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
const envPath = path.join(REPO_ROOT, '.env.local');
if (!fs.existsSync(envPath)) {
  fail('.env.local is missing. Copy .env.example to .env.local (values are printed by `npx supabase status` once started).');
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
    `docker exec -i ${container} psql -U postgres -d postgres -t -A -c "select name from public.organisations where id = '${ORG_ID}'"`,
  ).toString().trim();
  if (result !== 'Villiz Pixels') {
    fail(`Seed verification failed: expected organisation "Villiz Pixels" (${ORG_ID}), got "${result || '(none)'}".`);
  }
  console.log(green('✔ Seeded organisation "Villiz Pixels" confirmed.'));
} catch (err) {
  fail(`Could not verify seed data: ${err.message}`);
}

console.log(blue('\n=== Environment Ready ==='));
console.log(`Local Web App:     ${green('http://localhost:3001')}`);
console.log(`Supabase Studio:   ${green('http://127.0.0.1:54323')}`);
console.log(`Mail Catcher:      ${green('http://127.0.0.1:54324')}`);
console.log(`Staff Account:     ${green('Bodevilliz@gmail.com')} (role: lead)`);
console.log(`Client Workspace:  ${green('Villiz Pixels')} (${ORG_ID})`);
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
const portOwnerPid = runCmd('lsof -tiTCP:3001 -sTCP:LISTEN', { silent: true, ignoreError: true });
if (portOwnerPid && portOwnerPid.trim()) {
  const alreadyHealthy = (() => {
    try {
      const status = runCmd('curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/login --max-time 3', {
        silent: true,
      });
      return status.trim() === '200';
    } catch {
      return false;
    }
  })();

  if (alreadyHealthy) {
    console.log(green('✔ A healthy dev server is already running on port 3001 — reusing it, not spawning a duplicate.'));
    console.log(blue('\n=== Environment Ready (already running) ==='));
    console.log(`Local Web App:     ${green('http://localhost:3001')}`);
    console.log(blue('==========================\n'));
    process.exit(0);
  }

  fail(
    `Port 3001 is already in use by another process (pid ${portOwnerPid.trim().split('\n').join(', ')}) that is not answering as this app. ` +
      `Stop it before continuing: \`lsof -tiTCP:3001 -sTCP:LISTEN | xargs kill\`, then run \`npm run dev:local\` again. ` +
      'Never spawn a second Next.js process on top of it — that is exactly how the review-workflow "stuck in review" bug happened before.',
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
