import type { BlotatoAccountSummary } from "@/core/domain/entities/blotato";

export interface BlotatoPublishInput {
  accountId: string;
  /** Blotato's own platform string (see toBlotatoPlatform) — not this app's PublishingPlatform value. */
  platform: string;
  text: string;
  mediaUrls: string[];
}

export interface BlotatoPublishResult {
  /** Blotato processes a publish asynchronously; this is a submission id, not a finished post — see BlotatoPublisherBase for how it's surfaced. */
  postSubmissionId: string;
}

/**
 * The response shape of GET /v2/posts/{postSubmissionId} — per
 * https://help.blotato.com/api/openapi-reference/publishing. "in-progress"
 * and "scheduled" are both non-terminal from this app's point of view (an
 * immediate Publish Now never sets Blotato's own schedule); only
 * "published" and "failed" are outcomes BlotatoPublisherBase will settle on.
 */
export interface BlotatoPostStatus {
  postSubmissionId: string;
  status: "in-progress" | "scheduled" | "published" | "failed";
  scheduledTime: string | null;
  publicUrl: string | null;
  errorMessage: string | null;
}

/**
 * The real Blotato REST API (https://backend.blotato.com/v2), abstracted so
 * every use-case and publisher depends on this interface only — never on a
 * concrete `fetch` implementation. Mirrors the same reasoning as
 * PublisherPort: swapping the HTTP client for a fake in tests requires no
 * change above this line. See infrastructure/blotato/http-blotato-client.ts
 * for the only real implementation.
 */
export interface BlotatoClient {
  /** GET /users/me/accounts — every social account connected to this workspace's Blotato API key. Throws BlotatoApiError on a non-2xx response. */
  listAccounts(): Promise<BlotatoAccountSummary[]>;
  /** POST /posts — never called while BLOTATO_LIVE_PUBLISHING_ENABLED=false; see BlotatoPublisherBase. */
  publishPost(input: BlotatoPublishInput): Promise<BlotatoPublishResult>;
  /** GET /posts/{postSubmissionId} — polled by BlotatoPublisherBase after publishPost() until Blotato reports a terminal status, so a merely-accepted submission is never mistaken for a successful publish. */
  getPostStatus(postSubmissionId: string): Promise<BlotatoPostStatus>;
}
