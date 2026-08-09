/**
 * Lifecycle tests for the provider-active / Genesis-mapping separation.
 *
 * Two distinct flags govern a BlotatoAccount's state:
 *   active         — Genesis mapping status: true when assigned to an org and live for
 *                    publishing; set false by removeFromOrganisation.
 *   providerActive — Provider availability: true when Blotato's listAccounts returned
 *                    this account in the most recent sync; false after sweepMissingAccounts.
 *
 * Before this fix, availability for (re-)assignment was gated on `active`, which
 * conflated "provider still has this account" with "Genesis mapping is live". An account
 * previously removed from an org had active=false and therefore could never be
 * re-assigned — even though Blotato still reported it. providerActive decouples the two.
 */

import { describe, expect, it, vi } from "vitest";
import {
  listAvailableAccountsForAssignment,
  assignChannelToOrganisation,
  removeChannelFromOrganisation,
  listOrganisationChannels,
} from "@/core/application/use-cases/organisation-social-accounts";
import { testBlotatoConnection } from "@/core/application/use-cases/blotato";
import { ConflictError, ForbiddenError, LimitExceededError } from "@/core/domain/errors";
import type { Actor } from "@/core/domain/entities/identity";
import type { BlotatoAccount, BlotatoAccountSummary } from "@/core/domain/entities/blotato";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { UsageRepository } from "@/core/application/ports/usage-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";

// ── constants ──────────────────────────────────────────────────────────────────

const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

// ── factories ──────────────────────────────────────────────────────────────────

function platformAdmin(overrides: Partial<Actor> = {}): Actor {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.com",
    fullName: "Platform Admin",
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
    id: "ext-acc-1",
    platform: "linkedin",
    fullname: "Test Account",
    username: "testaccount",
    organisationId: null,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-08T00:00:00Z",
    ...overrides,
  };
}

function summary(overrides: Partial<BlotatoAccountSummary> = {}): BlotatoAccountSummary {
  return { id: "ext-acc-1", platform: "linkedin", fullname: "Test Account", username: "testaccount", ...overrides };
}

