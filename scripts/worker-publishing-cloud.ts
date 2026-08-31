/**
 * Cloud worker entrypoint.
 *
 * One Render background process now runs two independent resilient loops:
 *   - publishing jobs
 *   - Awo campaign optimisation jobs
 *
 * Keeping them in the same worker avoids another hosting service/cost while
 * still moving long AI work completely outside the Vercel request lifecycle.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { runWorker, log } from "./publishing-worker-core";
import { runAwoCampaignWorker, logAwo } from "./awo-campaign-worker-core";

const REPO_ROOT = path.resolve(__dirname, "..");
const CLOUD_ENV_PATH = path.join(REPO_ROOT, ".env.cloud.local");
const REQUIRED_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✘ ${message}`);
  process.exit(1);
}

function redactedHostname(rawUrl: string): string {
  try { return new URL(rawUrl).hostname; } catch { return "[unparseable]"; }
}

function main() {
  if (existsSync(CLOUD_ENV_PATH)) process.loadEnvFile(CLOUD_ENV_PATH);

  const missing = REQUIRED_VARS.filter((key) => !process.env[key] || process.env[key]!.trim() === "");
  if (missing.length > 0) {
    fail(`Missing required variable(s): ${missing.join(", ")}. Set them in the hosting environment before starting the cloud worker.`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  let parsed: URL;
  try { parsed = new URL(supabaseUrl); } catch { fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") is not a valid URL.`); }
  const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (parsed.protocol !== "https:" || localHostnames.has(parsed.hostname.toLowerCase()) || parsed.hostname.endsWith(".local")) {
    fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") does not look like a real cloud Supabase project. Refusing to start.`);
  }

  const blotatoEnabled = process.env.BLOTATO_ENABLED === "true";
  const livePublishing = process.env.BLOTATO_LIVE_PUBLISHING_ENABLED === "true";
  const aiProvider = (process.env.AI_PROVIDER || "openai").toLowerCase();

  // eslint-disable-next-line no-console
  console.log("=== Genesis Cloud Worker — startup summary ===");
  // eslint-disable-next-line no-console
  console.log(`environment=cloud`);
  // eslint-disable-next-line no-console
  console.log(`supabase_host=${redactedHostname(supabaseUrl)}`);
  // eslint-disable-next-line no-console
  console.log(`blotato_enabled=${blotatoEnabled}`);
  // eslint-disable-next-line no-console
  console.log(`live_publishing=${livePublishing}`);
  // eslint-disable-next-line no-console
  console.log(`awo_background_worker=true`);
  // eslint-disable-next-line no-console
  console.log(`ai_provider=${aiProvider}`);
  // eslint-disable-next-line no-console
  console.log("==============================================");

  return Promise.all([runWorker(), runAwoCampaignWorker()]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log("worker_fatal_error", { error: message });
  logAwo("worker_fatal_error", { error: message });
  process.exit(1);
});
