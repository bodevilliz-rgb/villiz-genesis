import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/dev-local.js", "utf8");

describe("local development environment in Git worktrees", () => {
  it("uses the current worktree environment first", () => {
    expect(source).toContain("if (fs.existsSync(worktreeEnv)) return { envPath: worktreeEnv, source: 'worktree' }");
  });

  it("resolves the primary checkout without hardcoding a repository path", () => {
    expect(source).toContain("git rev-parse --path-format=absolute --git-common-dir");
    expect(source).toContain("path.join(path.dirname(commonDir), '.env.local')");
    expect(source).not.toContain("villiz-genesis/.env.local");
  });

  it("still refuses non-local Supabase URLs", () => {
    expect(source).toContain("localUrlPattern");
    expect(source).toContain("Refusing to start against what looks like a remote project");
  });

  it("loads values into the child environment without copying or logging secrets", () => {
    expect(source).toContain("require('@next/env').loadEnvConfig");
    expect(source).toContain("env: { ...process.env, PORT: '3001' }");
    expect(source).not.toMatch(/copyFile|writeFile/);
  });
});
