import "server-only";

/**
 * Deliberately not part of src/lib/env.ts's strict zod-validated serverSchema
 * — that schema throws and breaks the entire app at startup if anything in
 * it is missing, which is right for Supabase (nothing works without it) but
 * wrong for Blotato (an integration this app must run correctly without,
 * e.g. in CI or for a developer who hasn't been given a key yet). Reading
 * these directly and permissively means "Blotato not configured" is just
 * another state testBlotatoConnection() reports, not a build-breaking error.
 */
export interface BlotatoConfig {
  apiKey: string;
  /** Whether the Blotato integration is switched on at all — distinct from live *publishing*, see livePublishingEnabled. */
  enabled: boolean;
  /** The master safety switch for Sprint 6B: while false, BlotatoPublisherBase never calls the real POST /posts endpoint, regardless of anything else. */
  livePublishingEnabled: boolean;
}

export function blotatoConfig(): BlotatoConfig {
  return {
    apiKey: process.env.BLOTATO_API_KEY ?? "",
    enabled: process.env.BLOTATO_ENABLED === "true",
    livePublishingEnabled: process.env.BLOTATO_LIVE_PUBLISHING_ENABLED === "true",
  };
}
