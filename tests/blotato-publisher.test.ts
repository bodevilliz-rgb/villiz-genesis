import { describe, expect, it, vi } from "vitest";
import { BlotatoLinkedInPublisher } from "@/infrastructure/publishers/blotato/blotato-linkedin-publisher";
import { BlotatoFacebookPublisher } from "@/infrastructure/publishers/blotato/blotato-facebook-publisher";
import { BlotatoInstagramPublisher } from "@/infrastructure/publishers/blotato/blotato-instagram-publisher";
import { BlotatoXPublisher } from "@/infrastructure/publishers/blotato/blotato-x-publisher";
import type { BlotatoPublisherDeps, BlotatoDryRunPreview } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient, BlotatoPostStatus } from "@/core/application/ports/blotato-client-port";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import type { PublishInput } from "@/core/application/ports/publisher-port";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    organisationId: ORG_ID,
    draftId: DRAFT_ID,
    jobId: "job-1",
    attemptId: "attempt-1",
    attemptNumber: 1,
    platform: "linkedin",
    title: "A post",
    body: "Body text",
    assetUrls: ["https://cdn.example.com/a.png"],
    devSimulationMode: "always_succeed",
    ...overrides,
  };
}

function storedAccount(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    id: "blotato-account-1",
    platform: "linkedin",
    fullname: "Villiz Pixels",
    username: "villizpixels",
    organisationId: ORG_ID,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<BlotatoAccountRepository> = {}): BlotatoAccountRepository {
  return {
    upsertAccounts: async (accounts, _organisationId) => accounts.map((a) => storedAccount(a)),
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
    findActiveForOrganisationAndPlatform: async () => [],
    listActiveForOrganisation: async () => [],
    assignToOrganisation: async () => storedAccount(),
    removeFromOrganisation: async () => {},
    ...overrides,
  };
}

function publishedStatus(overrides: Partial<BlotatoPostStatus> = {}): BlotatoPostStatus {
  return {
    postSubmissionId: "submission-1",
    status: "published",
    scheduledTime: null,
    publicUrl: "https://blotato-cdn.example.com/post/submission-1",
    errorMessage: null,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [],
    uploadMedia: async () => ({ url: "https://media.blotato.com/uploaded-asset.jpg", id: "media-id-1" }),
    publishPost: async () => ({ postSubmissionId: "submission-1" }),
    getPostStatus: async (postSubmissionId) => publishedStatus({ postSubmissionId }),
    ...overrides,
  };
}

function deps(overrides: Partial<BlotatoPublisherDeps> = {}): BlotatoPublisherDeps {
  return {
    blotatoAccounts: fakeRepository(),
    blotatoClient: fakeClient(),
    livePublishingEnabled: false,
    ...overrides,
  };
}

describe("BlotatoPublisherBase — live publishing disabled (shipped default)", () => {
  it("behaves exactly like simulatePublish, never touching the Blotato client or account repository", async () => {
    const findActiveForOrganisationAndPlatform = vi.fn(async () => []);
    const publishPost = vi.fn(async () => ({ postSubmissionId: "should-not-happen" }));
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: false,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    const result = await publisher.publish(input({ attemptId: "attempt-fixed" }));

    expect(result.success).toBe(true);
    if (result.success === true) {
      expect(result.externalPostId).toMatch(/^mock-linkedin-\d+$/);
      expect(result.externalUrl).toBe(`https://mock.local/linkedin/${result.externalPostId}`);
    }
    expect(findActiveForOrganisationAndPlatform).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("still honours devSimulationMode overrides while disabled", async () => {
    const publisher = new BlotatoLinkedInPublisher(deps({ livePublishingEnabled: false }));
    const result = await publisher.publish(input({ devSimulationMode: "always_fail" }));
    expect(result.success).toBe(false);
    if (result.success === false) expect(result.errorCode).toBe("mock_simulated_failure");
  });
});

describe("BlotatoPublisherBase — live publishing enabled", () => {
  it("resolves the single active stored account for the mapped Blotato platform and calls publishPost with it", async () => {
    const findActiveForOrganisationAndPlatform = vi.fn(async (blotatoPlatform: string, _orgId: string) =>
      blotatoPlatform === "twitter" ? [storedAccount({ id: "acc-x", platform: "twitter" })] : [],
    );
    const publishPost = vi.fn(async () => ({ postSubmissionId: "submission-x-1" }));

    const publisher = new BlotatoXPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    const result = await publisher.publish(input({ platform: "x", body: "Hello world", assetUrls: ["https://cdn.example.com/x.png"] }));

    expect(findActiveForOrganisationAndPlatform).toHaveBeenCalledWith("twitter", ORG_ID);
    expect(publishPost).toHaveBeenCalledWith({
      accountId: "acc-x",
      platform: "twitter",
      text: "Hello world",
      // Blotato-domain URL after upload, not the original CDN URL
      mediaUrls: ["https://media.blotato.com/uploaded-asset.jpg"],
    });
    expect(result.success).toBe(true);
    if (result.success === true) {
      expect(result.externalPostId).toBe("submission-x-1");
      expect(result.metadata).toMatchObject({ blotatoAccountId: "acc-x", postSubmissionId: "submission-x-1" });
    }
  });

  it("returns a business failure (not a thrown exception) when no account is connected for the platform", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      deps({ livePublishingEnabled: true, blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [] }) }),
    );

    const result = await publisher.publish(input());

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.errorCode).toBe("blotato_no_connected_account");
      expect(result.errorMessage).toContain("linkedin");
    }
  });

  it("propagates a thrown InfrastructureError from the client rather than swallowing it", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({
          publishPost: async () => {
            throw new Error("Blotato returned 500 posting");
          },
        }),
      }),
    );

    await expect(publisher.publish(input())).rejects.toThrow("Blotato returned 500 posting");
  });

  it("logs a redacted dry-run preview before calling the real publishPost, containing no media URLs and a masked account id", async () => {
    const previews: BlotatoDryRunPreview[] = [];
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [storedAccount({ id: "blotato-account-1234567890" })] }),
        assetMimeTypes: ["image/png"],
        onBeforePublish: (preview) => previews.push(preview),
      }),
    );

    await publisher.publish(input({ body: "Hello world", assetUrls: ["https://cdn.example.com/a.png"] }));

    expect(previews).toHaveLength(1);
    expect(previews[0]).toEqual({
      platform: "linkedin",
      accountIdRedacted: "blot...7890",
      caption: "Hello world",
      mediaUrlsCount: 1,
      mediaMimeTypes: ["image/png"],
      providerMediaCount: 1,
      mediaUploadFailedCount: 0,
    });
    expect(JSON.stringify(previews[0])).not.toContain("cdn.example.com");
    expect(JSON.stringify(previews[0])).not.toContain("blotato-account-1234567890");
  });
});

