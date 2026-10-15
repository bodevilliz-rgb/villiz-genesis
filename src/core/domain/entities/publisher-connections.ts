/**
 * Publisher connections: hub-side OAuth accounts surfaced in Genesis settings.
 * Pure domain — no env, no I/O — so status bands, expiry math and response
 * mapping are unit-testable and reusable from server components and actions.
 */

export type PublisherConnectionStatus =
  | "healthy"
  | "expiring"
  | "expired"
  | "needs-reconnect"
  | "disconnected";

export interface PublisherConnectionReceipt {
  postSubmissionId: string;
  status: string;
  publicUrl: string | null;
  createdAt: string | null;
}

export interface PublisherConnection {
  account: string | null;
  id: string;
  page: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  status: PublisherConnectionStatus;
  tokenExpiresAt: string | null;
  scope: string | null;
  hasRefresh: boolean;
  needsReconnect: boolean;
  lastRefreshError: string | null;
  receipts: PublisherConnectionReceipt[];
}

const STATUS_VALUES: readonly PublisherConnectionStatus[] = [
  "healthy",
  "expiring",
  "expired",
  "needs-reconnect",
  "disconnected",
];

/**
 * Unknown bands fail closed to the most cautious operator-facing band: the
 * row reads like it needs attention (verify before publishing) instead of
 * silently looking healthy.
 */
export function normalisePublisherConnectionStatus(
  value: unknown,
): PublisherConnectionStatus {
  return STATUS_VALUES.includes(value as PublisherConnectionStatus)
    ? (value as PublisherConnectionStatus)
    : "needs-reconnect";
}

export type PublisherConnectionTone = "positive" | "warning" | "danger" | "neutral" | "muted";

export const PUBLISHER_CONNECTION_STATUS_TONES: Record<
  PublisherConnectionStatus,
  PublisherConnectionTone
> = {
  healthy: "positive",
  expiring: "warning",
  expired: "danger",
  "needs-reconnect": "warning",
  disconnected: "muted",
};

export const PUBLISHER_CONNECTION_STATUS_LABELS: Record<PublisherConnectionStatus, string> = {
  healthy: "Healthy",
  expiring: "Renewing soon",
  expired: "Expired",
  "needs-reconnect": "Reconnect needed",
  disconnected: "Disconnected",
};

/** Map the hub's GET /v2/oauth/accounts body into domain rows. */
export function mapPublisherConnections(
  items: Array<Record<string, unknown>>,
): PublisherConnection[] {
  return items
    .map((item) => ({
      account: typeof item.account === "string" ? item.account : null,
      id: String(item.id ?? ""),
      page: typeof item.page === "string" ? item.page : null,
      connectedAt: typeof item.connectedAt === "string" ? item.connectedAt : null,
      disconnectedAt: typeof item.disconnectedAt === "string" ? item.disconnectedAt : null,
      status: normalisePublisherConnectionStatus(item.status),
      tokenExpiresAt: typeof item.tokenExpiresAt === "string" ? item.tokenExpiresAt : null,
      scope: typeof item.scope === "string" ? item.scope : null,
      hasRefresh: item.hasRefresh === true,
      needsReconnect: item.needsReconnect === true,
      lastRefreshError: typeof item.lastRefreshError === "string" ? item.lastRefreshError : null,
      receipts: Array.isArray(item.receipts)
        ? (item.receipts as Array<Record<string, unknown>>).map((receipt) => ({
            postSubmissionId: String(receipt.postSubmissionId ?? ""),
            status: typeof receipt.status === "string" ? receipt.status : "unknown",
            publicUrl: typeof receipt.publicUrl === "string" ? receipt.publicUrl : null,
            createdAt: typeof receipt.createdAt === "string" ? receipt.createdAt : null,
          }))
        : [],
    }))
    .filter((row) => row.id.length > 0);
}

/**
 * Human countdown to token expiry, deterministic in `now` so a server render
 * and a client tick agree, and fine granularity only appears when urgent.
 * The hub auto-renews 10 days out (HUB_RENEWAL_WINDOW_DAYS), so anything above
 * "10d" is untouched runway.
 */
export function formatTokenExpiry(tokenExpiresAt: string | null, now: Date): string | null {
  if (!tokenExpiresAt) return null;
  const expires = Date.parse(tokenExpiresAt);
  if (Number.isNaN(expires)) return null;
  const remainingMs = expires - now.getTime();
  if (remainingMs <= 0) return "expired";
  const minutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days >= 1) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (minutes >= 60) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * Connect entry point: the hub's public, unauthenticated start route. The hub
 * itself validates the source origin against its allowlist, so an offsite
 * source falls back to the hub's configured Genesis return URL.
 */
export function buildPublisherConnectHref(hubBaseUrl: string, sourceUrl: string | null): string {
  const startUrl = `${hubBaseUrl.replace(/\/+$/, "")}/v2/oauth/linkedin/start`;
  return sourceUrl ? `${startUrl}?source=${encodeURIComponent(sourceUrl)}` : startUrl;
}