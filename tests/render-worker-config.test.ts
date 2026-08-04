import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RENDER_YAML_PATH = path.resolve(__dirname, "..", "render.yaml");

/**
 * A structural, text-based check rather than a full YAML parse — this repo
 * doesn't have a YAML parser as a direct dependency, and adding one purely
 * for a single config-shape test isn't worth it. render.yaml is small and
 * stable enough that asserting the exact required lines exist is a
 * meaningful regression guard without a new dependency.
 */
describe("render.yaml (Render Background Worker configuration)", () => {
  const raw = readFileSync(RENDER_YAML_PATH, "utf8");

  it("declares a background worker service, not a web service", () => {
    expect(raw).toMatch(/type:\s*worker/);
  });

  it("targets the Node runtime and the main branch", () => {
    expect(raw).toMatch(/runtime:\s*node/);
    expect(raw).toMatch(/branch:\s*main/);
  });

  it("runs the existing cloud publishing worker command, not a new one", () => {
    expect(raw).toContain("npm run worker:publishing:cloud");
  });

  it("pins Node to 22, matching package.json's engines field", () => {
    expect(raw).toMatch(/NODE_VERSION/);
    expect(raw).toMatch(/value:\s*"22"/);
  });

  it("marks every secret env var sync: false so Render never accepts a committed value", () => {
    for (const secretKey of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "BLOTATO_API_KEY",
    ]) {
      const keyIndex = raw.indexOf(`key: ${secretKey}`);
      expect(keyIndex, `${secretKey} should be declared`).toBeGreaterThan(-1);
      const nextLines = raw.slice(keyIndex, keyIndex + 120);
      expect(nextLines, `${secretKey} should be sync: false`).toMatch(/sync:\s*false/);
    }
  });

  it("defaults BLOTATO_LIVE_PUBLISHING_ENABLED to false (never live by default)", () => {
    const keyIndex = raw.indexOf("key: BLOTATO_LIVE_PUBLISHING_ENABLED");
    expect(keyIndex).toBeGreaterThan(-1);
    const nextLines = raw.slice(keyIndex, keyIndex + 80);
    expect(nextLines).toMatch(/value:\s*"false"/);
  });

  it("never contains a real secret value (only sync:false placeholders or safe literals)", () => {
    expect(raw).not.toMatch(/sk_live|eyJhbGciOi/); // common real-secret shapes (Stripe-style / JWT-style)
  });
});
