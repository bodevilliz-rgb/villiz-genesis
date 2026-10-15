import type { PublisherConnection } from "@/core/domain/entities/publisher-connections";

/**
 * Hub-side connection directory. The hub is the source of truth for
 * OAuth-connected publisher accounts — including tombstoned (disconnected)
 * history rows, exactly as the publishing contract mirror is authority for
 * post submissions.
 */
export interface PublisherHubClient {
  listConnections(): Promise<PublisherConnection[]>;
  /** Tombstones the hub-side token. Idempotent: 404 already-gone succeeds. */
  disconnect(accountId: string): Promise<void>;
}