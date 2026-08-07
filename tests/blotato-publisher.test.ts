import { describe, expect, it, vi } from "vitest";
import { BlotatoLinkedInPublisher } from "@/infrastructure/publishers/blotato/blotato-linkedin-publisher";
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
    const findMostRecentForPlatform = vi.fn(async () => null);
    const publishPost = vi.fn(async () => ({ postSubmissionId: "should-not-happen" }));
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: false,
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    const result = await publisher.publish(input({ attemptId: "attempt-fixed" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.externalPostId).toMatch(/^mock-linkedin-\d+$/);
      expect(result.externalUrl).toBe(`https://mock.local/linkedin/${result.externalPostId}`);
    }
    expect(findMostRecentForPlatform).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("still honours devSimulationMode overrides while disabled", async () => {
    const publisher = new BlotatoLinkedInPublisher(deps({ livePublishingEnabled: false }));
    const result = await publisher.publish(input({ devSimulationMode: "always_fail" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe("mock_simulated_failure");
  });
});

describe("BlotatoPublisherBase — live publishing enabled", () => {
  it("resolves the most-recently-verified stored account for the mapped Blotato platform and calls publishPost with it", async () => {
    const findMostRecentForPlatform = vi.fn(async (blotatoPlatform: string, _orgId: string) =>
      blotatoPlatform === "twitter" ? storedAccount({ id: "acc-x", platform: "twitter" }) : null,
    );
    const publishPost = vi.fn(async () => ({ postSubmissionId: "submission-x-1" }));

    const publisher = new BlotatoXPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform }),
        blotatoClient: fakeClient({ publishPost }),
      }),
    );

    const result = await publisher.publish(input({ platform: "x", body: "Hello world", assetUrls: ["https://cdn.example.com/x.png"] }));

    expect(findMostRecentForPlatform).toHaveBeenCalledWith("twitter", ORG_ID);
    expect(publishPost).toHaveBeenCalledWith({
      accountId: "acc-x",
      platform: "twitter",
      text: "Hello world",
      mediaUrls: ["https://cdn.example.com/x.png"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.externalPostId).toBe("submission-x-1");
      expect(result.metadata).toMatchObject({ blotatoAccountId: "acc-x", postSubmissionId: "submission-x-1" });
    }
  });

  it("returns a business failure (not a thrown exception) when no account is connected for the platform", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      deps({ livePublishingEnabled: true, blotatoAccounts: fakeRepository({ findMostRecentForPlatform: async () => null }) }),
    );

    const result = await publisher.publish(input());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_no_connected_account");
      expect(result.errorMessage).toContain("linkedin");
    }
  });

  it("propagates a thrown InfrastructureError from the client rather than swallowing it", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform: async () => storedAccount() }),
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
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform: async () => storedAccount({ id: "blotato-account-1234567890" }) }),
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
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform: async () => storedAccount() }),
        blotatoClient: fakeClient({ publishPost: async () => ({ postSubmissionId: "submission-42" }), getPostStatus }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input());

    expect(getPostStatus).toHaveBeenCalledTimes(2);
    expect(getPostStatus).toHaveBeenCalledWith("submission-42");
    expect(result.success).toBe(true);
    if (result.success) {
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
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform: async () => storedAccount() }),
        blotatoClient: fakeClient({ publishPost: async () => ({ postSubmissionId: "submission-42" }), getPostStatus }),
        statusPollIntervalMs: 0,
      }),
    );

    const result = await publisher.publish(input());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_publish_failed");
      expect(result.errorMessage).toBe("Publishing on instagram requires an image or a video");
    }
  });

  it("never reports success if Blotato never reaches a terminal status before the poll budget is exhausted", async () => {
    const getPostStatus = vi.fn(async (id: string) => publishedStatus({ postSubmissionId: id, status: "in-progress", publicUrl: null }));

    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform: async () => storedAccount() }),
        blotatoClient: fakeClient({ publishPost: async () => ({ postSubmissionId: "submission-42" }), getPostStatus }),
        statusPollIntervalMs: 0,
        statusPollMaxAttempts: 3,
      }),
    );

    const result = await publisher.publish(input());

    expect(getPostStatus).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_status_timeout");
      expect(result.errorMessage).toContain("submission-42");
    }
  });

  it("stores postSubmissionId in metadata regardless of the eventual outcome", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      deps({
        livePublishingEnabled: true,
        blotatoAccounts: fakeRepository({ findMostRecentForPlatform: async () => storedAccount() }),
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
});
