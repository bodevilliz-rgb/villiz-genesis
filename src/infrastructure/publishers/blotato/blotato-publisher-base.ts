import "server-only";
import type { PublisherPort, PublishInput } from "@/core/application/ports/publisher-port";
import type { PublisherResult, PublishingPlatform } from "@/core/domain/entities/publishing";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient, BlotatoPostStatus } from "@/core/application/ports/blotato-client-port";
import { toBlotatoPlatform } from "@/core/domain/entities/blotato";
import { redactAccountId } from "@/core/domain/entities/publishing-media";
import { simulatePublish } from "../simulated-publish";

/** A redacted preview of the outbound Blotato payload — logged before the real POST /posts call, never containing the media URLs themselves (only a count) or the full account id. */
export interface BlotatoDryRunPreview {
  platform: string;
  accountIdRedacted: string;
  caption: string;
  mediaUrlsCount: number;
  mediaMimeTypes: string[];
}

export interface BlotatoPublisherDeps {
  blotatoAccounts: BlotatoAccountRepository;
  blotatoClient: BlotatoClient;
  /** BLOTATO_LIVE_PUBLISHING_ENABLED, resolved once by the caller (publisher-factory) — see infrastructure/blotato/blotato-config.ts. */
  livePublishingEnabled: boolean;
  /** Media mime types aligned 1:1 with PublishInput.assetUrls — used only to build the dry-run preview; never sent to Blotato itself. */
  assetMimeTypes?: string[];
  /** Called with a redacted payload summary immediately before the real POST /posts call — the worker wires this to its structured logger. */
  onBeforePublish?: (preview: BlotatoDryRunPreview) => void;
  /** Polling cadence for confirming a submitted post's final status via GET /posts/{id}. Defaults are production values; tests override for speed. */
  statusPollIntervalMs?: number;
  statusPollMaxAttempts?: number;
}

const DEFAULT_STATUS_POLL_INTERVAL_MS = 3000;
const DEFAULT_STATUS_POLL_MAX_ATTEMPTS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The real publisher behind every social platform this app supports,
 * replacing MockPublisherBase in the publisher-factory registry (Sprint
 * 6B). While `livePublishingEnabled` is false — the default, and the only
 * value this ships with in Sprint 6B — publish() never calls the real
 * Blotato API at all; it delegates to the exact same simulatePublish()
 * every Mock*Publisher already used, so nothing else in the pipeline (the
 * worker, retry flow, analytics, dev simulation modes) changes behaviour
 * until an operator deliberately flips BLOTATO_LIVE_PUBLISHING_ENABLED=true.
 *
 * The live path resolves which Blotato account to publish through by
 * platform only (findMostRecentForPlatform) — there is currently no concept
 * of "which client organisation owns this account" (see the migration's own
 * comment on why blotato_accounts is platform-wide, not organisation-
 * scoped), so an organisation with two LinkedIn accounts connected cannot
 * yet be disambiguated. Documented as a known limitation; irrelevant while
 * the live flag stays false.
 *
 * Sprint 6D: POST /posts only ever *accepts* a submission — Blotato
 * publishes asynchronously and the submission can still fail afterwards
 * (this is exactly what happened in production: Blotato accepted a post
 * with no media, then failed it with "requires an image or a video", while
 * this class reported success the instant the POST returned 2xx). publish()
 * now polls GET /posts/{id} until Blotato reports a terminal status, so a
 * merely-accepted submission is never reported as a successful publish.
 */
export abstract class BlotatoPublisherBase implements PublisherPort {
  abstract readonly platform: PublishingPlatform;

  constructor(private readonly deps: BlotatoPublisherDeps) {}

  async publish(input: PublishInput): Promise<PublisherResult> {
    if (!this.deps.livePublishingEnabled) {
      return simulatePublish(this.platform, input);
    }

    const blotatoPlatform = toBlotatoPlatform(this.platform);
    const account = await this.deps.blotatoAccounts.findMostRecentForPlatform(blotatoPlatform);

    if (!account) {
      return {
        success: false,
        errorCode: "blotato_no_connected_account",
        errorMessage: `No Blotato account is connected for ${this.platform}. Connect one from Publishing Settings, then Test Connection.`,
        metadata: { organisationId: input.organisationId, draftId: input.draftId },
      };
    }

    this.deps.onBeforePublish?.({
      platform: blotatoPlatform,
      accountIdRedacted: redactAccountId(account.id),
      caption: input.body,
      mediaUrlsCount: input.assetUrls.length,
      mediaMimeTypes: this.deps.assetMimeTypes ?? [],
    });

    const submission = await this.deps.blotatoClient.publishPost({
      accountId: account.id,
      platform: blotatoPlatform,
      text: input.body,
      mediaUrls: input.assetUrls,
    });

    const baseMetadata = {
      organisationId: input.organisationId,
      draftId: input.draftId,
      blotatoAccountId: account.id,
      postSubmissionId: submission.postSubmissionId,
    };

    const finalStatus = await this.pollForFinalStatus(submission.postSubmissionId);

    if (!finalStatus) {
      return {
        success: false,
        errorCode: "blotato_status_timeout",
        errorMessage: `Blotato had not confirmed a final status for this post after polling — check https://my.blotato.com/failed for its real outcome (submission id: ${submission.postSubmissionId}).`,
        metadata: baseMetadata,
      };
    }

    if (finalStatus.status === "failed") {
      return {
        success: false,
        errorCode: "blotato_publish_failed",
        errorMessage: finalStatus.errorMessage ?? "Blotato reported the post failed, with no further detail.",
        metadata: baseMetadata,
      };
    }

    return {
      success: true,
      externalPostId: submission.postSubmissionId,
      // Blotato returns the real permalink once the post is confirmed
      // published; fall back to the dashboard only if it omitted one.
      externalUrl: finalStatus.publicUrl ?? "https://my.blotato.com",
      publishedAt: new Date().toISOString(),
      metadata: baseMetadata,
    };
  }

  /** Polls until Blotato reports "published" or "failed", or returns null once statusPollMaxAttempts is exhausted without a terminal status. */
  private async pollForFinalStatus(postSubmissionId: string): Promise<BlotatoPostStatus | null> {
    const intervalMs = this.deps.statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS;
    const maxAttempts = this.deps.statusPollMaxAttempts ?? DEFAULT_STATUS_POLL_MAX_ATTEMPTS;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const status = await this.deps.blotatoClient.getPostStatus(postSubmissionId);
      if (status.status === "published" || status.status === "failed") {
        return status;
      }
      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }
    return null;
  }
}
