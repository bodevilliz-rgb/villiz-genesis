import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { routes } from "@/lib/routes";

const root = resolve(__dirname, "..");

/** Every TypeScript file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("routing surface", () => {
  it("builds nested MemBrain URLs from ids", () => {
    expect(routes.organisations.membrain.entry("org-1", "entry-1"))
      .toBe("/organisations/org-1/membrain/entry-1");
    expect(routes.organisations.membrain.history("org-1", "entry-1"))
      .toBe("/organisations/org-1/membrain/entry-1/history");
  });

  it("has a page on disk for every route it can produce", () => {
    const pages = [
      "src/app/login/page.tsx",
      "src/app/(workspace)/dashboard/page.tsx",
      "src/app/(workspace)/settings/page.tsx",
      "src/app/(workspace)/organisations/page.tsx",
      "src/app/(workspace)/organisations/new/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/team/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/settings/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/membrain/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/membrain/new/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/membrain/[entryId]/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/membrain/[entryId]/edit/page.tsx",
      "src/app/(workspace)/organisations/[orgId]/membrain/[entryId]/history/page.tsx",
    ];

    for (const page of pages) {
      expect(existsSync(resolve(root, page)), `missing ${page}`).toBe(true);
    }
  });
});

describe("Sprint 2 surface is advertised but inert", () => {
  it("ships no route for any Sprint 2 feature", () => {
    const sprintTwo = [
      "src/app/(workspace)/content",
      "src/app/(workspace)/campaigns",
      "src/app/(workspace)/media",
    ];

    for (const route of sprintTwo) {
      expect(existsSync(resolve(root, route)), `${route} should not exist yet`).toBe(false);
    }
  });

  it("marks Sprint 2 navigation as disabled rather than linking nowhere", async () => {
    const nav = await readFile(resolve(root, "src/components/shell/sidebar-nav.tsx"), "utf8");

    // A disabled item is honest about what is not built. A live link to a 404
    // is not, and neither is hiding the roadmap entirely.
    expect(nav).toMatch(/disabled/i);
    expect(nav).toMatch(/href/);
  });
});

describe("service role key containment", () => {
  it("is never referenced outside server-only infrastructure", async () => {
    const offenders: string[] = [];

    for (const file of walk(resolve(root, "src"))) {
      const contents = await readFile(file, "utf8");
      if (!contents.includes("SUPABASE_SERVICE_ROLE_KEY")) continue;

      const relative = file.replace(root + "/", "");
      const allowed =
        relative === "src/lib/env.ts" || relative === "src/infrastructure/supabase/admin-client.ts";

      if (!allowed) offenders.push(relative);

      // Wherever it appears, the file must be unusable from a client bundle.
      if (relative.startsWith("src/infrastructure")) {
        expect(contents.includes('import "server-only"'), `${relative} must import server-only`).toBe(
          true,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it("ships no client-side Supabase credential path at all", () => {
    // Sign-in runs through a Server Action, so no browser code ever constructs
    // a Supabase client. Removing that path means no Supabase credential —
    // not even the public anon key — is inlined into a client bundle.
    expect(existsSync(resolve(root, "src/infrastructure/supabase/browser-client.ts"))).toBe(false);

    for (const file of walk(resolve(root, "src/components"))) {
      const contents = readFileSync(file, "utf8");
      expect(contents).not.toMatch(/NEXT_PUBLIC_SUPABASE/);
      expect(contents).not.toMatch(/@supabase\/(ssr|supabase-js)/);
    }
  });

  it("never marks the service role key as a public environment variable", async () => {
    const example = await readFile(resolve(root, ".env.example"), "utf8");
    expect(example).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE/);
    expect(example).toMatch(/SUPABASE_SERVICE_ROLE_KEY=/);
  });
});
