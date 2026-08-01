import "server-only";

/**
 * Controlled, non-random mock-publisher outcomes for testing the publishing
 * engine deterministically. See the migration comment on
 * publishing_jobs.dev_simulation_mode for why this is stored on the job row
 * rather than in process memory.
 *
 * `isSimulationControlAvailable` is the single gate every caller must go
 * through — in production it always returns false, and every function below
 * degrades to "always_succeed" behaviour regardless of what a stale database
 * row contains. This makes it structurally impossible for the dev-only
 * control to affect a production publish, not merely a matter of the UI not
 * rendering the toggle there.
 */
export type PublishingSimulationMode = "always_succeed" | "fail_next_attempt" | "always_fail";

export function isSimulationControlAvailable(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Resolves the *effective* mode for a job, ignoring the stored value entirely outside non-production environments. */
export function resolveEffectiveSimulationMode(
  storedMode: PublishingSimulationMode | null,
): PublishingSimulationMode {
  if (!isSimulationControlAvailable()) return "always_succeed";
  return storedMode ?? "always_succeed";
}
