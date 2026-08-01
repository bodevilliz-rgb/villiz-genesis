import "server-only";
import type { PublisherPort } from "@/core/application/ports/publisher-port";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";
import { MockLinkedInPublisher } from "./mock/mock-linkedin-publisher";
import { MockFacebookPublisher } from "./mock/mock-facebook-publisher";
import { MockInstagramPublisher } from "./mock/mock-instagram-publisher";
import { MockXPublisher } from "./mock/mock-x-publisher";

/**
 * The only place that maps a platform to a concrete publisher. Nothing else
 * in the codebase should import a Mock*Publisher class directly — the
 * worker resolves through this factory, exactly as the mission requires
 * ("Do not call mock adapters directly from UI components or server
 * actions"). Swapping a platform to a real provider later means adding one
 * case here; every use-case and the worker itself stay unchanged.
 */
const registry: Record<PublishingPlatform, () => PublisherPort> = {
  linkedin: () => new MockLinkedInPublisher(),
  facebook: () => new MockFacebookPublisher(),
  instagram: () => new MockInstagramPublisher(),
  x: () => new MockXPublisher(),
};

export function resolvePublisher(platform: PublishingPlatform): PublisherPort {
  return registry[platform]();
}
