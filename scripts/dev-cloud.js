/**
 * The one official way to run Next.js against the Supabase CLOUD pilot
 * project, side by side with `npm run dev:local` — never instead of
 * understanding the difference between them.
 *
 * This script is the mirror image of dev-local.js's own safety guard: where
 * dev-local.js refuses to start unless NEXT_PUBLIC_SUPABASE_URL is a local
 * address, this script refuses to start unless it is NOT one. Both guards
 * exist for the same reason (History of Issues #4 — alternating between
 * remote and local Supabase by accident) and neither may ever be weakened.
 *
 * It does NOT:
 *   - start local Supabase Docker containers
 *   - run `supabase db reset` (or migrate/push) against anything
 *   - apply supabase/seed.sql
 *   - read .env.local for any variable at all — every value this process
 *     needs comes from .env.cloud.local, loaded before Next.js boots, so
 *     Next's own automatic .env.local loading (which happens regardless,
 *     it is a Next.js built-in) can never override an already-set value.
 *     See publishing-worker-core.ts's own note on why this same pattern
 *     is used for the cloud worker entrypoint too.
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

const REPO_ROOT = path.resolve(__dirname, '..');
const CLOUD_ENV_PATH = path.join(REPO_ROOT, '.env.cloud.local');

// Every key the app can read that isn't part of the cloud file's own
// template — forced to an explicit, safe value below so Next.js never has
// an unset key left over for its automatic .env.local load to silently
// fill in from the LOCAL file sitting right next to it on disk.
const CLOUD_SAFE_DEFAULTS = {
  ALLOWED_EMAIL_DOMAINS: 'villiz.com',
  // Never inherit the local dev-login shortcut into a cloud run, regardless
  // of what .env.local happens to have it set to.
  ENABLE_DEV_LOGIN: 'false',
};

const REQUIRED_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SITE_URL'];

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

console.log(blue('=== Starting Villiz One — CLOUD PILOT ==='));

// 1. .env.cloud.local must exist. This script never touches .env.local.
console.log(blue('\nStep 1/5: Loading .env.cloud.local...'));
if (!fs.existsSync(CLOUD_ENV_PATH)) {
  fail(
    '.env.cloud.local is missing. Create it in the repo root with NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_URL, ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and BLOTATO_* — see docs/LOCAL_DEVELOPMENT.md. ' +
      'This file is gitignored and must never be committed.',
  );
}
process.loadEnvFile(CLOUD_ENV_PATH);
for (const [key, value] of Object.entries(CLOUD_SAFE_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}
console.log(green('✔ .env.cloud.local loaded.'));

// 2. Every variable the app actually needs to boot must be present.
console.log(blue('\nStep 2/5: Verifying required cloud variables are present...'));
const missing = REQUIRED_VARS.filter((key) => !process.env[key] || process.env[key].trim() === '');
if (missing.length > 0) {
  fail(`.env.cloud.local is missing required variable(s): ${missing.join(', ')}. Fill them in and try again.`);
}
console.log(green(`✔ All required variables present (${REQUIRED_VARS.join(', ')}).`));

// 3. The inverse of dev-local.js's own guard: refuse anything that looks local.
console.log(blue('\nStep 3/5: Verifying NEXT_PUBLIC_SUPABASE_URL is a real HTTPS cloud address...'));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") is not a valid URL.`);
}
if (parsedUrl.protocol !== 'https:') {
  fail(`NEXT_PUBLIC_SUPABASE_URL must be HTTPS for the cloud pilot. Got: ${parsedUrl.protocol}`);
}
const localHostnames = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
if (localHostnames.includes(parsedUrl.hostname.toLowerCase()) || parsedUrl.hostname.endsWith('.local')) {
  fail(
    `NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") points at a local address. ` +
      'Refusing to run dev:cloud against local Supabase — use `npm run dev:local` for that instead.',
  );
}
console.log(green(`✔ Supabase host is a real cloud address (${parsedUrl.hostname}).`));

// 4. Say out loud what this run will never do — the absence of Docker/reset/
// seed code below is deliberate, not an oversight.
console.log(blue('\nStep 4/5: Cloud pilot safety guarantees for this run...'));
console.log(yellow('  • Will NOT start local Supabase Docker containers.'));
console.log(yellow('  • Will NOT run `supabase db reset` or any migration command.'));
console.log(yellow('  • Will NOT apply supabase/seed.sql.'));
console.log(yellow('  • Will NOT read .env.local for any variable.'));
console.log(green('✔ Safety guarantees confirmed.'));

// 5. Refuse to boot a second Next.js instance on top of one already running
// (same orphaned-process failure mode dev-local.js guards against).
console.log(blue('\nStep 5/5: Checking port 3001 is not already in use...'));
const portOwnerPid = runCmd('lsof -tiTCP:3001 -sTCP:LISTEN', { silent: true, ignoreError: true });
if (portOwnerPid && portOwnerPid.trim()) {
  fail(
    `Port 3001 is already in use (pid ${portOwnerPid.trim().split('\n').join(', ')}). ` +
      'Stop it before continuing: `lsof -tiTCP:3001 -sTCP:LISTEN | xargs kill`, then run `npm run dev:cloud` again.',
  );
}
console.log(green('✔ Port 3001 is free.'));

console.log(blue('\n=== Cloud Pilot Environment Ready ==='));
console.log(`Web App:         ${green('http://localhost:3001')}`);
console.log(`Supabase project: ${green(parsedUrl.hostname)}`);
console.log(`Blotato:          ${green(process.env.BLOTATO_ENABLED === 'true' ? 'enabled' : 'disabled')} | live publishing: ${process.env.BLOTATO_LIVE_PUBLISHING_ENABLED === 'true' ? red('TRUE — real posts can go out') : green('false')}`);
console.log(blue('==========================\n'));

console.log(blue('Booting Next.js on port 3001 against the cloud project...\n'));
const devServer = spawn('npx', ['next', 'dev', '-p', '3001'], {
  stdio: 'inherit',
  cwd: REPO_ROOT,
  env: process.env,
});

devServer.on('error', (err) => {
  console.error(red('✘ Failed to start Next.js development server:'), err.message);
});

process.on('SIGINT', () => {
  devServer.kill('SIGINT');
  process.exit(0);
});
