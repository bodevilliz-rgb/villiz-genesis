/**
 * npm run cloud:check
 *
 * Read-only health check for the Supabase cloud pilot project. Every
 * operation here is a SELECT, a storage bucket lookup, or a GET request to
 * Blotato — nothing here ever writes a row, uploads a file, deletes
 * anything, or calls Blotato's POST /posts. Loads .env.cloud.local only,
 * with the exact same "must be HTTPS, must not be local" guard as
 * dev-cloud.js and worker-publishing-cloud.ts.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const REPO_ROOT = path.resolve(__dirname, "..");
const CLOUD_ENV_PATH = path.join(REPO_ROOT, ".env.cloud.local");

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const blue = (text: string) => `\x1b[34m${text}\x1b[0m`;

/** The tables every core surface of this app reads from — a deliberately representative subset, not every table in the schema. */
const REQUIRED_TABLES = [
  "organisations",
  "organisation_members",
  "profiles",
  "content_drafts",
  "content_draft_assets",
  "campaigns",
  "media_assets",
  "publishing_jobs",
  "publishing_attempts",
  "blotato_accounts",
  "membrain_entries",
];

const STORAGE_BUCKET = "organisation-media";

let hadCriticalFailure = false;

function pass(message: string) {
  console.log(green(`✔ ${message}`));
}

function criticalFail(message: string) {
  console.log(red(`✘ ${message}`));
  hadCriticalFailure = true;
}

function warn(message: string) {
  console.log(yellow(`⚠ ${message}`));
}

function fail(message: string): never {
  console.error(red(`✘ ${message}`));
  process.exit(1);
}

async function main() {
  console.log(blue("=== Cloud Pilot Health Check (read-only) ==="));

  if (!existsSync(CLOUD_ENV_PATH)) {
    fail(".env.cloud.local is missing. This check never falls back to .env.local — create it first.");
  }
  process.loadEnvFile(CLOUD_ENV_PATH);

  const requiredVars = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = requiredVars.filter((key) => !process.env[key] || process.env[key]!.trim() === "");
  if (missing.length > 0) {
    fail(`.env.cloud.local is missing required variable(s): ${missing.join(", ")}.`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") is not a valid URL.`);
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (parsed.protocol !== "https:" || localHostnames.has(parsed.hostname.toLowerCase()) || parsed.hostname.endsWith(".local")) {
    fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") does not look like a real cloud Supabase project. Refusing to run.`);
  }
  console.log(`Target: ${green(parsed.hostname)}\n`);

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. Reachability + service credential — a single cheap query proves both at once.
  console.log(blue("Checking Supabase reachability + service credential..."));
  try {
    const { error } = await client.from("organisations").select("id").limit(1);
    if (error) throw error;
    pass("Cloud Supabase is reachable and the service-role credential works.");
  } catch (error) {
    criticalFail(`Could not reach Supabase or the service credential is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Required tables exist.
  console.log(blue("\nChecking required tables exist..."));
  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await client.from(table).select("*", { count: "exact", head: true });
      if (error) throw error;
      pass(`Table "${table}" exists.`);
    } catch (error) {
      criticalFail(`Table "${table}" check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Storage bucket exists.
  console.log(blue("\nChecking storage bucket exists..."));
  try {
    const { data, error } = await client.storage.getBucket(STORAGE_BUCKET);
    if (error) throw error;
    if (!data) throw new Error("Bucket lookup returned no data.");
    pass(`Storage bucket "${STORAGE_BUCKET}" exists.`);
  } catch (error) {
    criticalFail(`Storage bucket "${STORAGE_BUCKET}" check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 4. Blotato credentials — read-only GET /users/me/accounts, never publishPost.
  console.log(blue("\nChecking Blotato credentials..."));
  const blotatoEnabled = process.env.BLOTATO_ENABLED === "true";
  const blotatoApiKey = process.env.BLOTATO_API_KEY;
  if (!blotatoEnabled || !blotatoApiKey) {
    warn("Blotato is not configured (BLOTATO_ENABLED/BLOTATO_API_KEY absent) — skipping, not a failure.");
  } else {
    try {
      const { HttpBlotatoClient } = await import("../src/infrastructure/blotato/http-blotato-client");
      const blotatoClient = new HttpBlotatoClient(blotatoApiKey);
      const accounts = await blotatoClient.listAccounts();
      pass(`Blotato credentials work — ${accounts.length} connected account(s) found.`);
    } catch (error) {
      criticalFail(`Blotato credential check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(blue("\n=== Safety confirmation ==="));
  pass("No destructive write was performed by this check (every operation above was read-only).");
  pass("No live publication was attempted (publishPost was never called).");

  console.log(blue("\n=== Result ==="));
  if (hadCriticalFailure) {
    console.log(red("Cloud check FAILED — see ✘ lines above."));
    process.exit(1);
  }
  console.log(green("Cloud check PASSED."));
}

main().catch((error) => {
  console.error(red(`✘ Cloud check crashed: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});
