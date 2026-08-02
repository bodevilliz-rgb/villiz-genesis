import "server-only";
import type { PublishInput } from "@/core/application/ports/publisher-port";
import type { PublisherResult, PublishingPlatform } from "@/core/domain/entities/publishing";

/** Small, fixed processing delay — enough to feel like real network I/O without slowing the test suite or a manual demo. */
const SIMULATED_PROCESSING_DELAY_MS = 30;

/** Deterministic, not random — the same attempt always produces the same mock external id, so tests and demos are reproducible. */
function deterministicSuffix(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 1_000_000;
}

/**
 * The one place that decides what a *simulated* publish outcome looks like —
 * shared by every Mock*Publisher (always) and BlotatoPublisherBase (only
 * while BLOTATO_LIVE_PUBLISHING_ENABLED=false), so "simulated" means exactly
 * the same thing everywhere: the same fixed delay, `devSimulationMode`
 * honoured identically, and the same deterministic `mock-<platform>-<n>`
 * external id shape. Extracted here (Sprint 6B) specifically so
 * BlotatoPublisherBase replacing MockPublisherBase in the publisher-factory
 * registry could not silently change dev-simulation behaviour for anyone not
 * yet on live Blotato publishing — every existing Mock*Publisher test still
 * exercises this exact function, just via MockPublisherBase's thin wrapper.
 */
export async function simulatePublish(platform: PublishingPlatform, input: PublishInput): Promise<PublisherResult> {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_PROCESSING_DELAY_MS));

  if (input.devSimulationMode === "always_fail" || input.devSimulationMode === "fail_next_attempt") {
    return {
      success: false,
      errorCode: "mock_simulated_failure",
      errorMessage: `Simulated failure for ${platform} (dev simulation mode: ${input.devSimulationMode}).`,
      metadata: { organisationId: input.organisationId, draftId: input.draftId, simulated: true },
    };
  }

  const suffix = deterministicSuffix(input.attemptId);
  const externalPostId = `mock-${platform}-${suffix}`;

  return {
    success: true,
    externalPostId,
    externalUrl: `https://mock.local/${platform}/${externalPostId}`,
    publishedAt: new Date().toISOString(),
    metadata: {
      organisationId: input.organisationId,
      draftId: input.draftId,
      platform,
      simulated: true,
    },
  };
}
