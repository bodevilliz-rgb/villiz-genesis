import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/dev-local.js", "utf8");

/**
 * Port 3001 answering is not proof that the right application answered.
 *
 * Every sibling worktree of this repo serves an identical /login, so the old
 * "did something reply 200?" check would happily hand the developer a different
 * checkout — or this worktree's own dev server after `.next` was deleted out
 * from under it, which stays listening while every route 500s on a missing
 * routes-manifest.json and never recovers.
 */
describe("dev:local port ownership identity", () => {
  it("resolves the listening process's working directory", () => {
    expect(source).toContain("function processCwd(pid)");
    expect(source).toContain("lsof -a -p ${pid} -d cwd -Fn");
  });

  it("compares the listener against this worktree by real path", () => {
    expect(source).toContain("fs.realpathSync(REPO_ROOT)");
    expect(source).toContain("owner.cwd !== rootRealPath");
  });

  it("checks identity BEFORE liveness, so a foreign 200 can never be reused", () => {
    const identityCheck = source.indexOf("if (foreign.length)");
    const livenessCheck = source.indexOf("const loginStatus");
    const reuse = source.indexOf("reusing it, not spawning a duplicate");

    expect(identityCheck).toBeGreaterThan(-1);
    expect(livenessCheck).toBeGreaterThan(identityCheck);
    expect(reuse).toBeGreaterThan(livenessCheck);
  });

  it("refuses a foreign process instead of killing it", () => {
    expect(source).toContain("does not belong to this worktree");
    // Another worktree may be running deliberately; never terminate it for them.
    expect(source).not.toMatch(/xargs kill|process\.kill\(/);
  });

  it("treats an unreadable working directory as foreign, never as our own", () => {
    // processCwd returns null when lsof cannot report; null !== rootRealPath,
    // so it falls into `foreign` and is refused rather than trusted.
    expect(source).toContain("working directory unreadable");
  });

  it("refuses this worktree's own server when it is listening but not serving", () => {
    expect(source).toContain("is still listening on port 3001 but is no longer serving");
    expect(source).toContain(".next/routes-manifest.json");
  });

  it("only reuses on a 200 from a process proven to be this worktree", () => {
    expect(source).toContain("if (loginStatus === '200')");
  });

  it("handles several listeners on the port rather than only the first", () => {
    expect(source).toContain("portOwnerOutput.trim().split('\\n').filter(Boolean)");
    expect(source).toContain("new Set(");
  });
});
