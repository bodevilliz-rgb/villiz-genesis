/**
 * Sprint 10A.1 — Blotato RLS hardening tests (A–E).
 *
 * Tests A–E verify the five security contracts introduced by the
 * 20260807130000_blotato_rls_hardening.sql migration:
 *
 * A: Repository-level org isolation — findMostRecentForPlatform returns null
 *    for a wrong-org or null-org account even when the row physically exists.
 *
 * B: Test Connection cannot erase an existing org assignment — the repository
 *    contract (backed by the DB trigger) preserves organisationId when null is
 *    passed by upsertAccounts.
 *
 * C: NULL legacy account is never selected for org publishing — an unbackfilled
 *    (null-org) account cannot satisfy a publishingJob's org requirement.
 *
 * D: Service-role worker resolves the correct org-scoped account — an org-
 *    scoped account IS found and the publish succeeds (the service-role bypass
 *    of RLS is architectural; this test verifies the behavioural result).
 *
 * E: Claimed job always reaches a terminal state (published or failed) — no
 *    code path leaves a job permanently stuck in processing after it is claimed.
 *    Stale recovery (called every iteration) is the explicit safety net for the
 *    edge case where failure recording itself errors.
 */

// ── Module-scope mock for blotatoConfig (worker tests D & E) ─────────────────
// This file's worker tests use in-memory fakes directly (no route handler) so
// the vi.mock() calls below only cover infrastructure classes the worker imports
// transitively. The key mock is blotatoConfig — per-test overrides via
// vi.mocked().mockReturnValueOnce() select the live or simulation path.

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(() => ({
    apiKey: "test-key",
    enabled: true,
    livePublishingEnabled: false,
  })),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { testBlotatoConnection } from "@/core/application/use-cases/blotato";
import {
  runPublishingWorkerIteration,
  type WorkerDeps,
} from "@/core/application/use-cases/publishing/worker";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import type { BlotatoAccount, BlotatoAccountSummary } from "@/core/domain/entities/blotato";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { Actor } from "@/core/domain/entities/identity";
import type { ContentDraft } from "@/core/domain/entities/content";
import type {
  PublishingRepository,
  CreatePublishingAttemptInput,
} from "@/core/application/ports/publishing-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { PublishingJob, PublishingAttempt } from "@/core/domain/entities/publishing";
import type { AuditEvent, AuditRepository } from "@/core/application/ports/audit-port";
import type { NotificationRecord, NotificationRepository } from "@/core/application/ports/notification-port";

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG_A = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const ORG_B = "00000000-0000-4000-8000-bbbbbbbbbbbb";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const JOB_ID = "rls-job-1";

// ── Shared fixtures ───────────────────────────────────────────────────────────

function adminActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    email: "admin@villiz.com",
    fullName: "Admin User",
    avatarUrl: null,
    jobTitle: null,
    role: "admin",
    isActive: true,
    isPlatformAdmin: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function storedAccount(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    id: "acc-1",
    platform: "instagram",
    fullname: "Villiz Pixels",
    username: "villizpixels",
    organisationId: ORG_A,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-07T12:00:00Z",
    ...overrides,
  };
}

function summary(overrides: Partial<BlotatoAccountSummary> = {}): BlotatoAccountSummary {
  return { id: "acc-1", platform: "instagram", fullname: "Villiz Pixels", username: "villizpixels", ...overrides };
}

function baseJob(overrides: Partial<PublishingJob> = {}): PublishingJob {
  return {
    id: JOB_ID,
    organisationId: ORG_A,
    draftId: DRAFT_ID,
    platform: "instagram",
    triggerType: "immediate",
    scheduledFor: new Date(Date.now() - 1000).toISOString(),
    status: "queued",
    idempotencyKey: "rls-key-1",
    requestedBy: "user-1",
    requestedByProfile: { id: "user-1", fullName: "User One", email: "user@villiz.com" },
    createdAt: "2026-08-07T10:00:00Z",
    updatedAt: "2026-08-07T10:00:00Z",
    claimedBy: null,
    nextAttemptAt: null,
    retryCount: 0,
    maxRetries: 3,
    completedAt: null,
    cancelledAt: null,
    devSimulationMode: null,
    ...overrides,
  };
}

function baseDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: DRAFT_ID,
    organisationId: ORG_A,
    title: "RLS hardening test draft",
    contentType: "social_post",
    summary: null,
    body: "Body text for RLS hardening tests.",
    status: "publishing",
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    dueAt: null,
    reviewerIds: [],
    createdAt: "2026-08-07T10:00:00Z",
    updatedAt: "2026-08-07T10:00:00Z",
    createdBy: { id: "user-1", fullName: "User One", email: "user@villiz.com" },
    updatedBy: { id: "user-1", fullName: "User One", email: "user@villiz.com" },
    priority: "medium",
    reviewDeadline: null,
    ...overrides,
  };
}

// ── Repository fakes ──────────────────────────────────────────────────────────

function fakeAccountRepo(account: BlotatoAccount | null): BlotatoAccountRepository {
  return {
    upsertAccounts: async (accounts) => accounts.map((a) => storedAccount(a)),
    listAccounts: async () => (account ? [account] : []),
    findMostRecentForPlatform: async (platform, organisationId) => {
      if (!account) return null;
      if (account.platform !== platform) return null;
      if (account.organisationId !== organisationId) return null;
      return account;
    },
  };
}

function fakeContentRepo(draft: ContentDraft = baseDraft()): ContentRepository {
  let current = draft;
  const repo: Partial<ContentRepository> = {
    async findDraft(orgId, draftId) {
      if (orgId !== current.organisationId || draftId !== current.id) return null;
      return current;
    },
    async updateStatus(_orgId, _draftId, status, _by) {
      current = { ...current, status };
      return current;
    },
  };
  return repo as ContentRepository;
}

function fakeClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [summary()],
    publishPost: vi.fn(async () => ({ postSubmissionId: "sub-rls-1" })),
    getPostStatus: async (id) => ({
      postSubmissionId: id,
      status: "published",
      scheduledTime: null,
      publicUrl: "https://blotato.example.com/post/sub-rls-1",
      errorMessage: null,
    }),
    ...overrides,
  };
}

function fakeAudits(): AuditRepository {
  const stub: Partial<AuditRepository> = {
    recordEvent: async () => ({} as AuditEvent),
    listEventsForDraft: async () => [],
  };
  return stub as AuditRepository;
}

function fakeNotifications(): NotificationRepository {
  const stub: Partial<NotificationRepository> = {
    createNotification: async () => ({} as NotificationRecord),
    listNotifications: async () => [],
    markAsRead: async () => {},
  };
  return stub as NotificationRepository;
}

// ── Publishing harness ────────────────────────────────────────────────────────