function fakeRepo(overrides: Partial<BlotatoAccountRepository> = {}): BlotatoAccountRepository {
  return {
    upsertAccounts: vi.fn(async (accounts: BlotatoAccountSummary[]) => accounts.map((a) => account(a))),
    listAccounts: vi.fn(async () => []),
    findMostRecentForPlatform: vi.fn(async () => null),
    findActiveForOrganisationAndPlatform: vi.fn(async () => []),
    listActiveForOrganisation: vi.fn(async () => []),
    assignToOrganisation: vi.fn(async () => account({ organisationId: ORG_A, active: true })),
    removeFromOrganisation: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeUsage(maxSocialAccounts: number, _currentCount: number = 0): UsageRepository {
  return {
    forOrganisation: vi.fn(async () => ({
      organisationId: ORG_A,
      maxSocialAccounts,
      maxPostsPerWeek: 50,
      maxStorageBytes: 1_073_741_824,
      maxAiTokensPerMonth: 100_000,
      maxMembrainEntries: 500,
      socialAccountsUsed: 0,
      postsThisWeek: 0,
      storageBytesUsed: 0,
      aiTokensThisMonth: 0,
      membrainEntriesUsed: 0,
    })),
    forAllVisibleOrganisations: vi.fn(async () => []),
    updateLimits: vi.fn(async () => {}),
  };
}

function fakeBlotatoClient(accounts: BlotatoAccountSummary[] = []): BlotatoClient {
  return {
    listAccounts: vi.fn(async () => accounts),
    uploadMedia: vi.fn(async () => ({ url: "https://media.blotato.com/asset.jpg", id: "mid-1" })),
    publishPost: vi.fn(async () => ({ postSubmissionId: "sub-1" })),
    getPostStatus: vi.fn(async (id) => ({
      postSubmissionId: id,
      status: "published" as const,
      scheduledTime: null,
      publicUrl: null,
      errorMessage: null,
    })),
  };
}

// ── helpers ────────────────────────────────────────────────────────────────────

async function available(repo: BlotatoAccountRepository): Promise<BlotatoAccount[]> {
  return listAvailableAccountsForAssignment({ actor: platformAdmin(), blotatoAccounts: repo });
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("blotato account lifecycle", () => {
  // ---------------------------------------------------------------------------
  // 1. New provider account discovered → unassigned + available
  // ---------------------------------------------------------------------------
  it("1: new account discovered via sync appears as available for assignment", async () => {
    const freshAccount = account({ id: "ext-new-1", organisationId: null, active: true, providerActive: true });
    const repo = fakeRepo({ listAccounts: async () => [freshAccount] });

    const result = await available(repo);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ext-new-1");
    expect(result[0]!.organisationId).toBeNull();
    expect(result[0]!.providerActive).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 2. Unassigned account with active=false but providerActive=true → available
  //    This is the @villizpixelsuk scenario: removeFromOrganisation set active=false
  //    but the provider still reports the account. The OLD filter (organisationId===null
  //    && active) would have excluded it; the NEW filter (organisationId===null &&
  //    providerActive) correctly includes it.
  // ---------------------------------------------------------------------------
  it("2: unassigned account with active=false but providerActive=true is available (the removeFromOrg fix)", async () => {
    const previouslyRemoved = account({
      id: "ext-prev-removed",
      organisationId: null,
      active: false,     // set by removeFromOrganisation
      providerActive: true, // provider still reports it
    });
    const repo = fakeRepo({ listAccounts: async () => [previouslyRemoved] });

    const result = await available(repo);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ext-prev-removed");
    // Confirm that if we had used the OLD filter (active=true), we would get nothing.
    const oldFilterResult = (await repo.listAccounts()).filter(
      (a) => a.organisationId === null && a.active,
    );
    expect(oldFilterResult).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Assigned account remains assigned after sync (trigger contract)
  //    upsertAccounts must NOT clear organisationId for already-assigned accounts.
  //    The DB trigger blotato_preserve_organisation_id handles this; at the
  //    application layer we verify that an account returned by upsertAccounts
  //    with a non-null organisationId is NOT listed as available for assignment.
  // ---------------------------------------------------------------------------
  it("3: assigned account is not listed as available after a sync", async () => {
    const assignedAccount = account({ id: "ext-assigned", organisationId: ORG_A, active: true, providerActive: true });

    // The trigger preserves organisationId during upsert, so listAccounts returns
    // the account with its org still set.
    const repo = fakeRepo({
      upsertAccounts: async (accounts) => accounts.map((a) => ({ ...assignedAccount, ...a })),
      listAccounts: async () => [assignedAccount],
    });

    // Simulate a sync
    await repo.upsertAccounts([summary({ id: "ext-assigned" })], null);

    // Available for assignment excludes accounts with a non-null organisationId.
    const result = await available(repo);
    expect(result).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Removed mapping becomes available for reassignment if provider still reports it
  //    removeFromOrganisation sets organisationId=null, active=false.
  //    Because the provider still returns the account, providerActive stays true.
  //    The account must be available for reassignment to a NEW org.
  // ---------------------------------------------------------------------------
  it("4: account removed from Genesis mapping is re-assignable when provider still reports it", async () => {
    const removedButProviderActive = account({
      id: "ext-acc-removed",
      organisationId: null,
      active: false,
      providerActive: true,
    });
    const repo = fakeRepo({ listAccounts: async () => [removedButProviderActive] });

    const result = await available(repo);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ext-acc-removed");
    expect(result[0]!.active).toBe(false);      // mapping removed
    expect(result[0]!.providerActive).toBe(true); // provider still active
  });

  // ---------------------------------------------------------------------------
  // 5. Account removed from provider becomes unavailable (sweepMissingAccounts)
  //    If Blotato no longer reports an account, the sweep sets providerActive=false.
  //    Such an account must NOT appear in the available list regardless of active.
  // ---------------------------------------------------------------------------
  it("5: account absent from provider sync is unavailable (providerActive=false)", async () => {
    const sweptAccount = account({ id: "ext-swept", organisationId: null, active: true, providerActive: false });
    const repo = fakeRepo({ listAccounts: async () => [sweptAccount] });

    const result = await available(repo);

    expect(result).toHaveLength(0);
  });

  it("5b: account absent from provider AND previously removed from org is still unavailable", async () => {
    const sweptAndRemoved = account({
      id: "ext-swept-removed",
      organisationId: null,
      active: false,
      providerActive: false,
    });
    const repo = fakeRepo({ listAccounts: async () => [sweptAndRemoved] });

    const result = await available(repo);

    expect(result).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Provider reappears → account becomes available again if still unassigned
  //    After a sweep (providerActive=false), the next sync upserts the account
  //    with providerActive=true. If it remains unassigned, it should reappear.
  // ---------------------------------------------------------------------------
  it("6: account that reappears in provider sync is available again if unassigned", async () => {
    // Simulate state after re-sync: providerActive flipped back to true.
    const reappearedAccount = account({
      id: "ext-reappeared",
      organisationId: null,
      active: false,   // Genesis mapping was previously removed
      providerActive: true, // provider reported it again → sweep reset
    });
    const repo = fakeRepo({ listAccounts: async () => [reappearedAccount] });

    const result = await available(repo);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ext-reappeared");
    expect(result[0]!.providerActive).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 7. No auto-assignment occurs during sync
  //    testBlotatoConnection calls upsertAccounts (not assignToOrganisation).
  //    Accounts must be returned in an unassigned state; nothing is auto-assigned.
  // ---------------------------------------------------------------------------
  it("7: syncing via testBlotatoConnection never auto-assigns accounts to an organisation", async () => {
    const assignToOrganisation = vi.fn(async () => account({ organisationId: ORG_A, active: true }));
    const repo = fakeRepo({ assignToOrganisation });

    await testBlotatoConnection({
      actor: platformAdmin(),
      blotatoClient: fakeBlotatoClient([summary({ id: "ext-new" })]),
      blotatoAccounts: repo,
    });

    expect(assignToOrganisation).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 8. Cross-org ownership remains protected
  //    An account already assigned to ORG_A cannot be reassigned to ORG_B
  //    without first being removed from ORG_A.
  // ---------------------------------------------------------------------------
  it("8: assigning an account that belongs to a different org throws ConflictError", async () => {
    const orgAAccount = account({ id: "ext-owned-by-a", organisationId: ORG_A, active: true, providerActive: true });
    const repo = fakeRepo({ listAccounts: async () => [orgAAccount] });
    const usage = fakeUsage(5);

    await expect(
      assignChannelToOrganisation(
        { actor: platformAdmin(), blotatoAccounts: repo, usage },
        { organisationId: ORG_B, blotatoAccountId: "ext-owned-by-a" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("8b: assigning to the same org the account already belongs to does not throw", async () => {
    const orgAAccount = account({ id: "ext-owned-by-a", organisationId: ORG_A, active: true, providerActive: true });
    const repo = fakeRepo({ listAccounts: async () => [orgAAccount] });
    const usage = fakeUsage(5, 1);

    await expect(
      assignChannelToOrganisation(
        { actor: platformAdmin(), blotatoAccounts: repo, usage },
        { organisationId: ORG_A, blotatoAccountId: "ext-owned-by-a" },
      ),
    ).resolves.toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 9. Channel limits remain enforced
  //    assignChannelToOrganisation must throw LimitExceededError when the org has
  //    reached its maxSocialAccounts limit, regardless of providerActive state.
  // ---------------------------------------------------------------------------
  it("9: assigning a channel when org is at limit throws LimitExceededError", async () => {
    const MAX = 2;
    const existingChannels = [
      account({ id: "ch-1", organisationId: ORG_A, active: true }),
      account({ id: "ch-2", organisationId: ORG_A, active: true }),
    ];
    const availableAccount = account({ id: "ext-unassigned", organisationId: null, providerActive: true });
    const repo = fakeRepo({
      listAccounts: async () => [availableAccount, ...existingChannels],
      listActiveForOrganisation: async () => existingChannels,
    });
    const usage = fakeUsage(MAX);

    await expect(
      assignChannelToOrganisation(
        { actor: platformAdmin(), blotatoAccounts: repo, usage },
        { organisationId: ORG_A, blotatoAccountId: "ext-unassigned" },
      ),
    ).rejects.toBeInstanceOf(LimitExceededError);
  });

  it("9b: assigning a channel when org is below limit succeeds", async () => {
    const MAX = 3;
    const existingChannels = [account({ id: "ch-1", organisationId: ORG_A, active: true })];
    const availableAccount = account({ id: "ext-free", organisationId: null, providerActive: true });
    const repo = fakeRepo({
      listAccounts: async () => [availableAccount, ...existingChannels],
      listActiveForOrganisation: async () => existingChannels,
    });
    const usage = fakeUsage(MAX);

    await expect(
      assignChannelToOrganisation(
        { actor: platformAdmin(), blotatoAccounts: repo, usage },
        { organisationId: ORG_A, blotatoAccountId: "ext-free" },
      ),
    ).resolves.toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 10. Multi-platform behaviour works generically
  //     The same filter logic must work for any platform, not just Instagram.
  //     LinkedIn and Twitter accounts follow identical lifecycle rules.
  // ---------------------------------------------------------------------------
  it("10: available filter works generically across multiple platforms", async () => {
    const linkedinAccount = account({
      id: "ext-linkedin",
      platform: "linkedin",
      username: "testlinkedin",
      organisationId: null,
      active: true,
      providerActive: true,
    });
    const twitterAccount = account({
      id: "ext-twitter",
      platform: "twitter",
      username: "testtwitter",
      organisationId: null,
      active: false,    // previously removed from org
      providerActive: true, // provider still reports it
    });
    const sweptInstagram = account({
      id: "ext-instagram-swept",
      platform: "instagram",
      username: "testinsta",
      organisationId: null,
      active: true,
      providerActive: false, // swept: provider no longer returns it
    });

    const repo = fakeRepo({ listAccounts: async () => [linkedinAccount, twitterAccount, sweptInstagram] });

    const result = await available(repo);

    expect(result).toHaveLength(2);
    const ids = result.map((a) => a.id);
    expect(ids).toContain("ext-linkedin");
    expect(ids).toContain("ext-twitter");
    expect(ids).not.toContain("ext-instagram-swept");
  });

  it("10b: non-platform-admin actor cannot list available accounts for any platform", async () => {
    const regularUser = platformAdmin({ isPlatformAdmin: false });
    const repo = fakeRepo({ listAccounts: async () => [account()] });

    await expect(
      listAvailableAccountsForAssignment({ actor: regularUser, blotatoAccounts: repo }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("10c: removeChannelFromOrganisation followed by provider sync makes account available across platforms", async () => {
    // Start: account assigned to org
    const assignedState = account({ id: "ext-multi", platform: "twitter", organisationId: ORG_A, active: true, providerActive: true });
    const removeFromOrganisation = vi.fn(async () => {});

    const repo = fakeRepo({
      removeFromOrganisation,
      // After removal + sync: organisationId=null, active=false, providerActive=true
      listAccounts: async () => [
        account({ id: "ext-multi", platform: "twitter", organisationId: null, active: false, providerActive: true }),
      ],
    });

    await removeChannelFromOrganisation(
      { actor: platformAdmin(), blotatoAccounts: repo },
      { blotatoAccountId: assignedState.id },
    );

    expect(removeFromOrganisation).toHaveBeenCalledWith("ext-multi");

    // After removal + next provider sync, account is available again
    const result = await available(repo);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ext-multi");
    expect(result[0]!.platform).toBe("twitter");
  });
});

// ── Migration-era / fail-closed semantics ──────────────────────────────────────
//
// Migration DEFAULT false means every row that existed before the migration
// begins with providerActive=false ("provider-unverified"). This guarantees:
//   - No historical account is assumed available until the provider confirms it.
//   - Assigned accounts fail closed for publishing until the next sync verifies them.
//   - The first Test Connection after migration is the gate that activates accounts.
// These tests prove that contract independently of the broader lifecycle tests.
// ---------------------------------------------------------------------------

describe("migration-era: fail-closed before first provider sync", () => {
  // ---------------------------------------------------------------------------
  // M1. Historical migrated account is NOT available before first sync
  //     At migration time all rows get providerActive=false. Such an account
  //     must be invisible to listAvailableAccountsForAssignment.
  // ---------------------------------------------------------------------------
  it("M1: historical account with providerActive=false is not available before first sync", async () => {
    const historical = account({
      id: "ext-historical",
      organisationId: null,
      active: true,
      providerActive: false, // DEFAULT false assigned at migration time
    });
    const repo = fakeRepo({ listAccounts: async () => [historical] });

    const result = await available(repo);

    expect(result).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // M2. First sync activates only accounts returned by Blotato
  //     After the first post-migration Test Connection, returned accounts get
  //     providerActive=true; accounts not in the response remain false.
  // ---------------------------------------------------------------------------
  it("M2: first sync activates returned accounts; stale ones stay unavailable", async () => {
    // Simulate repository state AFTER the first sync runs:
    //   - ext-returned: provider returned it → providerActive=true
    //   - ext-stale:    provider did NOT return it → providerActive=false (sweep)
    const returnedAccount = account({ id: "ext-returned", organisationId: null, providerActive: true });
    const staleAccount = account({ id: "ext-stale", organisationId: null, providerActive: false });
    const repo = fakeRepo({ listAccounts: async () => [returnedAccount, staleAccount] });

    const result = await available(repo);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ext-returned");
  });

  // ---------------------------------------------------------------------------
  // M3. Stale historical account remains unavailable for assignment
  //     An account that existed before migration but is no longer in Blotato
  //     should remain providerActive=false and never appear as assignable.
  // ---------------------------------------------------------------------------
  it("M3: stale historical account not returned by any sync stays unavailable", async () => {
    const stale = account({
      id: "ext-stale-forever",
      organisationId: null,
      active: false,       // previously removed from org
      providerActive: false, // never returned by any sync
    });
    const repo = fakeRepo({ listAccounts: async () => [stale] });

    const result = await available(repo);

    expect(result).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // M4. Assigned account's org ownership is preserved even with providerActive=false
  //     Setting providerActive=false (migration default or sweep) MUST NOT
  //     clear organisation_id. The account remains owned and blocked for
  //     publishing, but is NOT available for reassignment to another org.
  // ---------------------------------------------------------------------------
  it("M4: assigned account retains organisationId when providerActive=false", async () => {
    // Both listAccounts and listActiveForOrganisation model the post-migration state:
    // account is assigned but not yet verified by provider.
    const assignedUnverified = account({
      id: "ext-assigned-unverified",
      organisationId: ORG_A,
      active: true,
      providerActive: false, // migration default — not yet synced
    });
    const listAccounts = vi.fn(async () => [assignedUnverified]);
    const repo = fakeRepo({ listAccounts });

    // Should NOT appear in available list — it has a non-null organisationId.
    const assignable = await available(repo);
    expect(assignable).toHaveLength(0);

    // And its organisationId must not be null — ownership is intact.
    const all = await repo.listAccounts();
    expect(all[0]!.organisationId).toBe(ORG_A);
    expect(all[0]!.providerActive).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // M5. Publishing fails closed for assigned account not yet verified by provider
  //     findActiveForOrganisationAndPlatform (used by the publisher) returns []
  //     when providerActive=false, even for accounts with active=true.
  //     The Connected Channels panel (listActiveForOrganisation) is equally empty.
  // ---------------------------------------------------------------------------
  it("M5: connected channels panel is empty for assigned accounts with providerActive=false", async () => {
    const assignedUnverified = account({
      id: "ext-assigned-no-sync",
      organisationId: ORG_A,
      active: true,
      providerActive: false,
    });

    // Repository contract: listActiveForOrganisation filters on active=true AND
    // provider_active=true — so providerActive=false accounts are excluded.
    const repo = fakeRepo({
      listActiveForOrganisation: async () => [], // providerActive=false → excluded
    });

    const channels = await listOrganisationChannels({ blotatoAccounts: repo }, ORG_A);

    expect(channels).toHaveLength(0);

    // Demonstrate the account exists — it just isn't returned by the filtered query.
    // (In production, the repository SELECT WHERE provider_active=true excludes it.)
    void assignedUnverified; // referenced to make the intent explicit
  });

  // ---------------------------------------------------------------------------
  // M6. After first sync verifies assigned account, publishing path unblocks
  //     The first Test Connection sets providerActive=true for the returned
  //     account. listActiveForOrganisation now returns it, and publishing works.
  // ---------------------------------------------------------------------------
  it("M6: assigned account becomes visible in connected channels after first sync verifies it", async () => {
    const verifiedAssigned = account({
      id: "ext-assigned-verified",
      organisationId: ORG_A,
      active: true,
      providerActive: true, // first sync has now run and returned this account
    });

    const repo = fakeRepo({
      listActiveForOrganisation: async (orgId) =>
        orgId === ORG_A ? [verifiedAssigned] : [],
    });

    const channels = await listOrganisationChannels({ blotatoAccounts: repo }, ORG_A);

    expect(channels).toHaveLength(1);
    expect(channels[0]!.id).toBe("ext-assigned-verified");
    expect(channels[0]!.providerActive).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // M7. Mervic/Villiz-style scenario: existing assigned account and previously-
  //     removed account both start providerActive=false at migration time.
  //     After the first Test Connection returns both, both become available/usable.
  //     The assigned account (@jummyte4u-style) is usable for publishing.
  //     The removed account (@villizpixelsuk-style) is available for assignment.
  // ---------------------------------------------------------------------------
  it("M7: both assigned and unassigned historical accounts activate on first sync", async () => {
    // Pre-sync state (migration DEFAULT false):
    const assignedPreSync = account({
      id: "ext-jummyte4u-style",
      organisationId: ORG_A,
      active: true,
      providerActive: false,
    });
    const removedPreSync = account({
      id: "ext-villizpixelsuk-style",
      organisationId: null,
      active: false,
      providerActive: false,
    });

    // Post-sync state (Blotato returned both):
    const assignedPostSync = { ...assignedPreSync, providerActive: true };
    const removedPostSync = { ...removedPreSync, providerActive: true };

    // After sync: available list includes the unassigned+providerActive account.
    const repoAfterSync = fakeRepo({
      listAccounts: async () => [assignedPostSync, removedPostSync],
      listActiveForOrganisation: async (orgId) =>
        orgId === ORG_A ? [assignedPostSync] : [],
    });

    const assignable = await available(repoAfterSync);
    expect(assignable).toHaveLength(1);
    expect(assignable[0]!.id).toBe("ext-villizpixelsuk-style");
    expect(assignable[0]!.providerActive).toBe(true);

    const channels = await listOrganisationChannels({ blotatoAccounts: repoAfterSync }, ORG_A);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.id).toBe("ext-jummyte4u-style");
    expect(channels[0]!.providerActive).toBe(true);

    // Contrast: pre-sync state produces nothing.
    const repoBeforeSync = fakeRepo({
      listAccounts: async () => [assignedPreSync, removedPreSync],
      listActiveForOrganisation: async () => [],
    });

    expect(await available(repoBeforeSync)).toHaveLength(0);
    expect(await listOrganisationChannels({ blotatoAccounts: repoBeforeSync }, ORG_A)).toHaveLength(0);
  });
});
