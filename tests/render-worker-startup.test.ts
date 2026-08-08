import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const CLOUD_ENTRYPOINT_PATH = path.join(REPO_ROOT, "scripts", "worker-publishing-cloud.ts");
const RENDER_YAML_PATH = path.join(REPO_ROOT, "render.yaml");
const ENV_SCHEMA_PATH = path.join(REPO_ROOT, "src", "lib", "env.ts");

/**
 * Text-based assertions on the cloud worker startup entrypoint and its
 * deployment config.
 *
 * Root cause context: `serverEnv()` (called via `createAdminClient()` on every
 * poll tick) validates `NEXT_PUBLIC_SITE_URL` as z.string().url(). The cloud
 * worker's REQUIRED_VARS previously omitted it — the startup check passed but
 * the worker crashed on the first tick. These tests make that regression
 * permanently detectable.
 */
describe("render worker — startup validation", () => {
  const entrypoint = readFileSync(CLOUD_ENTRYPOINT_PATH, "utf8");
  const renderYaml = readFileSync(RENDER_YAML_PATH, "utf8");
  const envSchema = readFileSync(ENV_SCHEMA_PATH, "utf8");

  it("REQUIRED_VARS includes NEXT_PUBLIC_SITE_URL", () => {
    expect(entrypoint).toContain("NEXT_PUBLIC_SITE_URL");
    // Must be inside the REQUIRED_VARS array (square bracket check)
    const arrayStart = entrypoint.indexOf("REQUIRED_VARS = [");
    const arrayEnd = entrypoint.indexOf("];", arrayStart);
    expect(arrayStart).toBeGreaterThan(-1);
    const arrayBody = entrypoint.slice(arrayStart, arrayEnd + 2);
    expect(arrayBody).toContain('"NEXT_PUBLIC_SITE_URL"');
  });

  it("REQUIRED_VARS includes all three Supabase variables", () => {
    const arrayStart = entrypoint.indexOf("REQUIRED_VARS = [");
    const arrayEnd = entrypoint.indexOf("];", arrayStart);
    const arrayBody = entrypoint.slice(arrayStart, arrayEnd + 2);
    expect(arrayBody).toContain('"NEXT_PUBLIC_SUPABASE_URL"');
    expect(arrayBody).toContain('"NEXT_PUBLIC_SUPABASE_ANON_KEY"');
    expect(arrayBody).toContain('"SUPABASE_SERVICE_ROLE_KEY"');
  });

  it("REQUIRED_VARS are all declared in render.yaml", () => {
    // Every var the startup script requires must have a render.yaml entry —
    // otherwise Render deploys a worker that fails on first tick.
    const arrayStart = entrypoint.indexOf("REQUIRED_VARS = [");
    const arrayEnd = entrypoint.indexOf("];", arrayStart);
    const arrayBody = entrypoint.slice(arrayStart, arrayEnd + 2);
    const declared = [...arrayBody.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);

    for (const varName of declared) {
      expect(renderYaml, `${varName} must be declared in render.yaml`).toContain(`key: ${varName}`);
    }
  });

  it("rejects localhost Supabase URLs at startup (local isolation guard)", () => {
    // The cloud entrypoint must check for local hostnames so a developer who
    // accidentally points the cloud worker at their local Supabase gets a
    // clear early failure rather than silently writing to the wrong database.
    expect(entrypoint).toContain("localhost");
    expect(entrypoint).toContain("127.0.0.1");
    expect(entrypoint).toContain(".local");
    expect(entrypoint).toContain("https:");
  });

  it("rejects non-HTTPS Supabase URLs at startup", () => {
    expect(entrypoint).toContain('protocol !== "https:"');
  });

  it("logs startup summary to stdout (not stderr) with safe values only", () => {
    // The startup log MUST show blotato_enabled + live_publishing — these
    // are the two critical config flags for simulation-vs-live mode.
    expect(entrypoint).toContain("blotato_enabled=");
    expect(entrypoint).toContain("live_publishing=");
    // Must NOT log the raw API key or service role key.
    expect(entrypoint).not.toContain("BLOTATO_API_KEY}");
    expect(entrypoint).not.toContain("SUPABASE_SERVICE_ROLE_KEY}");
  });

  it("calls runWorker() and not a one-shot iteration", () => {
    // The Render worker is long-lived: it must call the poll loop, not the
    // single-iteration function used by the internal API route.
    expect(entrypoint).toContain("runWorker()");
    expect(entrypoint).not.toContain("runPublishingWorkerIteration");
  });

  it("serverEnv() schema requires NEXT_PUBLIC_SITE_URL as a URL", () => {
    // Cross-verify against the source of truth: the Zod schema that causes
    // the crash when NEXT_PUBLIC_SITE_URL is absent.
    expect(envSchema).toContain("NEXT_PUBLIC_SITE_URL");
    expect(envSchema).toContain("z.string().url()");
  });

  it("render.yaml declares BLOTATO_LIVE_PUBLISHING_ENABLED=false (simulation-safe default)", () => {
    const keyIndex = renderYaml.indexOf("key: BLOTATO_LIVE_PUBLISHING_ENABLED");
    expect(keyIndex).toBeGreaterThan(-1);
    const slice = renderYaml.slice(keyIndex, keyIndex + 80);
    expect(slice).toMatch(/value:\s*"false"/);
  });

  it("render.yaml declares BLOTATO_ENABLED=true (integration active)", () => {
    const keyIndex = renderYaml.indexOf("key: BLOTATO_ENABLED");
    expect(keyIndex).toBeGreaterThan(-1);
    const slice = renderYaml.slice(keyIndex, keyIndex + 60);
    expect(slice).toMatch(/value:\s*"true"/);
  });

  it("render.yaml autoDeploys from the main branch only", () => {
    expect(renderYaml).toMatch(/branch:\s*main/);
    expect(renderYaml).toMatch(/autoDeploy:\s*true/);
  });

  it("render.yaml never commits a real secret value", () => {
    // Rudimentary leak check — real keys are never committed
    expect(renderYaml).not.toMatch(/sk_live|eyJhbGciOi|sbp_/);
  });
});