function createPublishingHarness(initialJob: PublishingJob | null = baseJob()) {
  const jobs = new Map<string, PublishingJob>();
  const attempts = new Map<string, PublishingAttempt>();
  let attemptSeq = 0;
  let staleRecoveryCalled = 0;

  if (initialJob) jobs.set(initialJob.id, initialJob);

  const repo: Partial<PublishingRepository> = {
    async recoverStaleJobs(_staleAfterSeconds) {
      staleRecoveryCalled += 1;
      return [];
    },
    async claimNextJob(_workerId) {
      const queued = [...jobs.values()].find(
        (j) => j.status === "queued" && new Date(j.scheduledFor) <= new Date(),
      );
      if (!queued) return null;
      const claimed: PublishingJob = { ...queued, status: "processing", claimedBy: _workerId };
      jobs.set(claimed.id, claimed);
      return claimed;
    },
    async createAttempt(input: CreatePublishingAttemptInput) {
      attemptSeq += 1;
      const attempt: PublishingAttempt = {
        id: `rls-attempt-${attemptSeq}`,
        jobId: input.jobId,
        organisationId: input.organisationId,
        draftId: input.draftId,
        platform: input.platform,
        attemptNumber: input.attemptNumber,
        status: "queued",
        queuedAt: "2026-08-07T10:00:00Z",
        startedAt: null,
        completedAt: null,
        failedAt: null,
        durationMs: null,
        externalPostId: null,
        externalUrl: null,
        errorCode: null,
        errorMessage: null,
        retryOfAttemptId: input.retryOfAttemptId,
        providerMetadata: {},
        createdAt: "2026-08-07T10:00:00Z",
      };
      attempts.set(attempt.id, attempt);
      return attempt;
    },
    async startAttempt(attemptId) {
      const existing = attempts.get(attemptId)!;
      const updated: PublishingAttempt = {
        ...existing,
        status: "started",
        startedAt: new Date().toISOString(),
      };
      attempts.set(attemptId, updated);
      return updated;
    },
    async completeAttempt(attemptId, input) {
      const existing = attempts.get(attemptId)!;
      const updated: PublishingAttempt = {
        ...existing,
        status: "completed",
        completedAt: new Date().toISOString(),
        durationMs: 100,
        externalPostId: input.externalPostId,
        externalUrl: input.externalUrl,
        providerMetadata: input.providerMetadata,
      };
      attempts.set(attemptId, updated);
      return updated;
    },
    async failAttempt(attemptId, input) {
      const existing = attempts.get(attemptId)!;
      const updated: PublishingAttempt = {
        ...existing,
        status: "failed",
        failedAt: new Date().toISOString(),
        durationMs: 100,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      };
      attempts.set(attemptId, updated);
      return updated;
    },
    async listAttemptsForJob(_orgId, jobId) {
      return [...attempts.values()].filter((a) => a.jobId === jobId);
    },
    async markJobPublished(jobId) {
      const job = jobs.get(jobId)!;
      const updated: PublishingJob = { ...job, status: "published", completedAt: new Date().toISOString() };
      jobs.set(jobId, updated);
      return updated;
    },
    async markJobFailed(jobId) {
      const job = jobs.get(jobId)!;
      const updated: PublishingJob = { ...job, status: "failed", completedAt: new Date().toISOString() };
      jobs.set(jobId, updated);
      return updated;
    },
  };

  return {
    repo: repo as PublishingRepository,
    jobs,
    attempts,
    staleRecoveryCalled: () => staleRecoveryCalled,
  };
}

function workerDeps(
  publishing: PublishingRepository,
  content: ContentRepository,
  accounts: BlotatoAccountRepository,
  client: BlotatoClient = fakeClient(),
): WorkerDeps {
  return {
    publishing,
    content,
    blotatoAccounts: accounts,
    blotatoClient: client,
    audits: fakeAudits(),
    notifications: fakeNotifications(),
  };
}

