import "server-only";
import type { PublisherPort, PublishInput } from "@/core/application/ports/publisher-port";
import type { PublisherResult, PublishingPlatform } from "@/core/domain/entities/publishing";

/** Small, fixed processing delay — enough to feel like real network I/O without slowing the test suite or a manual demo. */
const MOCK_PROCESSING_DELAY_MS = 30;

/** Deterministic, not random — the same attempt always produces the same mock external id, so tests and demos are reproducible. */
function deterministicSuffix(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 1_000_000;
}

/**
 * Shared behaviour for every Mock*Publisher. Each platform subclass supplies
 * only its own `platform` tag — the deterministic id/url shape, the
 * simulated delay, and the dev-only simulation-mode branching all live here
 * once. This is simulated infrastructure only; a real adapter replacing one
 * of these later implements PublisherPort directly and does not extend this
 * class, since real providers have nothing in common with mock timing/ids.
 */
export abstract class MockPublisherBase implements PublisherPort {
  abstract readonly platform: PublishingPlatform;

  async publish(input: PublishInput): Promise<PublisherResult> {
    await new Promise((resolve) => setTimeout(resolve, MOCK_PROCESSING_DELAY_MS));

    if (input.devSimulationMode === "always_fail" || input.devSimulationMode === "fail_next_attempt") {
      return {
        success: false,
        errorCode: "mock_simulated_failure",
        errorMessage: `Simulated failure for ${this.platform} (dev simulation mode: ${input.devSimulationMode}).`,
        metadata: { organisationId: input.organisationId, draftId: input.draftId, simulated: true },
      };
    }

    const suffix = deterministicSuffix(input.attemptId);
    const externalPostId = `mock-${this.platform}-${suffix}`;

    return {
      success: true,
      externalPostId,
      externalUrl: `https://mock.local/${this.platform}/${externalPostId}`,
      publishedAt: new Date().toISOString(),
      metadata: {
        organisationId: input.organisationId,
        draftId: input.draftId,
        platform: this.platform,
        simulated: true,
      },
    };
  }
}
