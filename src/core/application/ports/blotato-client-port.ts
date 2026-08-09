import type { BlotatoAccountSummary } from "@/core/domain/entities/blotato";

export interface BlotatoPublishInput {
  accountId: string;
  /** Blotato's own platform string (see toBlotatoPlatform) — not this app's PublishingPlatform value. */
  platform: string;
  text: string;
  /** Must contain Blotato-domain URLs only (from uploadMedia). Sending Supabase or other external URLs directly causes an async "requires an image or a video" failure from Blotato. */
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
 * Result of POST /v2/media — a media asset that has been copied onto
 * Blotato's CDN and is ready to reference in a publishPost call.
 */
export interface BlotatoMediaUploadResult {
  /** Blotato-hosted URL — the value to place in BlotatoPublishInput.mediaUrls. */
  url: string;
  id: string;
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
  /**
   * POST /v2/media — uploads a publicly accessible URL (e.g. a Supabase signed URL) to
   * Blotato's CDN and returns a Blotato-domain URL. Must be called for each media asset before
   * publishPost(), because Blotato's POST /posts only accepts mediaUrls originating from the
   * Blotato domain (see https://help.blotato.com/api/openapi-reference/publishing).
   */
  uploadMedia(url: string): Promise<BlotatoMediaUploadResult>;
  /** POST /posts — never called while BLOTATO_LIVE_PUBLISHING_ENABLED=false; see BlotatoPublisherBase. */
  publishPost(input: BlotatoPublishInput): Promise<BlotatoPublishResult>;
  /** GET /posts/{postSubmissionId} — polled by BlotatoPublisherBase after publishPost() until Blotato reports a terminal status, so a merely-accepted submission is never mistaken for a successful publish. */
  getPostStatus(postSubmissionId: string): Promise<BlotatoPostStatus>;
}
