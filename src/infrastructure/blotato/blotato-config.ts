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
  /**
   * The master safety switch for Sprint 6B: while false,
   * BlotatoPublisherBase never calls the real POST /posts endpoint,
   * regardless of anything else.
   *
   * Resolution order:
   *   1. Explicit env var if set (BLOTATO_LIVE_PUBLISHING_ENABLED).
   *   2. Otherwise, query the Render API to check the worker's env var state.
   *      This allows live mode to be toggled from the worker side without
   *      requiring a Vercel environment variable change. Fail-closed:
   *      returns false if the API is unreachable or unauthenticated.
   */
  livePublishingEnabled: boolean;
}

/**
 * Queries the Render API to check if live publishing is enabled
 * on the production worker. Uses the Render API key from the
 * RENDER_API_KEY environment variable.
 */
async function fetchRenderLiveStatus(): Promise<boolean> {
  try {
    const renderApiKey = process.env.RENDER_API_KEY;
    const renderServiceId =
      process.env.RENDER_PUBLISHING_WORKER_SERVICE_ID ??
      "srv-dafei95bedkc738u75mg";
    if (!renderApiKey) return false;

    const res = await fetch(
      `https://api.render.com/v1/services/${renderServiceId}/env-vars`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${renderApiKey}`,
          Accept: "application/json",
        },
        next: { revalidate: 120 }, // Cache for 2 minutes
      }
    );
    if (!res.ok) return false;
    const envVars = (await res.json()) as Array<{
      envVar?: { key: string; value: string };
      key?: string;
      value?: string;
    }>;
    const liveVar = envVars.find(
      (ev) =>
        (ev.envVar?.key ?? ev.key) === "BLOTATO_LIVE_PUBLISHING_ENABLED"
    );
    return (liveVar?.envVar?.value ?? liveVar?.value) === "true";
  } catch {
    return false;
  }
}

export async function blotatoConfigAsync(): Promise<BlotatoConfig> {
  const envValue = process.env.BLOTATO_LIVE_PUBLISHING_ENABLED;
  let livePublishingEnabled: boolean;
  if (envValue !== undefined) {
    livePublishingEnabled = envValue === "true";
  } else {
    livePublishingEnabled = await fetchRenderLiveStatus();
  }
  return {
    apiKey: process.env.BLOTATO_API_KEY ?? "",
    enabled: process.env.BLOTATO_ENABLED === "true",
    livePublishingEnabled,
  };
}

export function blotatoConfig(): BlotatoConfig {
  return {
    apiKey: process.env.BLOTATO_API_KEY ?? "",
    enabled: process.env.BLOTATO_ENABLED === "true",
    livePublishingEnabled:
      process.env.BLOTATO_LIVE_PUBLISHING_ENABLED === "true",
  };
}