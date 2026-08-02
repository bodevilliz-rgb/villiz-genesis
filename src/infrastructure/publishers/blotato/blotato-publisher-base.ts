import "server-only";
import type { PublisherPort, PublishInput } from "@/core/application/ports/publisher-port";
import type { PublisherResult, PublishingPlatform } from "@/core/domain/entities/publishing";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import { toBlotatoPlatform } from "@/core/domain/entities/blotato";
import { simulatePublish } from "../simulated-publish";

export interface BlotatoPublisherDeps {
  blotatoAccounts: BlotatoAccountRepository;
  blotatoClient: BlotatoClient;
  /** BLOTATO_LIVE_PUBLISHING_ENABLED, resolved once by the caller (publisher-factory) — see infrastructure/blotato/blotato-config.ts. */
  livePublishingEnabled: boolean;
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

    const result = await this.deps.blotatoClient.publishPost({
      accountId: account.id,
      platform: blotatoPlatform,
      text: input.body,
      mediaUrls: input.assetUrls,
    });

    return {
      success: true,
      externalPostId: result.postSubmissionId,
      // Blotato publishes asynchronously and does not return a direct post
      // permalink synchronously — this links to the dashboard where the
      // submission's real status/URL can be checked, not a specific post.
      externalUrl: "https://my.blotato.com",
      publishedAt: new Date().toISOString(),
      metadata: {
        organisationId: input.organisationId,
        draftId: input.draftId,
        blotatoAccountId: account.id,
        postSubmissionId: result.postSubmissionId,
      },
    };
  }
}
