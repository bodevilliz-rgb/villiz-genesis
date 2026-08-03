/**
 * Sprint 7.1 — Operation Iron Shield.
 *
 * Shared types for `npm run reliability:test`. This suite is deliberately
 * NOT a parallel publishing engine — every check in scripts/reliability/
 * imports and exercises the real, shipped use-cases, domain functions, and
 * publisher classes (src/core/application/use-cases/*, src/core/domain/
 * entities/*, src/infrastructure/publishers/blotato/*), the same code the
 * app and the vitest suite already depend on. It only fakes the outermost
 * persistence/network ports (PublishingRepository, ContentRepository,
 * BlotatoClient, ...), exactly the way tests/*.test.ts already does.
 */

export type CheckClassification = "MANDATORY" | "ADVISORY" | "EXTERNAL";

export type CheckStatus = "PASS" | "FAIL" | "SKIP";

export interface CheckResult {
  name: string;
  classification: CheckClassification;
  status: CheckStatus;
  durationMs: number;
  /** Present on FAIL — what went wrong. Present on SKIP — why it didn't run. */
  message?: string;
  /** Free-form extra detail, never containing secrets or full signed-URL tokens. */
  detail?: Record<string, unknown>;
}

export interface ReliabilityCheck {
  name: string;
  classification: CheckClassification;
  /** Throws to fail; a thrown Error's message becomes the report's failure message. Return { skip: reason } to skip (e.g. local Supabase unreachable). */
  run: () => Promise<void | { skip: string } | { detail: Record<string, unknown> }>;
}

export type ReleaseRecommendation = "READY" | "READY WITH WARNINGS" | "NOT READY";

export interface ReliabilityReport {
  runId: string;
  timestamp: string;
  gitCommit: string;
  environment: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  skippedChecks: number;
  coreReliabilityScore: number | null;
  externalDependencyStatus: "not_requested" | "all_passed" | "some_failed";
  releaseRecommendation: ReleaseRecommendation;
  durationMs: number;
  results: CheckResult[];
  knownLimitations: string[];
}
