import "server-only";
import type { PublisherPort } from "@/core/application/ports/publisher-port";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";
import type { BlotatoPublisherDeps } from "./blotato/blotato-publisher-base";
import { BlotatoLinkedInPublisher } from "./blotato/blotato-linkedin-publisher";
import { BlotatoFacebookPublisher } from "./blotato/blotato-facebook-publisher";
import { BlotatoInstagramPublisher } from "./blotato/blotato-instagram-publisher";
import { BlotatoXPublisher } from "./blotato/blotato-x-publisher";

/**
 * The only place that maps a platform to a concrete publisher. Nothing else
 * in the codebase should import a Blotato*Publisher class directly — the
 * worker resolves through this factory, exactly as the mission requires
 * ("Do not call publisher adapters directly from UI components or server
 * actions"). Swapping a platform to a different real provider later means
 * adding one case here; every use-case and the worker itself stay
 * unchanged.
 *
 * Sprint 6B: replaced the Mock*Publisher registry with BlotatoPublisherBase
 * subclasses (see infrastructure/publishers/blotato/) — every platform now
 * routes through the real Blotato integration. This is safe by default:
 * BlotatoPublisherBase only ever calls Blotato's real API when
 * `deps.livePublishingEnabled` is true (BLOTATO_LIVE_PUBLISHING_ENABLED),
 * which ships false, so the simulated behaviour every Mock*Publisher used to
 * provide directly is unchanged for anyone not on live Blotato publishing —
 * see infrastructure/publishers/simulated-publish.ts.
 */
const registry: Record<PublishingPlatform, (deps: BlotatoPublisherDeps) => PublisherPort> = {
  linkedin: (deps) => new BlotatoLinkedInPublisher(deps),
  facebook: (deps) => new BlotatoFacebookPublisher(deps),
  instagram: (deps) => new BlotatoInstagramPublisher(deps),
  x: (deps) => new BlotatoXPublisher(deps),
};

export function resolvePublisher(platform: PublishingPlatform, deps: BlotatoPublisherDeps): PublisherPort {
  return registry[platform](deps);
}