describe("BlotatoPublisherBase — final-status polling", () => {
  it("only reports success once Blotato's GET /posts/{id} confirms 'published'", async () => {
    const statusCalls: string[] = [];
    const getPostStatus = vi.fn(async (id: string) => {
      statusCalls.push(id);
      // First check: still processing. Second check: confirmed published.
      return statusCalls.length === 1
        ? publishedStatus({ postSubmissionId: id, status: "in-progress", publicUrl: null })
        : publishedStatus({ postSubmissionId: id, publicUrl: "https://blotato-cdn.example.com/post/1" });
    });

    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({ publishPost: async () => ({ postSubmissionId: "submission-42" }), getPostStatus }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input());

    expect(getPostStatus).toHaveBeenCalledTimes(2);
    expect(getPostStatus).toHaveBeenCalledWith("submission-42");
    expect(result.success).toBe(true);
    if (result.success === true) {
      expect(result.externalUrl).toBe("https://blotato-cdn.example.com/post/1");
      expect(result.externalPostId).toBe("submission-42");
    }
  });

  it("marks Failed with Blotato's own errorMessage when the polled status is 'failed' — this is the exact production bug: media-less posts get accepted then fail asynchronously", async () => {
    const getPostStatus = vi.fn(async (id: string) =>
      publishedStatus({ postSubmissionId: id, status: "failed", publicUrl: null, errorMessage: "Publishing on instagram requires an image or a video" }),
    );

    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({ publishPost: async () => ({ postSubmissionId: "submission-42" }), getPostStatus }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input());

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.errorCode).toBe("blotato_publish_failed");
      expect(result.errorMessage).toBe("Publishing on instagram requires an image or a video");
    }
  });

  /**
   * P0 fix: exhausting the synchronous poll budget is neither a success NOR
   * a failure — it is `pending`. This test previously asserted
   * `success: false` with a blotato_status_timeout error code, and that
   * assertion was exactly what the worker faithfully persisted as a terminal
   * failure, marking two genuinely-published production posts (one Instagram,
   * one TikTok — submission 1144fce2-dc61-4e9b-b5ac-68e5f8511654) as failed.
   *
   * The original intent — "never reports success" — is preserved and still
   * asserted: `success` must not be `true`. What changed is that the
   * alternative is no longer a fabricated failure.
   */
  it("reports pending (never success, never failure) if Blotato has not reached a terminal status before the poll budget is exhausted", async () => {
    const getPostStatus = vi.fn(async (id: string) => publishedStatus({ postSubmissionId: id, status: "in-progress", publicUrl: null }));

    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({ publishPost: async () => ({ postSubmissionId: "submission-42" }), getPostStatus }),
        statusPollIntervalMs: 0,
        statusPollMaxAttempts: 3,
      }),
    );

    const result = await publisher.publish(input());

    expect(getPostStatus).toHaveBeenCalledTimes(3);
    expect(result.success).not.toBe(true);
    expect(result.success).toBe("pending");
    if (result.success === "pending") {
      // The real submission id must survive — it is the exact value the
      // background confirmation pass will later re-check, and must never be
      // re-submitted.
      expect(result.providerSubmissionId).toBe("submission-42");
      expect(result.metadata).toMatchObject({ postSubmissionId: "submission-42" });
    }
  });

  it("stores postSubmissionId in metadata regardless of the eventual outcome", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({
          publishPost: async () => ({ postSubmissionId: "submission-99" }),
          getPostStatus: async (id) => publishedStatus({ postSubmissionId: id, status: "failed", errorMessage: "boom" }),
        }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input());
    expect(result.metadata).toMatchObject({ postSubmissionId: "submission-99" });
  });

  it("continues polling through multiple consecutive in-progress statuses before resolving", async () => {
    let calls = 0;
    const getPostStatus = vi.fn(async (id: string) => {
      calls += 1;
      if (calls < 4) return publishedStatus({ postSubmissionId: id, status: "in-progress", publicUrl: null });
      return publishedStatus({ postSubmissionId: id });
    });

    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [storedAccount()] }),
        blotatoClient: fakeClient({ getPostStatus }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input());

    expect(calls).toBe(4);
    expect(result.success).toBe(true);
  });
});

