import { describe, expect, it, vi } from "vitest";
import { BlotatoLinkedInPublisher } from "@/infrastructure/publishers/blotato/blotato-linkedin-publisher";
import { BlotatoXPublisher } from "@/infrastructure/publishers/blotato/blotato-x-publisher";
import type { BlotatoPublisherDeps } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
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
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<BlotatoAccountRepository> = {}): BlotatoAccountRepository {
  return {
    upsertAccounts: async (accounts) => accounts.map((a) => storedAccount(a)),
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [],
    publishPost: async () => ({ postSubmissionId: "submission-1" }),
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
    const findMostRecentForPlatform = vi.fn(async (blotatoPlatform: string) =>
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

    expect(findMostRecentForPlatform).toHaveBeenCalledWith("twitter");
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
});
