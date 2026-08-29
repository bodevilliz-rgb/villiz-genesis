import { routes } from "@/lib/routes";

/**
 * The one stable non-production deployment authorised to complete staff
 * sign-in. Exact origins only: Vercel branch/deployment hostnames must never
 * become implicit authentication callback authorities.
 */
export const STABLE_GENESIS_PREVIEW_ORIGIN = "https://villiz-genesis-agie-preview.vercel.app";

function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Resolve a callback using an exact allowlist, falling back to canonical. */
export function resolveSignInCallbackUrl(input: {
  requestOrigin: string | null;
  canonicalSiteUrl: string;
  nodeEnv?: string;
}): string {
  const canonicalOrigin = normaliseOrigin(input.canonicalSiteUrl);
  if (!canonicalOrigin) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a valid HTTPS origin.");
  }

  const requestOrigin = input.requestOrigin;
  if (requestOrigin && input.nodeEnv !== "production") {
    try {
      const local = new URL(requestOrigin);
      if (
        local.protocol === "http:" &&
        (local.hostname === "localhost" || local.hostname === "127.0.0.1") &&
        !local.username &&
        !local.password
      ) {
        return `${local.origin}${routes.authCallback}`;
      }
    } catch {
      // Invalid request origins use the canonical callback below.
    }
  }

  const allowedOrigins = new Set([canonicalOrigin, STABLE_GENESIS_PREVIEW_ORIGIN]);
  const safeRequestOrigin = requestOrigin ? normaliseOrigin(requestOrigin) : null;
  const selectedOrigin = safeRequestOrigin && allowedOrigins.has(safeRequestOrigin)
    ? safeRequestOrigin
    : canonicalOrigin;

  return `${selectedOrigin}${routes.authCallback}`;
}
