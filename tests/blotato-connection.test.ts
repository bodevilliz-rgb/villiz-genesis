import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { listStoredBlotatoAccounts, testBlotatoConnection } from "@/core/application/use-cases/blotato";
import { ForbiddenError } from "@/core/domain/errors";
import type { Actor } from "@/core/domain/entities/identity";
import type { BlotatoAccount, BlotatoAccountSummary } from "@/core/domain/entities/blotato";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";

const ACTOR_ID = "00000000-0000-4000-8000-000000000003";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: ACTOR_ID,
    email: "actor@villiz.com",
    fullName: "Actor One",
    avatarUrl: null,
    jobTitle: null,
    role: "member",
    isActive: true,
    isPlatformAdmin: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function summary(overrides: Partial<BlotatoAccountSummary> = {}): BlotatoAccountSummary {
  return { id: "acc-1", platform: "linkedin", fullname: "Villiz Pixels", username: "villizpixels", ...overrides };
}

function storedAccount(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    ...summary(),
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
    listAccounts: async () => [summary()],
    publishPost: async () => ({ postSubmissionId: "submission-1" }),
    getPostStatus: async (postSubmissionId) => ({
      postSubmissionId,
      status: "published",
      scheduledTime: null,
      publicUrl: null,
      errorMessage: null,
    }),
    ...overrides,
  };
}

describe("testBlotatoConnection", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.BLOTATO_ENABLED = "true";
    process.env.BLOTATO_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("refuses a non-platform-admin actor", async () => {
    await expect(
      testBlotatoConnection({ actor: actor({ isPlatformAdmin: false }), blotatoClient: fakeClient(), blotatoAccounts: fakeRepository() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("reports not-configured without ever calling the client when BLOTATO_ENABLED is not 'true'", async () => {
    process.env.BLOTATO_ENABLED = "false";
    const listAccounts = vi.fn(async () => [summary()]);

    const result = await testBlotatoConnection({
      actor: actor({ isPlatformAdmin: true }),
      blotatoClient: fakeClient({ listAccounts }),
      blotatoAccounts: fakeRepository(),
    });

    expect(result.reachable).toBe(false);
    expect(result.error).toContain("not configured");
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("reports not-configured when BLOTATO_API_KEY is empty, even if BLOTATO_ENABLED is true", async () => {
    process.env.BLOTATO_API_KEY = "";
    const result = await testBlotatoConnection({
      actor: actor({ isPlatformAdmin: true }),
      blotatoClient: fakeClient(),
      blotatoAccounts: fakeRepository(),
    });
    expect(result.reachable).toBe(false);
  });

  it("on success, stores every account and reports which of this app's platforms are supported", async () => {
    const upsertAccounts = vi.fn(async (accounts: BlotatoAccountSummary[]) => accounts.map((a) => storedAccount(a)));

    const result = await testBlotatoConnection({
      actor: actor({ isPlatformAdmin: true }),
      blotatoClient: fakeClient({
        listAccounts: async () => [summary({ id: "a", platform: "linkedin" }), summary({ id: "b", platform: "tiktok" })],
      }),
      blotatoAccounts: fakeRepository({ upsertAccounts }),
    });

    expect(result.reachable).toBe(true);
    expect(result.error).toBeNull();
    expect(result.accounts).toHaveLength(2);
    expect(result.supportedPlatforms).toEqual(["linkedin"]);
    expect(upsertAccounts).toHaveBeenCalledTimes(1);
    expect(upsertAccounts).toHaveBeenCalledWith([
      expect.objectContaining({ id: "a", platform: "linkedin" }),
      expect.objectContaining({ id: "b", platform: "tiktok" }),
    ]);
  });

  it("reports unreachable, without throwing, when the client rejects (invalid key, network failure)", async () => {
    const result = await testBlotatoConnection({
      actor: actor({ isPlatformAdmin: true }),
      blotatoClient: fakeClient({
        listAccounts: async () => {
          throw new Error("Blotato returned 401 listing accounts");
        },
      }),
      blotatoAccounts: fakeRepository(),
    });

    expect(result.reachable).toBe(false);
    expect(result.error).toContain("401");
    expect(result.accounts).toEqual([]);
  });
});

describe("listStoredBlotatoAccounts", () => {
  it("is a plain pass-through read, available regardless of platform-admin status", async () => {
    const accounts = [storedAccount({ id: "a" }), storedAccount({ id: "b" })];
    const result = await listStoredBlotatoAccounts({ blotatoAccounts: fakeRepository({ listAccounts: async () => accounts }) });
    expect(result).toBe(accounts);
  });
});
