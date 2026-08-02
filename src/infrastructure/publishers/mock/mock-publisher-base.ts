import "server-only";
import type { PublisherPort, PublishInput } from "@/core/application/ports/publisher-port";
import type { PublisherResult, PublishingPlatform } from "@/core/domain/entities/publishing";
import { simulatePublish } from "../simulated-publish";

/**
 * Shared behaviour for every Mock*Publisher. Each platform subclass supplies
 * only its own `platform` tag — the deterministic id/url shape, the
 * simulated delay, and the dev-only simulation-mode branching all live in
 * simulatePublish() (shared with BlotatoPublisherBase's disabled-live-
 * publishing path, see infrastructure/publishers/simulated-publish.ts). This
 * is simulated infrastructure only; a real adapter (BlotatoPublisherBase)
 * implements PublisherPort directly and does not extend this class, since a
 * real provider has nothing in common with mock timing/ids beyond that one
 * shared simulated fallback.
 */
export abstract class MockPublisherBase implements PublisherPort {
  abstract readonly platform: PublishingPlatform;

  async publish(input: PublishInput): Promise<PublisherResult> {
    return simulatePublish(this.platform, input);
  }
}
