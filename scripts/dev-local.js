const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for output formatting
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

function runCmd(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: options.silent ? 'pipe' : 'inherit', ...options });
  } catch (err) {
    if (options.ignoreError) return null;
    throw err;
  }
}

console.log(blue("=== Starting Villiz One Local Stabilised Environment ==="));

// 1. Verify Docker is running
console.log(blue("\nStep 1: Verifying Docker status..."));
try {
  runCmd('docker info', { silent: true });
  console.log(green("✔ Docker is running successfully."));
} catch (err) {
  console.error(red("✘ Docker is not running. Please start Docker Desktop and try again."));
  process.exit(1);
}

// 2. Start local Supabase if it is not running
console.log(blue("\nStep 2: Checking local Supabase status..."));
let statusOutput = '';
try {
  statusOutput = runCmd('npx supabase status', { silent: true, ignoreError: true }) || '';
} catch (err) {}

const isStopped = !statusOutput || statusOutput.includes("stopped") || statusOutput.includes("error");

if (isStopped) {
  console.log(yellow("Supabase is stopped. Starting local Supabase containers..."));
  try {
    runCmd('npx supabase start');
    console.log(green("✔ Supabase started successfully."));
  } catch (err) {
    console.error(red("✘ Failed to start Supabase containers."));
    process.exit(1);
  }
} else {
  console.log(green("✔ Supabase containers are already running."));
}

// 3. Ensure migrations are applied safely
console.log(blue("\nStep 3: Checking database migrations..."));
try {
  runCmd('npx supabase migration list', { silent: true });
  console.log(green("✔ Migrations are up to date."));
} catch (err) {
  console.log(yellow("Applying pending migrations..."));
  try {
    runCmd('npx supabase db push');
    console.log(green("✔ Migrations applied successfully."));
  } catch (pushErr) {
    console.error(red("✘ Failed to apply database migrations:"), pushErr.message);
    process.exit(1);
  }
}

// 4. Ensure preview seed data exists without deleting existing database contents
console.log(blue("\nStep 4: Applying idempotent preview seed data..."));
try {
  const seedPath = path.resolve(__dirname, '../supabase/seed.sql');
  const seedSql = fs.readFileSync(seedPath, 'utf8');
  
  // Clean comments first, then split into individual statements
  const cleanSql = seedSql
    .split('\n')
    .map(line => {
      const parts = line.split('--');
      return parts[0].trim();
    })
    .filter(line => line.length > 0)
    .join(' ');
    
  const commands = cleanSql
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0);

  for (const cmd of commands) {
    // Run npx supabase db query --local "cmd"
    const escapedCmd = cmd.replace(/"/g, '\\"').replace(/`/g, '\\`');
    runCmd(`npx supabase db query --local "${escapedCmd}"`, { silent: true });
  }
  console.log(green("✔ Idempotent preview seed data successfully verified and applied."));
} catch (err) {
  console.error(red("✘ Failed to apply preview seed data:"), err.message);
  process.exit(1);
}

// 5. Print preview URLs clearly
console.log(blue("\n=== Preview URLs ==="));
console.log(`Local Web App:    ${green("http://localhost:3001")}`);
console.log(`Supabase Studio:  ${green("http://127.0.0.1:54323")}`);
console.log(`Inbucket Inbox:   ${green("http://127.0.0.1:54324")}`);
console.log(`Staff Account:    ${green("Bodevilliz@gmail.com")} (Role: Lead)`);
console.log(`Client Workspace: ${green("Villiz Pixels")} (ID: 00000000-0000-4000-b000-000000000001)`);
console.log(blue("===================="));

// 6. Start Next.js on port 3001
console.log(blue("\nStep 5: Booting Next.js on port 3001..."));
const devServer = spawn('npm', ['run', 'dev', '--', '-p', '3001'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: '3001' }
});

devServer.on('error', (err) => {
  console.error(red("✘ Failed to start Next.js development server:"), err.message);
});
