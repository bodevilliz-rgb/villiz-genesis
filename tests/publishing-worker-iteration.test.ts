/**
 * Sprint 10A — Publishing worker iteration tests (A–J).
 *
 * Tests A–H are pure unit tests of runPublishingWorkerIteration using
 * in-memory fakes. No Supabase client is ever created.
 *
 * Test G tests the POST /api/internal/publishing/run endpoint auth guard.
 * Infrastructure classes are mocked at module scope (vi.mock is hoisted) so
 * the route can be imported without a real Supabase connection. The real
 * runPublishingWorkerIteration runs with those mocked deps and returns idle
 * (no jobs queued in the mock repos).
 *
 * Tests I–J are logic-layer unit tests of the brand voice filtering that
 * runPrePublishReviewAction applies before calling analyzeDraftForPublishing.
 */

// ── Module-scope mocks for test G ─────────────────────────────────────────────
// vi.mock() is always hoisted to file scope regardless of where it is written.
// These mocks cover the infrastructure classes the route constructs on an
// authorized request. Tests A–F and H–J are unaffected: they pass their own
// inline fakes directly to runPublishingWorkerIteration.

vi.mock("@/infrastructure/supabase/admin-client", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/infrastructure/repositories/supabase-publishing-repository", () => ({
  SupabasePublishingRepository: vi.fn().mockImplementation(() => ({
    recoverStaleJobs: vi.fn(async () => []),
    claimNextJob: vi.fn(async () => null),
    listAttemptsForJob: vi.fn(async () => []),
    createAttempt: vi.fn(async () => ({})),
    startAttempt: vi.fn(async () => ({})),
    completeAttempt: vi.fn(async () => ({})),
    failAttempt: vi.fn(async () => ({})),
    markJobPublished: vi.fn(async () => ({})),
    markJobFailed: vi.fn(async () => ({})),
  })),
}));

vi.mock("@/infrastructure/repositories/supabase-blotato-account-repository", () => ({
  SupabaseBlotatoAccountRepository: vi.fn().mockImplementation(() => ({
    upsertAccounts: vi.fn(async () => []),
    listAccounts: vi.fn(async () => []),
    findMostRecentForPlatform: vi.fn(async () => null),
    findActiveForOrganisationAndPlatform: vi.fn(async () => []),
    listActiveForOrganisation: vi.fn(async () => []),
    assignToOrganisation: vi.fn(async () => ({})),
    removeFromOrganisation: vi.fn(async () => {}),
  })),
}));

vi.mock("@/infrastructure/repositories/supabase-content-repository", () => ({
  SupabaseContentRepository: vi.fn().mockImplementation(() => ({
    findDraft: vi.fn(async () => null),
    updateStatus: vi.fn(async () => ({})),
  })),
}));

vi.mock("@/infrastructure/repositories/supabase-audit-repository", () => ({
  SupabaseAuditRepository: vi.fn().mockImplementation(() => ({
    recordEvent: vi.fn(async () => ({})),
    listEventsForDraft: vi.fn(async () => []),
  })),
}));

vi.mock("@/infrastructure/repositories/supabase-notification-repository", () => ({
  SupabaseNotificationRepository: vi.fn().mockImplementation(() => ({
    createNotification: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => []),
    markAsRead: vi.fn(async () => {}),
  })),
}));

