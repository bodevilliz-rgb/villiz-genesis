import "server-only";

/**
 * Deliberately not part of src/lib/env.ts's strict zod-validated serverSchema —
 * same rationale as blotato-config.ts: an integration the app must run
 * correctly without (CI, developer machines, before the funnel is live) must
 * not break the build. Unconfigured → the connections page renders its
 * not-configured state instead of crashing.
 *
 * HUB_BASE_URL is the hub's reachable TLS origin (Tailscale funnel URL in
 * production), never a 127.0.0.1 bind — a Vercel serverless fetch to loopback
 * would only ever hit itself, so loopback values fail closed here. Auth: the
 * hub validates the same `blotato-api-key` header Blotato uses, so
 * BLOTATO_API_KEY doubles as the hub credential and no new secret is
 * introduced.
 */
export interface PublisherHubConfig {
  baseUrl: string;
  apiKey: string;
}

export function publisherHubConfig(): PublisherHubConfig | null {
  const baseUrl = process.env.HUB_BASE_URL?.trim();
  const apiKey = process.env.BLOTATO_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(baseUrl.toLowerCase())) return null;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}