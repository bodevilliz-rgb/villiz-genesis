import "server-only";
import type { BlotatoClient, BlotatoPublishInput, BlotatoPublishResult } from "@/core/application/ports/blotato-client-port";
import type { BlotatoAccountSummary } from "@/core/domain/entities/blotato";
import { InfrastructureError } from "@/core/domain/errors";

const BASE_URL = "https://backend.blotato.com/v2";

interface ListAccountsResponseBody {
  items: Array<{ id: string; platform: string; fullname: string | null; username: string | null }>;
}

interface PublishPostResponseBody {
  postSubmissionId: string;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * The only concrete implementation of BlotatoClient — every use-case and
 * BlotatoPublisherBase depend on the BlotatoClient interface, never on this
 * class directly, so tests substitute a fake instead of hitting the real
 * network (matching how SupabasePublishingRepository/PublisherPort are
 * consumed everywhere else in this codebase).
 *
 * Auth: a single `blotato-api-key` header, per
 * https://help.blotato.com/api/start — not a Bearer token, not a query
 * param.
 */
export class HttpBlotatoClient implements BlotatoClient {
  constructor(private readonly apiKey: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "blotato-api-key": this.apiKey, ...extra };
  }

  async listAccounts(): Promise<BlotatoAccountSummary[]> {
    const response = await fetch(`${BASE_URL}/users/me/accounts`, {
      method: "GET",
      headers: this.headers(),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new InfrastructureError(
        `Blotato returned ${response.status} listing accounts: ${await readErrorDetail(response)}`,
      );
    }

    const body = (await response.json()) as ListAccountsResponseBody;
    return body.items.map((item) => ({
      id: item.id,
      platform: item.platform,
      fullname: item.fullname,
      username: item.username,
    }));
  }

  async publishPost(input: BlotatoPublishInput): Promise<BlotatoPublishResult> {
    const response = await fetch(`${BASE_URL}/posts`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        post: {
          accountId: input.accountId,
          content: {
            text: input.text,
            mediaUrls: input.mediaUrls,
            platform: input.platform,
          },
          target: { targetType: input.platform },
        },
      }),
    });

    if (!response.ok) {
      throw new InfrastructureError(
        `Blotato returned ${response.status} publishing a post: ${await readErrorDetail(response)}`,
      );
    }

    const body = (await response.json()) as PublishPostResponseBody;
    return { postSubmissionId: body.postSubmissionId };
  }
}