describe("BlotatoPublisherBase — destination lock: resolvedAccountId routing", () => {
  const ACC_A = storedAccount({ id: "acc-a", platform: "linkedin" });
  const ACC_B = storedAccount({ id: "acc-b", platform: "linkedin" });

  it("when resolvedAccountId is set, publishPost receives that exact account's id — never null", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [ACC_A, ACC_B] }),
        blotatoClient: fakeClient({ publishPost }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input({ resolvedAccountId: "acc-b" }));

    expect(result.success).toBe(true);
    // accountId must be the locked account id — never null
    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc-b" }));
    expect(publishPost).not.toHaveBeenCalledWith(expect.objectContaining({ accountId: null }));
  });

  it("selects acc-a when resolvedAccountId points to acc-a, not acc-b", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [ACC_A, ACC_B] }),
        blotatoClient: fakeClient({ publishPost }),
        statusPollIntervalMs: 0,
      }),
    );

    await publisher.publish(input({ resolvedAccountId: "acc-a" }));
    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc-a" }));
  });

  it("fails closed when resolvedAccountId does not match any active account (stale lock)", async () => {
    const publishPost = vi.fn();
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [ACC_A, ACC_B] }),
        blotatoClient: fakeClient({ publishPost }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input({ resolvedAccountId: "acc-removed" }));

    expect(result.success).toBe(false);
    if (result.success === false) expect(result.errorCode).toBe("blotato_ambiguous_account");
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("fails closed with blotato_ambiguous_account when multiple accounts exist and resolvedAccountId is null", async () => {
    const publishPost = vi.fn();
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findActiveForOrganisationAndPlatform: async () => [ACC_A, ACC_B] }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    const result = await publisher.publish(input({ resolvedAccountId: undefined }));

    expect(result.success).toBe(false);
    if (result.success === false) expect(result.errorCode).toBe("blotato_ambiguous_account");
    expect(publishPost).not.toHaveBeenCalled();
  });
});

describe("BlotatoPublisherBase — per-platform payload construction", () => {
  const platforms = [
    {
      Publisher: BlotatoLinkedInPublisher,
      genesis: "linkedin" as const,
      blotato: "linkedin",
      accountId: "acc-linkedin-1",
    },
    {
      Publisher: BlotatoFacebookPublisher,
      genesis: "facebook" as const,
      blotato: "facebook",
      accountId: "acc-facebook-1",
    },
    {
      Publisher: BlotatoInstagramPublisher,
      genesis: "instagram" as const,
      blotato: "instagram",
      accountId: "acc-instagram-1",
    },
    {
      Publisher: BlotatoXPublisher,
      genesis: "x" as const,
      blotato: "twitter",
      accountId: "acc-x-1",
    },
  ] as const;

  for (const { Publisher, genesis, blotato, accountId } of platforms) {
    it(`${genesis}: publishPost.accountId is the locked account id, platform is '${blotato}', and text is the draft body`, async () => {
      const publishPost = vi.fn(async () => ({ postSubmissionId: `sub-${genesis}` }));
      const publisher = new Publisher(
        deps({
          livePublishingEnabled: true,
          blotatoAccounts: fakeRepository({
            findActiveForOrganisationAndPlatform: async (bp) =>
              bp === blotato ? [storedAccount({ id: accountId, platform: blotato })] : [],
          }),
          blotatoClient: fakeClient({ publishPost }),
          statusPollIntervalMs: 0,
        }),
      );

      const result = await publisher.publish(
        input({ platform: genesis, body: `Caption for ${genesis}`, assetUrls: ["https://cdn.example.com/img.png"] }),
      );

      expect(result.success).toBe(true);
      expect(publishPost).toHaveBeenCalledOnce();
      expect(publishPost).toHaveBeenCalledWith({
        accountId,
        platform: blotato,
        text: `Caption for ${genesis}`,
        // mediaUrls must be the Blotato-domain URL returned by uploadMedia, NOT
        // the original Supabase/CDN URL — this is the fix for the live UAT failure
        // where Blotato rejected non-Blotato-domain URLs with "requires an image or a video"
        mediaUrls: ["https://media.blotato.com/uploaded-asset.jpg"],
      });
      // accountId must never be null — the locked account id must reach the API payload
      expect(publishPost).not.toHaveBeenCalledWith(expect.objectContaining({ accountId: null }));
    });
  }
});
