import "server-only";
import { InfrastructureError } from "@/core/domain/errors";
import {
  mapPublisherConnections,
  type PublisherConnection,
} from "@/core/domain/entities/publisher-connections";
import type { PublisherHubClient } from "@/core/application/ports/publisher-hub-client-port";
import { publisherHubConfig } from "./publisher-hub-config";

interface AccountsResponseBody {
  items?: Array<Record<string, unknown>>;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * The only concrete implementation of PublisherHubClient. Shares the Blotato
 * auth contract (`blotato-api-key` header) with the hub's guarded routes, and
 * the hub is the single source of truth: list is never cached, disconnect is
 * an idempotent tombstone (204 tombstoned / 404 already-gone both succeed).
 */
export class HttpPublisherHubClient implements PublisherHubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return { "blotato-api-key": this.apiKey };
  }

  async listConnections(): Promise<PublisherConnection[]> {
    const response = await fetch(`${this.baseUrl}/v2/oauth/accounts`, {
      method: "GET",
      headers: this.headers(),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new InfrastructureError(
        `Publisher hub returned ${response.status} listing connections: ${await readErrorDetail(response)}`,
      );
    }

    const body = (await response.json()) as AccountsResponseBody;
    return mapPublisherConnections(body.items ?? []);
  }

  async disconnect(accountId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/v2/oauth/accounts/${encodeURIComponent(accountId)}`,
      { method: "DELETE", headers: this.headers(), cache: "no-store" },
    );
    if (!response.ok && response.status !== 404) {
      throw new InfrastructureError(
        `Publisher hub returned ${response.status} disconnecting ${accountId}: ${await readErrorDetail(response)}`,
      );
    }
  }
}

/** Returns null when the hub is not configured — callers render that state. */
export function resolvePublisherHubClient(): HttpPublisherHubClient | null {
  const config = publisherHubConfig();
  return config ? new HttpPublisherHubClient(config.baseUrl, config.apiKey) : null;
}