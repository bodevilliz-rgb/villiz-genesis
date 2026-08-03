/**
 * Sprint 7.1 — Operation Iron Shield.
 *
 *   npm run reliability:test
 *
 * A repeatable, automated go/no-go check for the publishing engine — NOT a
 * parallel publishing engine, NOT a live-publishing smoke test. Every check
 * exercises the real use-cases and domain/publisher classes this app ships
 * (src/core/application/use-cases/*, src/infrastructure/publishers/blotato/
 * *), faking only the outermost repository/client ports, exactly the way
 * tests/*.test.ts already does throughout this codebase. It never sends a
 * real Blotato post, never requires production credentials, and never
 * requires Docker to produce a report (the DB-tier checks in db-tier-
 * checks.ts auto-skip with a clear reason if local Supabase isn't running).
 *
 * See docs/RELIABILITY_TESTING.md for the full design, classification rules,
 * and how to add a new check.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allInMemoryChecks } from "./reliability/in-memory-checks";
import { allDbTierChecks } from "./reliability/db-tier-checks";
import { blotatoConnectivityCheck } from "./reliability/blotato-connectivity";
import { renderConsoleReport, renderMarkdownReport } from "./reliability/report";
import type { CheckResult, ReleaseRecommendation, ReliabilityCheck, ReliabilityReport } from "./reliability/types";

const REPO_ROOT = path.resolve(__dirname, "..");
const REPORT_DIR = path.join(REPO_ROOT, "reports", "reliability");

const KNOWN_LIMITATIONS = [
  "Worker job claim exclusivity, worker restart recovery, the database's own duplicate-publish unique constraint, and organisation isolation are only proven against a real Postgres connection when the local Supabase stack (npm run dev:local / npx supabase start) is running — otherwise those specific mandatory checks report SKIP with a clear reason, and are excluded from the Core Reliability Score rather than silently failing or passing.",
  "Provider status polling for '429 with Retry-After' and '500 provider error' verifies that such errors propagate cleanly (never silently reported as a false success) — the current architecture has no in-poll retry-after/backoff handling inside BlotatoPublisherBase.pollForFinalStatus itself; recovery for a job stuck mid-flight happens via the worker's existing stale-job recovery pass, not an in-poll retry. This is documented existing behaviour, not a gap introduced by this suite.",
  "Organisation isolation is proven at the application/repository layer (organisation-scoped queries never return another organisation's row) against a real database. It does not additionally simulate a signed end-user JWT to exercise RLS policies directly — the service-role client this suite uses bypasses RLS by design.",
  "Blotato connectivity (GET /users/me/accounts) only runs when RELIABILITY_CHECK_BLOTATO_CONNECTION=true is explicitly set, and only ever performs read-only calls — it is never required for a normal run and never affects the Core Reliability Score.",
];

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function runCheck(check: ReliabilityCheck): Promise<CheckResult> {
  const started = Date.now();
  try {
    const outcome = await check.run();
    const durationMs = Date.now() - started;
    if (outcome && "skip" in outcome) {
      return { name: check.name, classification: check.classification, status: "SKIP", durationMs, message: outcome.skip };
    }
    const detail = outcome && "detail" in outcome ? outcome.detail : undefined;
    return { name: check.name, classification: check.classification, status: "PASS", durationMs, detail };
  } catch (error) {
    const durationMs = Date.now() - started;
    return {
      name: check.name,
      classification: check.classification,
      status: "FAIL",
      durationMs,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function computeReport(results: CheckResult[], startedAt: Date, runId: string): ReliabilityReport {
  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.status === "PASS").length;
  const failedChecks = results.filter((r) => r.status === "FAIL").length;
  const skippedChecks = results.filter((r) => r.status === "SKIP").length;

  const mandatoryResults = results.filter((r) => r.classification === "MANDATORY");
  const mandatoryRan = mandatoryResults.filter((r) => r.status !== "SKIP");
  const mandatoryPassed = mandatoryRan.filter((r) => r.status === "PASS").length;
  const coreReliabilityScore = mandatoryRan.length === 0 ? null : Math.round((mandatoryPassed / mandatoryRan.length) * 10000) / 100;

  const externalResults = results.filter((r) => r.classification === "EXTERNAL");
  const externalRan = externalResults.filter((r) => r.status !== "SKIP");
  const externalDependencyStatus: ReliabilityReport["externalDependencyStatus"] =
    externalRan.length === 0 ? "not_requested" : externalRan.some((r) => r.status === "FAIL") ? "some_failed" : "all_passed";

  const anyMandatoryFailed = mandatoryResults.some((r) => r.status === "FAIL");
  const anyMandatorySkipped = mandatoryResults.some((r) => r.status === "SKIP");
  const anyAdvisoryFailed = results.some((r) => r.classification === "ADVISORY" && r.status === "FAIL");

  let releaseRecommendation: ReleaseRecommendation;
  if (anyMandatoryFailed) {
    releaseRecommendation = "NOT READY";
  } else if (anyMandatorySkipped || anyAdvisoryFailed || externalDependencyStatus === "some_failed") {
    releaseRecommendation = "READY WITH WARNINGS";
  } else {
    releaseRecommendation = "READY";
  }

  return {
    runId,
    timestamp: startedAt.toISOString(),
    gitCommit: gitCommit(),
    environment: "isolated-test",
    totalChecks,
    passedChecks,
    failedChecks,
    skippedChecks,
    coreReliabilityScore,
    externalDependencyStatus,
    releaseRecommendation,
    durationMs: Date.now() - startedAt.getTime(),
    results,
    knownLimitations: KNOWN_LIMITATIONS,
  };
}

async function main() {
  const startedAt = new Date();
  const runId = randomUUID();

  const allChecks: ReliabilityCheck[] = [...allInMemoryChecks, ...allDbTierChecks, blotatoConnectivityCheck];

  const results: CheckResult[] = [];
  for (const check of allChecks) {
    results.push(await runCheck(check));
  }

  const report = computeReport(results, startedAt, runId);

  console.log(renderConsoleReport(report));

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(path.join(REPORT_DIR, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(path.join(REPORT_DIR, "latest.md"), `${renderMarkdownReport(report)}\n`, "utf8");

  process.exit(report.releaseRecommendation === "NOT READY" ? 1 : 0);
}

main().catch((error) => {
  console.error("Reliability suite crashed unexpectedly (this is itself a reliability failure):");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
