/**
 * Sprint 10B — Multi-client social account routing tests (22 specs).
 *
 * Spec map:
 *  1–3  : listOrganisationChannels
 *  4–8  : assignChannelToOrganisation
 *  9–11 : removeChannelFromOrganisation
 * 12–13 : listAvailableAccountsForAssignment
 * 14–22 : Publisher routing (findActiveForOrganisationAndPlatform, fail-closed, destination lock)
 */

import { describe, expect, it } from "vitest";
import {
  listOrganisationChannels,
  assignChannelToOrganisation,
  removeChannelFromOrganisation,
  listAvailableAccountsForAssignment,
} from "@/core/application/use-cases/organisation-social-accounts";
import { ForbiddenError, LimitExceededError, ConflictError } from "@/core/domain/errors";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { UsageRepository } from "@/core/application/ports/usage-port";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import type { Actor } from "@/core/domain/entities/identity";
import type { OrganisationUsage } from "@/core/domain/entities/usage";

// ── Publisher imports ──────────────────────────────────────────────────────────
import { BlotatoLinkedInPublisher } from "@/infrastructure/publishers/blotato/blotato-linkedin-publisher";
import type { BlotatoPublisherDeps } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { BlotatoClient, BlotatoPostStatus } from "@/core/application/ports/blotato-client-port";
import type { PublishInput } from "@/core/application/ports/publisher-port";

// ── Constants ──────────────────────────────────────────────────────────────────

const ORG_A = "00000000-0000-4000-8000-000000000001";
const ORG_B = "00000000-0000-4000-8000-000000000002";
const DRAFT_ID = "00000000-0000-4000-8000-000000000010";

// ── Factories ──────────────────────────────────────────────────────────────────

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: "actor-1",
    email: "admin@villiz.com",
    fullName: "Admin",
    avatarUrl: null,
    jobTitle: null,
    role: "member",
    isActive: true,
    isPlatformAdmin: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function account(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    id: "acc-1",
    platform: "linkedin",
    fullname: "Villiz LinkedIn",
    username: "villiz",
    organisationId: ORG_A,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-07T00:00:00Z",
    ...overrides,
  };
}

function usage(overrides: Partial<OrganisationUsage> = {}): OrganisationUsage {
  return {
    organisationId: ORG_A,
    socialAccountsUsed: 0,
    postsThisWeek: 0,
    storageBytesUsed: 0,
    aiTokensThisMonth: 0,
    membrainEntriesUsed: 0,
    maxSocialAccounts: 6,
    maxPostsPerWeek: 25,
    maxStorageBytes: 10 * 1024 * 1024 * 1024,
    maxAiTokensPerMonth: 100_000,
    maxMembrainEntries: 100,
    ...overrides,
  };
}

function buildRepo(overrides: Partial<BlotatoAccountRepository> = {}): BlotatoAccountRepository {
  return {
    upsertAccounts: async (accounts) => accounts.map((a) => account(a)),
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
    findActiveForOrganisationAndPlatform: async () => [],
    listActiveForOrganisation: async () => [],
    assignToOrganisation: async (id, orgId) => account({ id, organisationId: orgId }),
    removeFromOrganisation: async () => {},
    ...overrides,
  };
}

function buildUsageRepo(forOrg: OrganisationUsage | null = usage()): UsageRepository {
  return {
    forOrganisation: async () => forOrg,
    forAllVisibleOrganisations: async () => (forOrg ? [forOrg] : []),
    updateLimits: async () => {},
  };
}

// ── Publisher helpers ──────────────────────────────────────────────────────────

function publishInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    organisationId: ORG_A,
    draftId: DRAFT_ID,
    jobId: "job-1",
    attemptId: "attempt-1",
    attemptNumber: 1,
    platform: "linkedin",
    title: "Test post",
    body: "Body text",
    assetUrls: [],
    devSimulationMode: "always_succeed",
    ...overrides,
  };
}

function publishedStatus(id: string): BlotatoPostStatus {
  return {
    postSubmissionId: id,
    status: "published",
    scheduledTime: null,
    publicUrl: `https://blotato.example.com/post/${id}`,
    errorMessage: null,
  };
}

function fakeClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [],
    publishPost: async () => ({ postSubmissionId: "sub-1" }),
    getPostStatus: async (id) => publishedStatus(id),
    ...overrides,
  };
}

function publisherDeps(repoOverrides: Partial<BlotatoAccountRepository> = {}): BlotatoPublisherDeps {
  return {
    blotatoAccounts: buildRepo(repoOverrides),
    blotatoClient: fakeClient(),
    livePublishingEnabled: true,
    statusPollIntervalMs: 0,
  };
}

// ── 1–3: listOrganisationChannels ─────────────────────────────────────────────

describe("listOrganisationChannels", () => {
  it("1 — returns all active accounts for the given org", async () => {
    const ch1 = account({ id: "a1", organisationId: ORG_A });
    const ch2 = account({ id: "a2", organisationId: ORG_A });
    const repo = buildRepo({ listActiveForOrganisation: async () => [ch1, ch2] });

    const result = await listOrganisationChannels({ blotatoAccounts: repo }, ORG_A);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["a1", "a2"]);
  });

  it("2 — excludes inactive accounts (only active=true rows are returned by the repo)", async () => {
    const repo = buildRepo({ listActiveForOrganisation: async (orgId) => (orgId === ORG_A ? [account()] : []) });

    const resultA = await listOrganisationChannels({ blotatoAccounts: repo }, ORG_A);
    const resultB = await listOrganisationChannels({ blotatoAccounts: repo }, ORG_B);

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(0);
  });

  it("3 — returns empty array when no channels are connected", async () => {
    const repo = buildRepo({ listActiveForOrganisation: async () => [] });

    const result = await listOrganisationChannels({ blotatoAccounts: repo }, ORG_A);

    expect(result).toHaveLength(0);
  });
});

// ── 4–8: assignChannelToOrganisation ──────────────────────────────────────────

