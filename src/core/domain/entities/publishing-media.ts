import type { MediaAsset } from "./media";

/** Blotato (and every platform it publishes to) only accepts image or video media — never raw documents, audio-only files, etc. */
export function isPublishableMediaAsset(asset: MediaAsset): boolean {
  return asset.mimeType.startsWith("image/") || asset.mimeType.startsWith("video/");
}

export interface OrganisationFilterResult {
  allowed: MediaAsset[];
  rejected: MediaAsset[];
}

/**
 * content_draft_assets has no database constraint tying an attached asset's
 * organisation to the draft's own organisation — RLS on write only checks
 * the caller can write to the draft's org, not that the asset itself
 * belongs there. The publishing worker runs on the service-role client
 * (RLS bypassed entirely), so this is the one place that actually enforces
 * "never send another organisation's media to a live publish."
 */
export function filterAssetsForOrganisation(assets: MediaAsset[], organisationId: string): OrganisationFilterResult {
  const allowed: MediaAsset[] = [];
  const rejected: MediaAsset[] = [];
  for (const asset of assets) {
    (asset.organisationId === organisationId ? allowed : rejected).push(asset);
  }
  return { allowed, rejected };
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

export type MediaUrlRejectionReason = "not_https" | "local_host" | "malformed";

export interface MediaUrlValidation {
  valid: boolean;
  reason?: MediaUrlRejectionReason;
}

/**
 * Blotato's servers fetch media over the public internet — a signed URL
 * pointing at a local Supabase instance (http://127.0.0.1:54321/... or
 * http://host.docker.internal:.../..., as every local dev environment
 * produces) is never reachable by them and must never be sent, or Blotato
 * fails the post with a confusing "requires an image or a video" error
 * that looks identical to media simply being missing.
 */
export function validateMediaUrl(url: string): MediaUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (parsed.protocol !== "https:") return { valid: false, reason: "not_https" };

  const hostname = parsed.hostname.toLowerCase();
  if (
    LOCAL_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    /^172\.(2[0-9]|3[0-1])\./.test(hostname)
  ) {
    return { valid: false, reason: "local_host" };
  }

  return { valid: true };
}

/** Strips the signed-URL query string — the actual bearer token that grants read access — before this URL is ever written to a log line. */
export function redactMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}?[redacted]`;
  } catch {
    return "[unparseable-url]";
  }
}

/** Masks everything but the first/last 4 characters — enough to correlate log lines with a Blotato dashboard lookup without exposing the full account id. */
export function redactAccountId(accountId: string): string {
  if (accountId.length <= 8) return "*".repeat(accountId.length);
  return `${accountId.slice(0, 4)}...${accountId.slice(-4)}`;
}
