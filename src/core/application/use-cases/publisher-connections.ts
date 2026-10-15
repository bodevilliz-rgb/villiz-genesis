import type { PublisherHubClient } from "@/core/application/ports/publisher-hub-client-port";
import type { PublisherConnection } from "@/core/domain/entities/publisher-connections";

/**
 * Read the hub's connection directory. The hub is authoritative: whatever it
 * reports — tombstoned rows included — is what Genesis shows.
 */
export async function listPublisherConnections(params: {
  client: PublisherHubClient;
}): Promise<PublisherConnection[]> {
  return params.client.listConnections();
}

/**
 * Disconnect = tombstone in the hub. The stored token stops resolving
 * (store-first hook fails closed) and the account must be re-connected to
 * publish again. Receipt history is preserved by the hub.
 */
export async function disconnectPublisherConnection(
  params: { client: PublisherHubClient },
  input: { accountId: string },
): Promise<void> {
  await params.client.disconnect(input.accountId);
}