describe("assignChannelToOrganisation", () => {
  it("4 — platform-admin assigns an unassigned account; repository receives correct ids", async () => {
    const unassigned = account({ id: "acc-unassigned", organisationId: null });
    const assigned = account({ id: "acc-unassigned", organisationId: ORG_A });
    let capturedOrgId: string | null = null;

    const repo = buildRepo({
      listAccounts: async () => [unassigned],
      listActiveForOrganisation: async () => [],
      assignToOrganisation: async (id, orgId) => {
        capturedOrgId = orgId;
        return { ...assigned, id };
      },
    });

    const result = await assignChannelToOrganisation(
      { actor: actor(), blotatoAccounts: repo, usage: buildUsageRepo() },
      { organisationId: ORG_A, blotatoAccountId: "acc-unassigned" },
    );

    expect(result.organisationId).toBe(ORG_A);
    expect(capturedOrgId).toBe(ORG_A);
  });

  it("5 — non-admin actor is forbidden", async () => {
    await expect(
      assignChannelToOrganisation(
        { actor: actor({ isPlatformAdmin: false }), blotatoAccounts: buildRepo(), usage: buildUsageRepo() },
        { organisationId: ORG_A, blotatoAccountId: "acc-1" },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("6 — enforces maxSocialAccounts guardrail; throws LimitExceededError when at limit", async () => {
    const existing = [account({ id: "a1" }), account({ id: "a2" })];
    const repo = buildRepo({ listActiveForOrganisation: async () => existing, listAccounts: async () => existing });

    await expect(
      assignChannelToOrganisation(
        { actor: actor(), blotatoAccounts: repo, usage: buildUsageRepo(usage({ maxSocialAccounts: 2 })) },
        { organisationId: ORG_A, blotatoAccountId: "acc-new" },
      ),
    ).rejects.toThrow(LimitExceededError);
  });

  it("7 — throws ConflictError when the account already belongs to a different org", async () => {
    const ownedByOrgB = account({ id: "acc-owned", organisationId: ORG_B });
    const repo = buildRepo({ listAccounts: async () => [ownedByOrgB], listActiveForOrganisation: async () => [] });

    await expect(
      assignChannelToOrganisation(
        { actor: actor(), blotatoAccounts: repo, usage: buildUsageRepo() },
        { organisationId: ORG_A, blotatoAccountId: "acc-owned" },
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("8 — previously removed account (active=false, null org) can be re-assigned", async () => {
    const removed = account({ id: "acc-removed", organisationId: null, active: false });
    const reactivated = account({ id: "acc-removed", organisationId: ORG_A, active: true });
    const repo = buildRepo({
      listAccounts: async () => [removed],
      listActiveForOrganisation: async () => [],
      assignToOrganisation: async () => reactivated,
    });

    const result = await assignChannelToOrganisation(
      { actor: actor(), blotatoAccounts: repo, usage: buildUsageRepo() },
      { organisationId: ORG_A, blotatoAccountId: "acc-removed" },
    );

    expect(result.active).toBe(true);
    expect(result.organisationId).toBe(ORG_A);
  });
});

// ── 9–11: removeChannelFromOrganisation ───────────────────────────────────────

describe("removeChannelFromOrganisation", () => {
  it("9 — platform-admin can remove a channel; removeFromOrganisation is called with correct id", async () => {
    let removed: string | null = null;
    const repo = buildRepo({ removeFromOrganisation: async (id) => { removed = id; } });

    await removeChannelFromOrganisation(
      { actor: actor(), blotatoAccounts: repo },
      { blotatoAccountId: "acc-to-remove" },
    );

    expect(removed).toBe("acc-to-remove");
  });

  it("10 — non-admin actor is forbidden", async () => {
    await expect(
      removeChannelFromOrganisation(
        { actor: actor({ isPlatformAdmin: false }), blotatoAccounts: buildRepo() },
        { blotatoAccountId: "acc-1" },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("11 — after removal, channel is no longer listed as active for the org", async () => {
    const ch = account({ id: "acc-live", organisationId: ORG_A, active: true });
    const store: BlotatoAccount[] = [ch];

    const repo = buildRepo({
      listActiveForOrganisation: async () => store.filter((a) => a.active),
      removeFromOrganisation: async (id) => {
        const idx = store.findIndex((a) => a.id === id);
        if (idx !== -1) store[idx] = { ...store[idx]!, active: false };
      },
    });

    await removeChannelFromOrganisation({ actor: actor(), blotatoAccounts: repo }, { blotatoAccountId: "acc-live" });

    const remaining = await listOrganisationChannels({ blotatoAccounts: repo }, ORG_A);
    expect(remaining).toHaveLength(0);
  });
});

// ── 12–13: listAvailableAccountsForAssignment ─────────────────────────────────

describe("listAvailableAccountsForAssignment", () => {
  it("12 — returns only unassigned (organisationId=null) provider-active accounts", async () => {
    const unassigned = account({ id: "u1", organisationId: null, providerActive: true });
    const assigned = account({ id: "a1", organisationId: ORG_A, providerActive: true });
    const repo = buildRepo({ listAccounts: async () => [unassigned, assigned] });

    const result = await listAvailableAccountsForAssignment({ actor: actor(), blotatoAccounts: repo });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("u1");
  });

  it("13 — non-admin actor is forbidden", async () => {
    await expect(
      listAvailableAccountsForAssignment({
        actor: actor({ isPlatformAdmin: false }),
        blotatoAccounts: buildRepo(),
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ── 14–22: Publisher routing ───────────────────────────────────────────────────

describe("Publisher — multi-client routing", () => {
  it("14 — single active account resolves and publish succeeds (happy path)", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      publisherDeps({ findActiveForOrganisationAndPlatform: async () => [account({ platform: "linkedin" })] }),
    );

    const result = await publisher.publish(publishInput());

    expect(result.success).toBe(true);
  });

  it("15 — 0 active accounts → blotato_no_connected_account (fail closed)", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      publisherDeps({ findActiveForOrganisationAndPlatform: async () => [] }),
    );

    const result = await publisher.publish(publishInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_no_connected_account");
      expect(result.errorMessage).toContain("linkedin");
    }
  });

  it("16 — 2 active accounts + no resolvedAccountId → blotato_ambiguous_account (fail closed)", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      publisherDeps({
        findActiveForOrganisationAndPlatform: async () => [
          account({ id: "acc-a", platform: "linkedin" }),
          account({ id: "acc-b", platform: "linkedin" }),
        ],
      }),
    );

    const result = await publisher.publish(publishInput({ resolvedAccountId: null }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_ambiguous_account");
    }
  });

  it("17 — 2 active accounts + matching resolvedAccountId → correct account used (destination lock)", async () => {
    const accA = account({ id: "acc-a", platform: "linkedin" });
    const accB = account({ id: "acc-b", platform: "linkedin" });
    let usedAccountId: string | undefined;

    const publisher = new BlotatoLinkedInPublisher({
      ...publisherDeps({ findActiveForOrganisationAndPlatform: async () => [accA, accB] }),
      blotatoClient: fakeClient({
        publishPost: async ({ accountId }) => {
          usedAccountId = accountId;
          return { postSubmissionId: "sub-locked" };
        },
      }),
    });

    const result = await publisher.publish(publishInput({ resolvedAccountId: "acc-b" }));

    expect(result.success).toBe(true);
    expect(usedAccountId).toBe("acc-b");
  });

  it("18 — 2 active accounts + resolvedAccountId that no longer matches → blotato_ambiguous_account", async () => {
    const publisher = new BlotatoLinkedInPublisher(
      publisherDeps({
        findActiveForOrganisationAndPlatform: async () => [
          account({ id: "acc-a", platform: "linkedin" }),
          account({ id: "acc-b", platform: "linkedin" }),
        ],
      }),
    );

    const result = await publisher.publish(publishInput({ resolvedAccountId: "acc-deleted" }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_ambiguous_account");
      expect(result.errorMessage).toContain("acc-deleted");
    }
  });

  it("19 — account.active=false returned by repo → blotato_account_inactive (belt-and-suspenders)", async () => {
    const inactive = account({ id: "acc-off", platform: "linkedin", active: false });
    const publisher = new BlotatoLinkedInPublisher(
      publisherDeps({ findActiveForOrganisationAndPlatform: async () => [inactive] }),
    );

    const result = await publisher.publish(publishInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_account_inactive");
    }
  });

  it("20 — org isolation: findActiveForOrganisationAndPlatform is called with the job's organisationId", async () => {
    const capturedOrgIds: string[] = [];
    const publisher = new BlotatoLinkedInPublisher(
      publisherDeps({
        findActiveForOrganisationAndPlatform: async (_platform, orgId) => {
          capturedOrgIds.push(orgId);
          if (orgId === ORG_A) return [account({ platform: "linkedin" })];
          return [];
        },
      }),
    );

    await publisher.publish(publishInput({ organisationId: ORG_A }));

    expect(capturedOrgIds).toHaveLength(1);
    expect(capturedOrgIds[0]).toBe(ORG_A);
  });

  it("21 — destination lock routes to the locked account even when a newer account is also active", async () => {
    const original = account({ id: "acc-original", platform: "linkedin" });
    const newer = account({ id: "acc-newer", platform: "linkedin" });
    let publishedTo: string | undefined;

    const publisher = new BlotatoLinkedInPublisher({
      ...publisherDeps({ findActiveForOrganisationAndPlatform: async () => [original, newer] }),
      blotatoClient: fakeClient({
        publishPost: async ({ accountId }) => {
          publishedTo = accountId;
          return { postSubmissionId: "sub-original" };
        },
      }),
    });

    // resolvedAccountId was set at scheduling time (pointing to the original account)
    await publisher.publish(publishInput({ resolvedAccountId: "acc-original" }));

    expect(publishedTo).toBe("acc-original");
  });

  it("22 — null-org account is excluded: findActiveForOrganisationAndPlatform with org boundary returns []", async () => {
    const nullOrgAccount = account({ id: "acc-null-org", platform: "linkedin", organisationId: null });
    const publisher = new BlotatoLinkedInPublisher(
      publisherDeps({
        findActiveForOrganisationAndPlatform: async (_platform, orgId) =>
          orgId === null ? [nullOrgAccount] : [],
      }),
    );

    const result = await publisher.publish(publishInput({ organisationId: ORG_A }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("blotato_no_connected_account");
    }
  });
});
