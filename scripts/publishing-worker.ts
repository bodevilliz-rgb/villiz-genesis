/**
 * Local entrypoint for the background publishing worker.
 *
 *   npm run worker:publishing
 *
 * Loads .env.local (falling back to .env) exactly as before Sprint 6E's
 * refactor, then hands off to the shared runtime in
 * publishing-worker-core.ts. See worker-publishing-cloud.ts for the cloud
 * pilot's separate entrypoint — the two never share an env-loading path.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { runWorker, log } from "./publishing-worker-core";

/**
 * This process runs standalone via `tsx`, outside Next.js — which is what
 * normally loads .env.local for the dev server. Load the same file here so
 * the worker sees the same Supabase configuration dev:local's Next.js
 * process does. Uses Node's built-in env-file loader (no `dotenv`
 * dependency needed); harmless wherever the platform already injects real
 * env vars directly and no .env.local file exists.
 */
function loadLocalEnv() {
  for (const candidate of [".env.local", ".env"]) {
    const fullPath = path.resolve(process.cwd(), candidate);
    if (existsSync(fullPath)) process.loadEnvFile(fullPath);
  }
}

loadLocalEnv();

runWorker().catch((error) => {
  log("worker_fatal_error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