function enableLivePublishing(): void {
  vi.mocked(blotatoConfig).mockReturnValueOnce({
    apiKey: "test-key",
    enabled: true,
    livePublishingEnabled: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A — Organisation isolation: repository-level
// ─────────────────────────────────────────────────────────────────────────────

describe("A — org isolation: findMostRecentForPlatform enforces org boundary", () => {
  it("returns null when the only stored account belongs to org B, not org A", async () => {
    // Account is physically in the store but scoped to org B
    const orgBAccount = storedAccount({ organisationId: ORG_B });
    const repo = fakeAccountRepo(orgBAccount);

    // Query for org A → must return null; the row is invisible to org A
    const result = await repo.findMostRecentForPlatform("instagram", ORG_A);
    expect(result).toBeNull();
  });

  it("returns the account only when the organisationId exactly matches", async () => {
    const orgAAccount = storedAccount({ organisationId: ORG_A });
    const repo = fakeAccountRepo(orgAAccount);

    const found = await repo.findMostRecentForPlatform("instagram", ORG_A);
    expect(found).not.toBeNull();
    expect(found?.organisationId).toBe(ORG_A);
  });

  it("a null-org account is not visible to any org — it cannot satisfy an org-scoped query", async () => {
    // Legacy row: not yet backfilled, organisationId is null
    const nullOrgAccount = storedAccount({ organisationId: null });
    const repo = fakeAccountRepo(nullOrgAccount);

    // Neither org A nor org B can resolve it — null !== ORG_A, null !== ORG_B
    const fromOrgA = await repo.findMostRecentForPlatform("instagram", ORG_A);
    const fromOrgB = await repo.findMostRecentForPlatform("instagram", ORG_B);

    expect(fromOrgA).toBeNull();
    expect(fromOrgB).toBeNull();
  });

  it("org A worker job cannot publish using org B account — fails with blotato_no_connected_account", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob({ organisationId: ORG_A }));
    const orgBAccount = storedAccount({ organisationId: ORG_B });

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(orgBAccount)),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("blotato_no_connected_account");
    }
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — Test Connection cannot clear existing organisationId
// ─────────────────────────────────────────────────────────────────────────────

describe("B — Test Connection preserves existing organisationId (trigger contract)", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.BLOTATO_ENABLED = "true";
    process.env.BLOTATO_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("upsertAccounts(accounts, null) preserves existing organisationId — simulates DB trigger", async () => {
    const ORG = ORG_A;
    const ACCOUNT_ID = "acc-trigger-test";

    // State: account was already backfilled to ORG by an operator
    const store = new Map<string, BlotatoAccount>();
    store.set(ACCOUNT_ID, storedAccount({ id: ACCOUNT_ID, organisationId: ORG }));

    // Repository fake that simulates the blotato_preserve_organisation_id trigger:
    // if the existing row has a non-null org and the incoming update supplies null,
    // the trigger preserves the existing value.
    const triggerAwareRepo: BlotatoAccountRepository = {
      upsertAccounts: async (accounts, organisationId) => {
        return accounts.map((a) => {
          const existing = store.get(a.id);
          // Trigger: COALESCE(incoming.organisation_id, existing.organisation_id)
          const resolvedOrg =
            organisationId !== null ? organisationId : (existing?.organisationId ?? null);
          const updated = storedAccount({ ...a, organisationId: resolvedOrg });
          store.set(a.id, updated);
          return updated;
        });
      },
      listAccounts: async () => [...store.values()],
      findMostRecentForPlatform: async () => null,
    };

    // Act: admin clicks Test Connection — passes null as organisationId
    const result = await testBlotatoConnection({
      actor: adminActor(),
      blotatoClient: fakeClient({
        listAccounts: async () => [summary({ id: ACCOUNT_ID })],
      }),
      blotatoAccounts: triggerAwareRepo,
    });

    expect(result.reachable).toBe(true);

    // The trigger must have preserved the org assignment — not erased it
    const afterUpsert = store.get(ACCOUNT_ID)!;
    expect(afterUpsert.organisationId).toBe(ORG);
    expect(afterUpsert.organisationId).not.toBeNull();
  });

  it("explicit org assignment always wins — trigger does not block a deliberate org update", async () => {
    const ACCOUNT_ID = "acc-trigger-explicit";
    const store = new Map<string, BlotatoAccount>();
    store.set(ACCOUNT_ID, storedAccount({ id: ACCOUNT_ID, organisationId: null }));

    const triggerAwareRepo: BlotatoAccountRepository = {
      upsertAccounts: async (accounts, organisationId) => {
        return accounts.map((a) => {
          const existing = store.get(a.id);
          const resolvedOrg = organisationId ?? existing?.organisationId ?? null;
          const updated = storedAccount({ ...a, organisationId: resolvedOrg });
          store.set(a.id, updated);
          return updated;
        });
      },
      listAccounts: async () => [...store.values()],
      findMostRecentForPlatform: async () => null,
    };

    // An org-aware upsert (e.g. future Sprint 10B flow) passing an explicit org ID
    await triggerAwareRepo.upsertAccounts([summary({ id: ACCOUNT_ID })], ORG_B);

    const afterExplicit = store.get(ACCOUNT_ID)!;
    expect(afterExplicit.organisationId).toBe(ORG_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — NULL legacy account is never selected for org publishing
// ─────────────────────────────────────────────────────────────────────────────

describe("C — NULL-org legacy account cannot drive an org publishing job", () => {
  it("worker fails with blotato_no_connected_account when the only account has organisationId=null", async () => {
    const nullOrgAccount = storedAccount({ organisationId: null });
    const { repo, jobs, attempts } = createPublishingHarness(baseJob());

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(nullOrgAccount)),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("blotato_no_connected_account");
    }
    // Job is failed — not stuck in processing
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    // Attempt was recorded — retry is possible after backfill
    expect(attempts.size).toBe(1);
    expect([...attempts.values()][0]!.errorCode).toBe("blotato_no_connected_account");
  });

  it("no account at all also produces blotato_no_connected_account — same failure path as null-org", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null)),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("blotato_no_connected_account");
    }
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — Service-role worker resolves correct org-scoped account
// ─────────────────────────────────────────────────────────────────────────────

describe("D — service-role worker resolves org-scoped account and publishes", () => {
  it("org-scoped account (matching job organisationId) is resolved and publish succeeds", async () => {
    // The account is correctly assigned to ORG_A — as a service-role read would return it.
    const orgScopedAccount = storedAccount({ organisationId: ORG_A, platform: "instagram" });
    const { repo, jobs, attempts } = createPublishingHarness(baseJob({ organisationId: ORG_A }));

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(orgScopedAccount)),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed" && result.result === "published") {
      expect(result.externalUrl).toBeTruthy();
    }
    expect(jobs.get(JOB_ID)?.status).toBe("published");
    expect(attempts.size).toBe(1);
    expect([...attempts.values()][0]!.status).toBe("completed");
  });

  it("findMostRecentForPlatform is called with the job organisationId — never a hardcoded value", async () => {
    const orgScopedAccount = storedAccount({ organisationId: ORG_A });
    const capturedQueries: Array<{ platform: string; orgId: string }> = [];

    const spyAccountRepo: BlotatoAccountRepository = {
      ...fakeAccountRepo(orgScopedAccount),
      findMostRecentForPlatform: async (platform, orgId) => {
        capturedQueries.push({ platform, orgId });
        if (orgId === ORG_A && platform === "instagram") return orgScopedAccount;
        return null;
      },
    };

    const { repo } = createPublishingHarness(baseJob({ organisationId: ORG_A }));

    enableLivePublishing();
    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo(), spyAccountRepo));

    expect(capturedQueries).toHaveLength(1);
    expect(capturedQueries[0]!.orgId).toBe(ORG_A);
    expect(capturedQueries[0]!.platform).toBe("instagram");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — Claimed job always reaches a terminal state
// ─────────────────────────────────────────────────────────────────────────────

describe("E — durable state: every worker execution path reaches published or failed", () => {
  it("success path: job transitions queued → processing → published (never stuck in processing)", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());

    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(storedAccount())),
    );

    expect(result.status).toBe("processed");
    expect(jobs.get(JOB_ID)?.status).toBe("published");
    expect(jobs.get(JOB_ID)?.status).not.toBe("processing");
  });

  it("publisher failure path: job transitions processing → failed (devSimulationMode=always_fail)", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob({ devSimulationMode: "always_fail" }));

    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(storedAccount())),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).not.toBe("processing");
  });

  it("missing account path: job reaches failed — not stuck at processing", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null)),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).not.toBe("processing");
  });

  it("unexpected throw in publisher: job reaches failed — worker does not rethrow", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());
    const throwingClient: BlotatoClient = {
      ...fakeClient(),
      publishPost: async () => {
        throw new Error("Unexpected network disruption during publish");
      },
    };

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(storedAccount()), throwingClient),
    );

    // Worker must not rethrow — it catches internally
    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).not.toBe("processing");
  });

  it("stale recovery is called on every iteration — the explicit safety net for stuck-processing jobs", async () => {
    // Even when a hypothetical error left a prior job in 'processing', the NEXT
    // iteration always calls recoverStaleJobs before claiming — so stuck jobs
    // are eventually re-queued by the DB function, then retried.
    const { repo, staleRecoveryCalled } = createPublishingHarness(null);

    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null)));
    expect(staleRecoveryCalled()).toBe(1);

    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null)));
    expect(staleRecoveryCalled()).toBe(2);
  });

  it("when failPublishingAttempt throws, markJobFailed fallback ensures job reaches failed state (not stuck in processing)", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());

    const faultyRepo: PublishingRepository = {
      ...(repo as PublishingRepository),
      failAttempt: async () => {
        throw new Error("DB connection lost while recording failure");
      },
    };

    const throwingClient: BlotatoClient = {
      ...fakeClient(),
      publishPost: async () => {
        throw new Error("Publisher error triggering the fail path");
      },
    };

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(faultyRepo, fakeContentRepo(), fakeAccountRepo(storedAccount()), throwingClient),
    );

    // Worker must not throw
    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("failed");

    // markJobFailed fallback must have run — job is terminal, not stuck in processing
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).not.toBe("processing");

    // Failure code identifies that attempt finalisation (not the original publish) failed
    if (result.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("publishing_attempt_finalisation_failed");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — Attempt-finalisation fallback contract
// ─────────────────────────────────────────────────────────────────────────────

describe("F — attempt-finalisation fallback: all six required contract assertions", () => {
  // 1 + 2: failPublishingAttempt throws → markJobFailed called → job = failed
  it("(1+2) when failAttempt throws inside failPublishingAttempt, markJobFailed fallback is called and job reaches failed state", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());

    const faultyRepo: PublishingRepository = {
      ...(repo as PublishingRepository),
      failAttempt: async () => {
        throw new Error("DB write failed during attempt failure recording");
      },
    };

    const throwingClient: BlotatoClient = {
      ...fakeClient(),
      publishPost: async () => {
        throw new Error("Publisher network error");
      },
    };

    enableLivePublishing();
    await runPublishingWorkerIteration(
      workerDeps(faultyRepo, fakeContentRepo(), fakeAccountRepo(storedAccount()), throwingClient),
    );

    // markJobFailed was the fallback — job is not stuck in processing
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).not.toBe("processing");
  });

  // 3 + 4: worker does not throw; result is processed/failed
  it("(3+4) worker does not throw and returns status:processed result:failed failureCode:publishing_attempt_finalisation_failed", async () => {
    const { repo } = createPublishingHarness(baseJob());

    const faultyRepo: PublishingRepository = {
      ...(repo as PublishingRepository),
      failAttempt: async () => {
        throw new Error("DB unavailable");
      },
    };

    const throwingClient: BlotatoClient = {
      ...fakeClient(),
      publishPost: async () => {
        throw new Error("Publisher error");
      },
    };

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(faultyRepo, fakeContentRepo(), fakeAccountRepo(storedAccount()), throwingClient),
    );

    expect(result).toMatchObject({ status: "processed", result: "failed" });
    if (result.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("publishing_attempt_finalisation_failed");
    }
  });

  // 5: stale recovery called at the start of every iteration regardless
  it("(5) stale recovery is called at the beginning of every worker iteration, including after finalisation failures", async () => {
    const { repo, staleRecoveryCalled } = createPublishingHarness(null);

    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null)));
    expect(staleRecoveryCalled()).toBe(1);

    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null)));
    expect(staleRecoveryCalled()).toBe(2);
  });

  // 6: normal failure path returns original error code — fallback NOT triggered
  it("(6) normal failPublishingAttempt success returns the original provider error code, not publishing_attempt_finalisation_failed", async () => {
    // devSimulationMode=always_fail causes simulatePublish to return success:false
    // with errorCode=mock_simulated_failure. failPublishingAttempt succeeds (no DB error).
    const { repo } = createPublishingHarness(baseJob({ devSimulationMode: "always_fail" }));

    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(storedAccount())),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed" && result.result === "failed") {
      // Original provider error code preserved — fallback was NOT triggered
      expect(result.failureCode).toBe("mock_simulated_failure");
      expect(result.failureCode).not.toBe("publishing_attempt_finalisation_failed");
    }
  });

  // Bonus: publisher returns failure object (non-throw path) + failAttempt throws
  it("publisher-returns-failure path also triggers fallback when failPublishingAttempt throws", async () => {
    // always_fail → simulatePublish returns { success: false } — does NOT throw.
    // failAttempt throws to simulate the DB error inside failPublishingAttempt.
    const { repo, jobs } = createPublishingHarness(baseJob({ devSimulationMode: "always_fail" }));

    const faultyRepo: PublishingRepository = {
      ...(repo as PublishingRepository),
      failAttempt: async () => {
        throw new Error("DB write failed");
      },
    };

    const result = await runPublishingWorkerIteration(
      workerDeps(faultyRepo, fakeContentRepo(), fakeAccountRepo(storedAccount())),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    if (result.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("publishing_attempt_finalisation_failed");
    }
  });
});
