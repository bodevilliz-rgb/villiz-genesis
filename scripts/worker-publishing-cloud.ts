/**
 * Cloud pilot entrypoint for the background publishing worker.
 *
 *   npm run worker:publishing:cloud
 *
 * Deliberately does NOT reuse publishing-worker.ts's loadLocalEnv() — this
 * process loads .env.cloud.local only, and nothing else. If a required
 * variable isn't in that file, it stays unset; it is never silently filled
 * in from .env.local or .env. See publishing-worker-core.ts's own note on
 * why the shared runtime was extracted specifically to make this guarantee
 * possible.
 *
 * Two supported ways to supply configuration, both ending in the same
 * validation below:
 *   1. Local cloud-pilot use: a real .env.cloud.local file in the repo root
 *      (see docs/LOCAL_DEVELOPMENT.md) — loaded if present.
 *   2. A real hosting platform (Sprint 8.0 — Render): the platform injects
 *      environment variables directly into process.env; there is no
 *      .env.cloud.local file on disk at all, and none should be created
 *      there. This is why the file is loaded only when it exists rather than
 *      required to exist — Render's dashboard/render.yaml env vars are
 *      already process.env by the time this script runs.
 *
 * Never falls back to a local Supabase URL either way: if a required
 * variable is missing from whichever source supplied it, or the Supabase
 * URL looks local, this process exits before calling runWorker() at all.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { runWorker, log } from "./publishing-worker-core";

const REPO_ROOT = path.resolve(__dirname, "..");
const CLOUD_ENV_PATH = path.join(REPO_ROOT, ".env.cloud.local");

const REQUIRED_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✘ ${message}`);
  process.exit(1);
}

function redactedHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "[unparseable]";
  }
}

function main() {
  if (existsSync(CLOUD_ENV_PATH)) {
    process.loadEnvFile(CLOUD_ENV_PATH);
  }

  const missing = REQUIRED_VARS.filter((key) => !process.env[key] || process.env[key]!.trim() === "");
  if (missing.length > 0) {
    fail(
      `Missing required variable(s): ${missing.join(", ")}. Either create .env.cloud.local in the repo root (local cloud-pilot use — see docs/LOCAL_DEVELOPMENT.md) or set them directly in your hosting platform's environment (production — see docs/RENDER_WORKER.md).`,
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") is not a valid URL.`);
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (parsed.protocol !== "https:" || localHostnames.has(parsed.hostname.toLowerCase()) || parsed.hostname.endsWith(".local")) {
    fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") does not look like a real cloud Supabase project. Refusing to start.`);
  }

  const blotatoEnabled = process.env.BLOTATO_ENABLED === "true";
  const livePublishing = process.env.BLOTATO_LIVE_PUBLISHING_ENABLED === "true";

  // eslint-disable-next-line no-console
  console.log("=== Cloud Publishing Worker — startup summary ===");
  // eslint-disable-next-line no-console
  console.log(`environment=cloud`);
  // eslint-disable-next-line no-console
  console.log(`supabase_host=${redactedHostname(supabaseUrl)}`);
  // eslint-disable-next-line no-console
  console.log(`blotato_enabled=${blotatoEnabled}`);
  // eslint-disable-next-line no-console
  console.log(`live_publishing=${livePublishing}`);
  // eslint-disable-next-line no-console
  console.log("==================================================");

  return runWorker();
}

main().catch((error) => {
  log("worker_fatal_error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
