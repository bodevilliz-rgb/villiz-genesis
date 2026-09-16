import { readFileSync, readdirSync } from "node:fs";
import { expect, it, vi } from "vitest";

vi.mock("@/infrastructure/supabase/admin-client", () => ({ createAdminClient: () => { throw new Error("claim client constructed"); } }));
vi.mock("@/core/application/use-cases/publishing/worker", () => ({ runPublishingWorkerIteration: () => { throw new Error("publisher invoked"); } }));

it("retired route cannot construct a client or invoke a publisher even with credentials", async () => {
  const { POST } = await import("@/app/api/internal/publishing/run/route");
  const result = await POST(new Request("http://localhost", { method: "POST" }) as never);
  expect(result.status).toBe(410);
});

it("has no repository cron, n8n or config caller and no alternate worker runtime reference", () => {
  function walk(dir = "."): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      if (["node_modules", ".git", ".next", ".agents", ".codex", "coverage"].includes(entry.name)) return [];
      const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
      return entry.isDirectory() ? walk(path) : /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|sh|py)$/.test(path) ? [path] : [];
    });
  }
  const files = walk();
  const callers = files.filter(f => !f.startsWith("tests/") && !f.startsWith("docs/") && !f.endsWith(".md") && f !== "src/app/api/internal/publishing/run/route.ts")
    .filter(f => readFileSync(f, "utf8").includes("/api/internal/publishing/run"));
  expect(callers).toEqual([]);
  const runtime = files.filter(f => /^(src|scripts)\//.test(f) && /\.[cm]?[jt]sx?$/.test(f));
  const utility = "src/core/application/use-cases/publishing/worker.ts";
  expect(runtime.filter(f => f !== utility && /\brunPublishingWorkerIteration\s*[(,}]/.test(readFileSync(f, "utf8")))).toEqual([]);
  const route = readFileSync("src/app/api/internal/publishing/run/route.ts", "utf8");
  expect(route).not.toMatch(/@\/|createAdminClient|runPublishingWorkerIteration|claimNextJob|publishPost/);
});

it("dedicated reconciliation locks and validates before atomic append, preserves settlement invariants", () => {
  const sql = readFileSync("supabase/migrations/20260907010000_legacy_timeout_reconciliation.sql", "utf8");
  expect(sql).toMatch(/for update/i);
  expect(sql).toMatch(/blotato_status_timeout/);
  expect(sql).toMatch(/insert into public.publishing_attempts/i);
  expect(sql).not.toMatch(/update public.publishing_attempts/i);
  expect(sql).toMatch(/insert into public.audit_events/i);
  expect(sql).toMatch(/insert into public.notifications/i);
  expect(sql).toMatch(/from public, anon, authenticated/);
  expect(sql).toMatch(/to service_role/);
});