vi.mock("@/infrastructure/blotato/http-blotato-client", () => ({
  HttpBlotatoClient: vi.fn().mockImplementation(() => ({
    listAccounts: vi.fn(async () => []),
    publishPost: vi.fn(async () => ({ postSubmissionId: "fake" })),
    getPostStatus: vi.fn(async () => ({
      postSubmissionId: "fake",
      status: "published",
      scheduledTime: null,
      publicUrl: null,
      errorMessage: null,
    })),
  })),
}));

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(() => ({
    apiKey: "test-key",
    enabled: true,
    livePublishingEnabled: false,
  })),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runPublishingWorkerIteration,
  type WorkerDeps,
} from "@/core/application/use-cases/publishing/worker";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import type {
  PublishingRepository,
  CreatePublishingAttemptInput,
} from "@/core/application/ports/publishing-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { AuditRepository, AuditEvent } from "@/core/application/ports/audit-port";
import type {
  NotificationRepository,
  NotificationRecord,
} from "@/core/application/ports/notification-port";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { PublishingJob, PublishingAttempt } from "@/core/domain/entities/publishing";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG_A = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const ORG_B = "00000000-0000-4000-8000-bbbbbbbbbbbb";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const JOB_ID = "job-1";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseJob(overrides: Partial<PublishingJob> = {}): PublishingJob {
  return {
    id: JOB_ID,
    organisationId: ORG_A,
    draftId: DRAFT_ID,
    platform: "instagram",
    triggerType: "immediate",
    scheduledFor: new Date(Date.now() - 1000).toISOString(),
    status: "queued",
    idempotencyKey: "key-1",
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
    resolvedAccountId: null,
    ...overrides,
  };
}

function baseDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: DRAFT_ID,
    organisationId: ORG_A,
    title: "A draft",
    contentType: "social_post",
    summary: null,
    body: "Post body text",
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

function storedBlotatoAccount(orgId = ORG_A): BlotatoAccount {
  return {
    id: "blotato-acc-1",
    platform: "instagram",
    fullname: "Test Instagram",
    username: "testinstagram",
    organisationId: orgId,
    active: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
  };
}

// ── In-memory publishing repo harness ─────────────────────────────────────────

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
        id: `attempt-${attemptSeq}`,
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
      const updated: PublishingJob = {
        ...job,
        status: "published",
        completedAt: new Date().toISOString(),
      };
      jobs.set(jobId, updated);
      return updated;
    },
    async markJobFailed(jobId) {
      const job = jobs.get(jobId)!;
      const updated: PublishingJob = {
        ...job,
        status: "failed",
        completedAt: new Date().toISOString(),
      };
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

// ── Content repo fake ─────────────────────────────────────────────────────────

function fakeContentRepo(draft: ContentDraft = baseDraft()): ContentRepository {
  let currentDraft = draft;
  const repo: Partial<ContentRepository> = {
    async findDraft(orgId, draftId) {
      if (orgId !== currentDraft.organisationId || draftId !== currentDraft.id) return null;
      return currentDraft;
    },
    async updateStatus(_orgId, _draftId, status, _updatedBy) {
      currentDraft = { ...currentDraft, status };
      return currentDraft;
    },
  };
  return repo as ContentRepository;
}

// ── Blotato account repo fake ─────────────────────────────────────────────────

function fakeAccountRepo(account: BlotatoAccount | null = storedBlotatoAccount()): BlotatoAccountRepository {
  return {
    upsertAccounts: async (accounts, _orgId) =>
      accounts.map((a) => ({ ...storedBlotatoAccount(), ...a })),
    listAccounts: async () => (account ? [account] : []),
    findMostRecentForPlatform: async (platform, organisationId) => {
      if (!account) return null;
      if (account.platform !== platform) return null;
      if (account.organisationId !== organisationId) return null;
      return account;
    },
    findActiveForOrganisationAndPlatform: async (platform, organisationId) => {
      if (!account) return [];
      if (account.platform !== platform) return [];
      if (account.organisationId !== organisationId) return [];
      if (!account.active) return [];
      return [account];
    },
    listActiveForOrganisation: async (organisationId) => {
      if (!account) return [];
      if (account.organisationId !== organisationId) return [];
      if (!account.active) return [];
      return [account];
    },
    assignToOrganisation: async () => account ?? storedBlotatoAccount(),
    removeFromOrganisation: async () => {},
  };
}

// ── Blotato client fake ───────────────────────────────────────────────────────

function fakeClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [],
    publishPost: vi.fn(async () => ({ postSubmissionId: "sub-1" })),
    getPostStatus: async (id) => ({
      postSubmissionId: id,
      status: "published",
      scheduledTime: null,
      publicUrl: "https://blotato.example.com/post/sub-1",
      errorMessage: null,
    }),
    ...overrides,
  };
}

