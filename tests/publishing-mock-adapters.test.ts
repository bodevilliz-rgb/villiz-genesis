import { describe, expect, it } from "vitest";
import { MockLinkedInPublisher } from "@/infrastructure/publishers/mock/mock-linkedin-publisher";
import { MockFacebookPublisher } from "@/infrastructure/publishers/mock/mock-facebook-publisher";
import { MockInstagramPublisher } from "@/infrastructure/publishers/mock/mock-instagram-publisher";
import { MockXPublisher } from "@/infrastructure/publishers/mock/mock-x-publisher";
import { resolvePublisher } from "@/infrastructure/publishers/publisher-factory";
import { BlotatoLinkedInPublisher } from "@/infrastructure/publishers/blotato/blotato-linkedin-publisher";
import { BlotatoFacebookPublisher } from "@/infrastructure/publishers/blotato/blotato-facebook-publisher";
import { BlotatoInstagramPublisher } from "@/infrastructure/publishers/blotato/blotato-instagram-publisher";
import { BlotatoXPublisher } from "@/infrastructure/publishers/blotato/blotato-x-publisher";
import type { BlotatoPublisherDeps } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { PublishInput } from "@/core/application/ports/publisher-port";

/** publisher-factory now resolves Blotato*Publisher (Sprint 6B) — a fake, never-called-live BlotatoPublisherDeps is enough for resolution/instanceof checks. */
const fakeBlotatoDeps: BlotatoPublisherDeps = {
  blotatoAccounts: {
    upsertAccounts: async () => [],
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
  },
  blotatoClient: {
    listAccounts: async () => [],
    publishPost: async () => ({ postSubmissionId: "fake-submission" }),
  },
  livePublishingEnabled: false,
};

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
    assetUrls: [],
    devSimulationMode: "always_succeed",
    ...overrides,
  };
}

describe("MockPublisherBase — success path", () => {
  it("returns a deterministic external id and url derived from the attempt id, not random", async () => {
    const publisher = new MockLinkedInPublisher();
    const resultA = await publisher.publish(input({ attemptId: "attempt-fixed" }));
    const resultB = await publisher.publish(input({ attemptId: "attempt-fixed" }));

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    if (resultA.success && resultB.success) {
      expect(resultA.externalPostId).toBe(resultB.externalPostId);
      expect(resultA.externalPostId).toMatch(/^mock-linkedin-\d+$/);
      expect(resultA.externalUrl).toBe(`https://mock.local/linkedin/${resultA.externalPostId}`);
      expect(new Date(resultA.publishedAt).getTime()).not.toBeNaN();
    }
  });

  it("produces different deterministic ids for different attempts", async () => {
    const publisher = new MockLinkedInPublisher();
    const resultA = await publisher.publish(input({ attemptId: "attempt-one" }));
    const resultB = await publisher.publish(input({ attemptId: "attempt-two" }));
    if (resultA.success && resultB.success) {
      expect(resultA.externalPostId).not.toBe(resultB.externalPostId);
    }
  });
});

describe("MockPublisherBase — simulation modes", () => {
  it("always_fail never succeeds, regardless of attempt id", async () => {
    const publisher = new MockFacebookPublisher();
    const result = await publisher.publish(input({ devSimulationMode: "always_fail" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("mock_simulated_failure");
      expect(result.errorMessage).toContain("facebook");
    }
  });

  it("fail_next_attempt fails exactly like always_fail for the attempt it is set on", async () => {
    const publisher = new MockInstagramPublisher();
    const result = await publisher.publish(input({ devSimulationMode: "fail_next_attempt" }));
    expect(result.success).toBe(false);
  });

  it("always_succeed never fails", async () => {
    const publisher = new MockXPublisher();
    const result = await publisher.publish(input({ platform: "x", devSimulationMode: "always_succeed" }));
    expect(result.success).toBe(true);
  });
});

describe("publisher-factory — resolvePublisher", () => {
  it("resolves the correct concrete Blotato adapter for each of the 4 supported platforms (Sprint 6B replaced Mock*Publisher in the registry)", () => {
    expect(resolvePublisher("linkedin", fakeBlotatoDeps)).toBeInstanceOf(BlotatoLinkedInPublisher);
    expect(resolvePublisher("facebook", fakeBlotatoDeps)).toBeInstanceOf(BlotatoFacebookPublisher);
    expect(resolvePublisher("instagram", fakeBlotatoDeps)).toBeInstanceOf(BlotatoInstagramPublisher);
    expect(resolvePublisher("x", fakeBlotatoDeps)).toBeInstanceOf(BlotatoXPublisher);
  });

  it("every resolved publisher reports the platform it was resolved for", () => {
    expect(resolvePublisher("linkedin", fakeBlotatoDeps).platform).toBe("linkedin");
    expect(resolvePublisher("facebook", fakeBlotatoDeps).platform).toBe("facebook");
    expect(resolvePublisher("instagram", fakeBlotatoDeps).platform).toBe("instagram");
    expect(resolvePublisher("x", fakeBlotatoDeps).platform).toBe("x");
  });

  it("with live publishing disabled (the shipped default), every resolved publisher behaves exactly like the mock it replaced", async () => {
    const publisher = resolvePublisher("linkedin", fakeBlotatoDeps);
    const result = await publisher.publish(input({ attemptId: "attempt-factory-check" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.externalPostId).toMatch(/^mock-linkedin-\d+$/);
  });
});