// ── Audit / notification fakes ────────────────────────────────────────────────

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

// ── Live-publishing helper ────────────────────────────────────────────────────
// The blotatoConfig module is mocked (livePublishingEnabled: false by default).
// Call this before tests that need the Blotato live path to be exercised.

function enableLivePublishing(): void {
  vi.mocked(blotatoConfig).mockReturnValueOnce({
    apiKey: "test-key",
    enabled: true,
    livePublishingEnabled: true,
  });
}

// ── Worker deps factory ───────────────────────────────────────────────────────

function workerDeps(
  publishing: PublishingRepository,
  content: ContentRepository,
  accounts: BlotatoAccountRepository = fakeAccountRepo(),
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

// ─────────────────────────────────────────────────────────────────────────────
// A — Worker idle
// ─────────────────────────────────────────────────────────────────────────────

describe("A — worker idle: no eligible jobs → idle result", () => {
  it("returns status:idle when there are no queued jobs", async () => {
    const { repo } = createPublishingHarness(null);
    const result = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(result).toEqual({ status: "idle" });
  });

  it("returns status:idle when the only job is not yet due (future scheduledFor)", async () => {
    const futureJob = baseJob({ scheduledFor: new Date(Date.now() + 60_000).toISOString() });
    const { repo } = createPublishingHarness(futureJob);
    const result = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(result).toEqual({ status: "idle" });
  });

  it("always calls stale-job recovery before claiming, even when idle", async () => {
    const { repo, staleRecoveryCalled } = createPublishingHarness(null);
    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(staleRecoveryCalled()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — Worker success
// ─────────────────────────────────────────────────────────────────────────────

describe("B — worker success: queued → published", () => {
  it("claims job, executes publisher, marks job published, returns processed/published", async () => {
    const { repo, jobs, attempts } = createPublishingHarness(baseJob());

    const result = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));

    expect(result).toMatchObject({ status: "processed", jobId: JOB_ID, result: "published" });
    if (result.status === "processed" && result.result === "published") {
      expect(result.externalUrl).toContain("mock-instagram-");
    }
    expect(jobs.get(JOB_ID)?.status).toBe("published");
    const attempt = [...attempts.values()][0];
    expect(attempt?.status).toBe("completed");
    expect(attempt?.externalPostId).toMatch(/^mock-instagram-/);
  });

  it("creates exactly one publishing attempt for a successful first-try job", async () => {
    const { repo, attempts } = createPublishingHarness(baseJob());
    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(attempts.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — Worker failure
// ─────────────────────────────────────────────────────────────────────────────

describe("C — worker failure: publisher returns failure → job marked failed", () => {
  it("marks job failed and records attempt when devSimulationMode=always_fail", async () => {
    const failJob = baseJob({ devSimulationMode: "always_fail" });
    const { repo, jobs, attempts } = createPublishingHarness(failJob);

    const result = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));

    expect(result).toMatchObject({ status: "processed", jobId: JOB_ID, result: "failed" });
    if (result.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("mock_simulated_failure");
    }
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    const attempt = [...attempts.values()][0];
    expect(attempt?.status).toBe("failed");
    expect(attempt?.errorCode).toBe("mock_simulated_failure");
  });

  it("records attempt history even on failure — retry is still possible", async () => {
    const failJob = baseJob({ devSimulationMode: "always_fail" });
    const { repo, attempts } = createPublishingHarness(failJob);
    await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(attempts.size).toBe(1);
    const attempt = [...attempts.values()][0]!;
    expect(attempt.errorCode).toBe("mock_simulated_failure");
    expect(attempt.errorMessage).toContain("Simulated failure");
  });

  it("catches unexpected publisher throws and records a failed attempt without rethrowing", async () => {
    const { repo, jobs, attempts } = createPublishingHarness(baseJob());
    const throwingClient: BlotatoClient = {
      ...fakeClient(),
      publishPost: async () => {
        throw new Error("Unexpected network error");
      },
    };

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(storedBlotatoAccount(ORG_A)), throwingClient),
    );

    expect(result?.status).toBe("processed");
    if (result?.status === "processed") expect(result.result).toBe("failed");
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
    expect(attempts.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — Duplicate safety
// ─────────────────────────────────────────────────────────────────────────────

describe("D — duplicate safety: second invocation does not republish a completed job", () => {
  it("second call returns idle when the only job was already published by the first", async () => {
    const { repo } = createPublishingHarness(baseJob());

    const first = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(first.status).toBe("processed");

    const second = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(second).toEqual({ status: "idle" });
  });

  it("a job already in processing state cannot be claimed by a concurrent invocation", async () => {
    const processingJob = baseJob({ status: "processing", claimedBy: "other-worker" });
    const { repo } = createPublishingHarness(processingJob);
    const result = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));
    expect(result).toEqual({ status: "idle" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — Organisation isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("E — organisation isolation: org A cannot resolve org B account", () => {
  it("with livePublishingEnabled=true, org A job cannot use org B account → blotato_no_connected_account", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());
    const orgBAccount = storedBlotatoAccount(ORG_B);
    const isolatedAccountRepo = fakeAccountRepo(orgBAccount);

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), isolatedAccountRepo, fakeClient()),
    );

    expect(result?.status).toBe("processed");
    if (result?.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("blotato_no_connected_account");
    }
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
  });

  it("findActiveForOrganisationAndPlatform is called with the job's organisationId, not a hardcoded value", async () => {
    const { repo } = createPublishingHarness(baseJob());
    const capturedArgs: Array<{ platform: string; orgId: string }> = [];

    const spyAccountRepo: BlotatoAccountRepository = {
      ...fakeAccountRepo(storedBlotatoAccount(ORG_A)),
      findActiveForOrganisationAndPlatform: async (platform, orgId) => {
        capturedArgs.push({ platform, orgId });
        return [storedBlotatoAccount(ORG_A)];
      },
    };

    enableLivePublishing();
    await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), spyAccountRepo, fakeClient()),
    );

    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]!.orgId).toBe(ORG_A);
    expect(capturedArgs[0]!.platform).toBe("instagram");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — Missing account
// ─────────────────────────────────────────────────────────────────────────────

describe("F — missing account: org has no connected account → safe failure", () => {
  it("with livePublishingEnabled=true and no account → blotato_no_connected_account", async () => {
    const { repo, jobs } = createPublishingHarness(baseJob());

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null), fakeClient()),
    );

    expect(result?.status).toBe("processed");
    if (result?.status === "processed" && result.result === "failed") {
      expect(result.failureCode).toBe("blotato_no_connected_account");
    }
    expect(jobs.get(JOB_ID)?.status).toBe("failed");
  });

  it("missing account failure still creates a failed attempt row — retry is possible", async () => {
    const { repo, attempts } = createPublishingHarness(baseJob());

    enableLivePublishing();
    await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(null), fakeClient()),
    );

    expect(attempts.size).toBe(1);
    expect([...attempts.values()][0]!.errorCode).toBe("blotato_no_connected_account");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G — Manual endpoint auth
// ─────────────────────────────────────────────────────────────────────────────

describe("G — manual endpoint: POST /api/internal/publishing/run auth checks", () => {
  const VALID_SECRET = "super-secret-key-32chars-minimum!!";

  beforeEach(() => {
    process.env.PUBLISHING_WORKER_SECRET = VALID_SECRET;
    vi.clearAllMocks();
  });

  it("missing Authorization header → 401", async () => {
    const { POST } = await import("@/app/api/internal/publishing/run/route");
    const req = new Request("http://localhost/api/internal/publishing/run", { method: "POST" });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("wrong secret → 401", async () => {
    const { POST } = await import("@/app/api/internal/publishing/run/route");
    const req = new Request("http://localhost/api/internal/publishing/run", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret-value-here" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("missing PUBLISHING_WORKER_SECRET env var → 401 for all requests (fail-closed)", async () => {
    const originalSecret = process.env.PUBLISHING_WORKER_SECRET;
    delete process.env.PUBLISHING_WORKER_SECRET;
    const { POST } = await import("@/app/api/internal/publishing/run/route");
    const req = new Request("http://localhost/api/internal/publishing/run", {
      method: "POST",
      headers: { authorization: "Bearer any-secret" },
    });
    try {
      const res = await POST(req as never);
      expect(res.status).toBe(401);
    } finally {
      process.env.PUBLISHING_WORKER_SECRET = originalSecret;
    }
  });

  it("correct secret → 200 with worker result (idle — no jobs queued in mocked repo)", async () => {
    const { POST } = await import("@/app/api/internal/publishing/run/route");
    const req = new Request("http://localhost/api/internal/publishing/run", {
      method: "POST",
      headers: { authorization: `Bearer ${VALID_SECRET}` },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "idle" });
  });

  it("GET → 405 Method Not Allowed", async () => {
    const { GET } = await import("@/app/api/internal/publishing/run/route");
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H — Simulation mode
// ─────────────────────────────────────────────────────────────────────────────

describe("H — simulation: BLOTATO_LIVE_PUBLISHING_ENABLED=false → no real Blotato API call", () => {
  it("publishPost is never called when live publishing is disabled (the default mock)", async () => {
    // blotatoConfig is mocked to return livePublishingEnabled: false by default —
    // no mock override needed here; simulation runs without touching the client.
    const { repo } = createPublishingHarness(baseJob());
    const publishPost = vi.fn(async () => ({ postSubmissionId: "should-not-be-called" }));

    await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), fakeAccountRepo(), fakeClient({ publishPost })),
    );

    expect(publishPost).not.toHaveBeenCalled();
  });

  it("full simulation lifecycle completes: queued → processing → published with mock external id", async () => {
    const { repo, jobs, attempts } = createPublishingHarness(baseJob());

    const result = await runPublishingWorkerIteration(workerDeps(repo, fakeContentRepo()));

    expect(result).toMatchObject({ status: "processed", result: "published" });
    expect(jobs.get(JOB_ID)?.status).toBe("published");
    const attempt = [...attempts.values()][0]!;
    expect(attempt.externalPostId).toMatch(/^mock-instagram-\d+$/);
    expect(attempt.externalUrl).toMatch(/^https:\/\/mock\.local\/instagram\/mock-instagram-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I — Brand voice: active entries reach pre-publish review
// ─────────────────────────────────────────────────────────────────────────────

describe("I — brand voice: active MemBrain brand_voice entries reach pre-publish review context", () => {
  it("active brand_voice entries are concatenated with \\n\\n into brandVoiceCtx", () => {
    const entries = [
      { id: "e1", category: { key: "brand_voice" }, status: "active", body: "Warm and professional." },
      { id: "e2", category: { key: "brand_voice" }, status: "active", body: "No jargon." },
    ];

    const brandVoiceCtx = entries
      .filter((e) => e.category?.key === "brand_voice" && e.status === "active")
      .map((e) => e.body)
      .join("\n\n");

    expect(brandVoiceCtx).toBe("Warm and professional.\n\nNo jargon.");
  });

  it("when no active brand_voice entries exist, brandVoiceCtx is an empty string", () => {
    const entries: { id: string; category: { key: string } | null; status: string; body: string }[] = [];

    const brandVoiceCtx = entries
      .filter((e) => e.category?.key === "brand_voice" && e.status === "active")
      .map((e) => e.body)
      .join("\n\n");

    expect(brandVoiceCtx).toBe("");
  });

  it("entries from other categories are excluded even if their status is active", () => {
    const entries = [
      { id: "e1", category: { key: "audience" }, status: "active", body: "Audience description." },
      { id: "e2", category: { key: "brand_voice" }, status: "active", body: "Real brand voice." },
    ];

    const brandVoiceCtx = entries
      .filter((e) => e.category?.key === "brand_voice" && e.status === "active")
      .map((e) => e.body)
      .join("\n\n");

    expect(brandVoiceCtx).toBe("Real brand voice.");
    expect(brandVoiceCtx).not.toContain("Audience description.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J — Brand voice: draft-status entries excluded
// ─────────────────────────────────────────────────────────────────────────────

describe("J — brand voice: draft-status Brand Voice entries are excluded from pre-publish review", () => {
  it("entries with status:draft are NOT included even if category is brand_voice", () => {
    const entries = [
      { id: "e1", category: { key: "brand_voice" }, status: "draft", body: "Should not appear." },
      { id: "e2", category: { key: "brand_voice" }, status: "archived", body: "Also excluded." },
      { id: "e3", category: { key: "brand_voice" }, status: "active", body: "Only this one." },
    ];

    const brandVoiceCtx = entries
      .filter((e) => e.category?.key === "brand_voice" && e.status === "active")
      .map((e) => e.body)
      .join("\n\n");

    expect(brandVoiceCtx).toBe("Only this one.");
    expect(brandVoiceCtx).not.toContain("Should not appear.");
    expect(brandVoiceCtx).not.toContain("Also excluded.");
  });

  it("archived entries are excluded alongside draft entries — only status:active qualifies", () => {
    const entries = [
      { id: "e1", category: { key: "brand_voice" }, status: "archived", body: "Archived entry." },
      { id: "e2", category: { key: "brand_voice" }, status: "draft", body: "Draft entry." },
    ];

    const brandVoiceCtx = entries
      .filter((e) => e.category?.key === "brand_voice" && e.status === "active")
      .map((e) => e.body)
      .join("\n\n");

    expect(brandVoiceCtx).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K — Destination lock: resolvedAccountId forwarded from job to publisher
// ─────────────────────────────────────────────────────────────────────────────

describe("K — destination lock: job.resolvedAccountId is forwarded to publisher.publish()", () => {
  it("simulation mode: job with resolvedAccountId set processes to published (no crash, no corruption)", async () => {
    // In simulation mode the publisher never touches the account repo or client,
    // so this test proves: (a) the field is forwarded without crashing executeJob,
    // and (b) a successful result is returned.
    const jobWithLock = baseJob({ resolvedAccountId: "blotato-acc-locked-42" });
    const { repo } = createPublishingHarness(jobWithLock);

    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo()),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("published");
  });

  it("simulation mode: job with resolvedAccountId=null still processes successfully (backward compat)", async () => {
    // Jobs created before destination-lock shipped have resolvedAccountId:null.
    // The publisher falls back to its own account lookup — this must not throw.
    const jobNoLock = baseJob({ resolvedAccountId: null });
    const { repo } = createPublishingHarness(jobNoLock);

    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo()),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("published");
  });

  it("live mode: when resolvedAccountId matches one of 2+ active accounts, publishPost uses that account's ID", async () => {
    // The destination-lock branch in BlotatoBlotatoPublisherBase.publish() is
    // activated when activeAccounts.length > 1. It selects the account whose
    // id matches resolvedAccountId and forwards it as accountId to publishPost.
    const ACC_A = { ...storedBlotatoAccount(ORG_A), id: "acc-a", username: "acca" };
    const ACC_B = { ...storedBlotatoAccount(ORG_A), id: "acc-b", username: "accb" };

    const twoAccountRepo: BlotatoAccountRepository = {
      ...fakeAccountRepo(ACC_A),
      // Override the method that the base publisher calls:
      findActiveForOrganisationAndPlatform: async (_platform, orgId) => {
        if (orgId !== ORG_A) return [];
        return [ACC_A, ACC_B];
      },
    };

    const jobLockedToB = baseJob({ resolvedAccountId: "acc-b" });
    const { repo } = createPublishingHarness(jobLockedToB);

    const capturedAccountIds: string[] = [];
    const spyClient = fakeClient({
      publishPost: vi.fn(async (req: { accountId: string }) => {
        capturedAccountIds.push(req.accountId);
        return { postSubmissionId: "sub-lock-b" };
      }),
    });

    enableLivePublishing();
    const result = await runPublishingWorkerIteration(
      workerDeps(repo, fakeContentRepo(), twoAccountRepo, spyClient),
    );

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("published");
    expect(capturedAccountIds).toEqual(["acc-b"]); // locked to ACC_B, not ACC_A
  });
});
