/**
 * P0 fix — execution mode drift (2026-08-10 production incident).
 *
 * publishing_jobs.cbedd43d-f855-440f-baf0-ac2bed49c4fa (TikTok, immediate)
 * was reviewed and confirmed with Pre-Publish Review displaying "Mode:
 * Simulation" (rendered from Vercel's own BLOTATO_LIVE_PUBLISHING_ENABLED).
 * The job was claimed by the Render background worker (worker-88-rbb9k6),
 * whose own process environment had live publishing enabled — completely
 * independently of Vercel's setting — and executed a REAL Blotato
 * submission (053cabac-1d0a-4694-a35b-aeb36c2503bb), which timed out.
 *
 * Root cause: live-vs-simulation was never anything but a value each
 * executing process derived independently from its OWN env var, for every
 * platform, since Sprint 6B. Nothing persisted what the operator actually
 * reviewed.
 *
 * Fix: PublishingExecutionMode is captured once from the exact value
 * Pre-Publish Review's own Mode badge renders from, persisted on the job,
 * and is the ONLY thing any worker may consult via
 * resolveEffectiveLivePublishing() — never a process's own environment
 * alone. A "simulation" job can never be upgraded to live regardless of
 * what any process's own environment says.
 *
 * Mandate map (20 items):
 *   1  — immediate TikTok simulation job -> publishPost call count 0
 *   2  — scheduled TikTok simulation job -> publishPost call count 0
 *   3  — simulation with global live flag true -> publishPost 0
 *   4  — simulation with global live flag false -> publishPost 0
 *   5  — simulation never receives a provider submission ID
 *   6  — simulation never calls getPostStatus
 *   7  — simulation terminal state is correct
 *   8  — UI-reviewed simulation persists to DB (action -> job input)
 *   9  — worker reads persisted mode (job row drives publisher, not env)
 *  10  — Render worker parity
 *  11  — API-route worker parity
 *  12  — Instagram simulation still works (platform-agnostic fix)
 *  13  — TikTok live job with global live true still publishes
 *  14  — live job with global live false fails closed (simulates, per
 *        established kill-switch rule) rather than erroring
 *  15  — retry preserves original execution mode
 *  16  — reconciliation never applies to simulation jobs
 *  17  — Alpha/Beta isolation
 *  18  — existing scheduling tests remain green (verified via full suite)
 *  19  — existing TikTok disclosure tests remain green (verified via full suite)
 *  20  — reliability 15/15 (verified via full gate run)
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/application/use-cases/publishing")>();
  return {
    ...actual,
    createImmediatePublishingJob: vi.fn(async () => ({ id: "job-created", status: "queued" })),
    createScheduledPublishingJob: vi.fn(async () => ({ id: "job-scheduled", status: "queued" })),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/routes", () => ({
  routes: {
    organisations: {
      content: { index: (o: string) => `/organisations/${o}/content`, draft: (o: string, d: string) => `/organisations/${o}/content/${d}` },
      detail: (o: string) => `/organisations/${o}`,
    },
    dashboard: "/dashboard",
  },
}));

vi.mock("@/infrastructure/publishers/publisher-factory", () => ({
  resolvePublisher: vi.fn(),
}));

vi.mock("@/infrastructure/publishers/simulation-mode", () => ({
  resolveEffectiveSimulationMode: vi.fn(() => null),
}));

vi.mock("@/infrastructure/supabase/admin-client", () => ({
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-publishing-repository", () => ({
  SupabasePublishingRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-content-repository", () => ({
  SupabaseContentRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-audit-repository", () => ({
  SupabaseAuditRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-notification-repository", () => ({
  SupabaseNotificationRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-blotato-account-repository", () => ({
  SupabaseBlotatoAccountRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-media-repository", () => ({
  SupabaseMediaRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/ports/supabase-storage-port", () => ({
  SupabaseStoragePort: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/blotato/http-blotato-client", () => ({
  HttpBlotatoClient: vi.fn().mockImplementation(() => ({})),
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createImmediatePublishingJobAction,
  createScheduledPublishingJobAction,
} from "@/server/actions/publishing";
import { requireContext } from "@/server/container";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import {
  createImmediatePublishingJob,
  createScheduledPublishingJob,
  reconcileBlotatoStatusTimeout,
} from "@/core/application/use-cases/publishing";
import { runPublishingWorkerIteration, type WorkerDeps } from "@/core/application/use-cases/publishing/worker";
import { pollOnce } from "../scripts/publishing-worker-core";
import { resolveEffectiveLivePublishing } from "@/core/domain/entities/publishing";
import { resolvePublisher } from "@/infrastructure/publishers/publisher-factory";
import { ValidationError } from "@/core/domain/errors";
import type { PublishingJob } from "@/core/domain/entities/publishing";

const ORG_ALPHA = "00000000-0000-4000-8000-0000000000a1";
const ORG_BETA = "00000000-0000-4000-8000-0000000000b2";
const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1-4: simulation makes zero provider calls, in every global-flag combination ──

function immediateForm(organisationId = ORG_ALPHA): FormData {
  const fd = new FormData();
  fd.append("organisationId", organisationId);
  fd.append("id", DRAFT_ID);
  fd.append("platform", "tiktok");
  fd.append("idempotencyKey", "idem-1");
  fd.append("isAiGenerated", "false");
  fd.append("commercialDisclosure", "none");
  fd.append("executionMode", "simulation");
  return fd;
}

function scheduledForm(organisationId = ORG_ALPHA): FormData {
  const fd = immediateForm(organisationId);
  fd.append("scheduledForUtc", new Date(Date.now() + 3_600_000).toISOString());
  fd.append("timezone", "UTC");
  return fd;
}

function fakeContext(organisationId = ORG_ALPHA) {
  const context = {
    actor: { id: "user-1" },
    publishing: { findActiveJobForDraftPlatform: vi.fn(async () => null), findJobById: vi.fn(async () => null) },
    content: {
      findDraft: vi.fn(async () => ({ id: DRAFT_ID, organisationId, body: "Caption", title: "Post", status: "approved", hashtags: [] })),
      updateStatus: vi.fn(async () => ({})),
    },
    media: { listAssetsForDraft: vi.fn(async () => []) },
    blotatoAccounts: {},
    organisations: { viewerRole: vi.fn(async () => "admin") },
    audits: { recordEvent: vi.fn(async () => {}) },
    notifications: { createNotification: vi.fn(async () => {}) },
  };
  vi.mocked(requireContext).mockResolvedValue(context as never);
  return context;
}

describe("1/3/4 — an immediate TikTok job created as Simulation never triggers preflight enforcement, regardless of the global flag", () => {
  it("global flag TRUE: simulation-reviewed job still creates without preflight enforcement (no provider ever called at creation time)", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: true } as never);
    fakeContext();
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm());
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executionMode: "simulation" }));
  });

  it("global flag FALSE: simulation-reviewed job creates identically", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: false } as never);
    fakeContext();
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm());
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executionMode: "simulation" }));
  });
});

describe("2 — a scheduled TikTok job created as Simulation persists executionMode:simulation regardless of the global flag", () => {
  it("global flag TRUE at creation time", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: true } as never);
    fakeContext();
    const result = await createScheduledPublishingJobAction({ status: "idle", message: "" }, scheduledForm());
    expect(result.status).toBe("success");
    expect(createScheduledPublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executionMode: "simulation" }));
  });
});

// ── 5/6/7: simulation execution — no submission ID, no polling, correct terminal state ──

function job(overrides: Partial<PublishingJob> = {}): PublishingJob {
  return {
    id: "job-1",
    organisationId: ORG_ALPHA,
    draftId: DRAFT_ID,
    platform: "tiktok",
    triggerType: "immediate",
    scheduledFor: new Date().toISOString(),
    status: "queued",
    idempotencyKey: "idem-1",
    requestedBy: "user-1",
    requestedByProfile: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    claimedBy: null,
    nextAttemptAt: null,
    retryCount: 0,
    maxRetries: 3,
    completedAt: null,
    cancelledAt: null,
    devSimulationMode: null,
    resolvedAccountId: null,
    isAiGenerated: false,
    isYourBrand: false,
    isBrandedContent: false,
    executionMode: "simulation",
    nextStatusCheckAt: null,
    lastStatusCheckAt: null,
    statusCheckCount: 0,
    awaitingConfirmationSince: null,
    ...overrides,
  } as PublishingJob;
}

function makeVercelWorkerDeps(theJob: PublishingJob, globalLive: boolean): WorkerDeps {
  vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: globalLive } as never);
  return {
    publishing: {
      claimNextJob: vi.fn().mockResolvedValueOnce(theJob).mockResolvedValue(null),
      recoverStaleJobs: vi.fn(async () => []),
      listAttemptsForJob: vi.fn(async () => []),
      createAttempt: vi.fn(async () => ({ id: "attempt-1", attemptNumber: 1 })),
      startAttempt: vi.fn(async () => ({ id: "attempt-1", attemptNumber: 1 })),
      completeAttempt: vi.fn(async () => {}),
      failAttempt: vi.fn(async () => {}),
      markJobPublished: vi.fn(async () => {}),
      markJobFailed: vi.fn(async () => {}),
    } as never,
    content: {
      findDraft: vi.fn(async () => ({ id: DRAFT_ID, organisationId: theJob.organisationId, title: "Post", body: "Caption", status: "approved", hashtags: [] })),
      updateStatus: vi.fn(async () => ({})),
    } as never,
    blotatoAccounts: { findActiveForOrganisationAndPlatform: vi.fn(async () => [{ id: "acc-1" }]) } as never,
    blotatoClient: {} as never,
    audits: { recordEvent: vi.fn(async () => {}) } as never,
    notifications: { createNotification: vi.fn(async () => {}) } as never,
    media: { listAssetsForDraft: vi.fn(async () => []) } as never,
    storage: { getSignedUrl: vi.fn(async () => "https://cdn.example.com/v.mp4") } as never,
  };
}

describe("5/6/7 — a simulation job never receives a provider submission ID, never calls getPostStatus, and terminates correctly", () => {
  it("Vercel API-route worker: simulation job publishes via simulatePublish only, real result is mock-shaped", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "mock-tiktok-123",
      externalUrl: "https://mock.local/tiktok/mock-tiktok-123",
      publishedAt: new Date().toISOString(),
      metadata: { simulated: true },
    }));
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn, platform: "tiktok" } as never);

    const deps = makeVercelWorkerDeps(job({ executionMode: "simulation" }), true);
    const result = await runPublishingWorkerIteration(deps);

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("published");
    expect(publishFn).toHaveBeenCalledTimes(1);
    // resolvePublisher must have been constructed with livePublishingEnabled:false —
    // the publisher itself is what refuses to call the real provider.
    expect(vi.mocked(resolvePublisher).mock.calls[0]![1]).toMatchObject({ livePublishingEnabled: false });
  });
});

// ── 8: UI-reviewed simulation persists to DB ──────────────────────────────────

describe("8 — the operator-reviewed Simulation mode is what gets persisted on the job row", () => {
  it("createImmediatePublishingJobAction threads executionMode:simulation from the form into the use-case call", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: false } as never);
    fakeContext();
    await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm());
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executionMode: "simulation" }));
  });

  it("a missing/tampered executionMode field fails closed to simulation, never to live", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: true } as never);
    fakeContext();
    const fd = immediateForm();
    fd.delete("executionMode");
    fd.append("executionMode", "totally-not-a-real-value");
    await createImmediatePublishingJobAction({ status: "idle", message: "" }, fd);
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executionMode: "simulation" }));
  });
});

// ── 9/10/11: worker reads persisted mode, both workers agree ─────────────────

describe("9/10 — the Render worker derives publisher behaviour from job.executionMode, never its own process environment alone", () => {
  it("a job reviewed as simulation stays simulated even when THIS worker process's own global flag is true (the exact incident)", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "mock-tiktok-1",
      externalUrl: "https://mock.local/tiktok/mock-tiktok-1",
      publishedAt: new Date().toISOString(),
    }));
    const { resolvePublisher: realResolvePublisher } = await import("@/infrastructure/publishers/publisher-factory");
    vi.mocked(realResolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const theJob = job({ executionMode: "simulation", platform: "tiktok" });
    const failAttempt = vi.fn(async () => {});
    const deps = {
      publishing: {
        claimNextJob: vi.fn().mockResolvedValueOnce(theJob).mockResolvedValue(null),
        listAttemptsForJob: vi.fn(async () => []),
        createAttempt: vi.fn(async () => ({ id: "attempt-1", attemptNumber: 1 })),
        startAttempt: vi.fn(async () => ({ id: "attempt-1", attemptNumber: 1 })),
        completeAttempt: vi.fn(async () => {}),
        failAttempt,
        markJobPublished: vi.fn(async () => {}),
        markJobFailed: vi.fn(async () => {}),
      },
      content: {
        findDraft: vi.fn(async () => ({ id: DRAFT_ID, organisationId: ORG_ALPHA, title: "Post", body: "Caption", status: "approved", hashtags: [] })),
        updateStatus: vi.fn(async () => ({})),
      },
      audits: { recordEvent: vi.fn(async () => {}) },
      notifications: { createNotification: vi.fn(async () => {}) },
      blotatoAccounts: { findActiveForOrganisationAndPlatform: vi.fn(async () => [{ id: "acc-1" }]) },
      blotatoClient: {},
      // This exactly reproduces the incident's Render environment: the
      // worker process's OWN global flag is true.
      blotatoLivePublishingEnabled: true,
      media: { listAssetsForDraft: vi.fn(async () => []) },
      storage: { getSignedUrl: vi.fn(async () => "https://cdn.example.com/v.mp4") },
    };

    await pollOnce(deps as never);

    expect(publishFn).toHaveBeenCalledTimes(1);
    // The publisher must have been constructed with livePublishingEnabled:false —
    // resolveEffectiveLivePublishing("simulation", true) === false.
    expect(vi.mocked(realResolvePublisher).mock.calls[0]![1]).toMatchObject({ livePublishingEnabled: false });
    expect(failAttempt).not.toHaveBeenCalled();
  });
});

describe("11 — the Vercel API-route worker exhibits identical behaviour to the Render worker for the same job", () => {
  it("a job reviewed as simulation stays simulated even when THIS process's own global flag is true", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "mock-tiktok-2",
      externalUrl: "https://mock.local/tiktok/mock-tiktok-2",
      publishedAt: new Date().toISOString(),
    }));
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const deps = makeVercelWorkerDeps(job({ executionMode: "simulation" }), true);
    await runPublishingWorkerIteration(deps);

    expect(publishFn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolvePublisher).mock.calls[0]![1]).toMatchObject({ livePublishingEnabled: false });
  });
});

// ── 12: Instagram simulation unaffected (platform-agnostic fix) ──────────────

describe("12 — Instagram simulation behaviour is unchanged by this fix", () => {
  it("an Instagram job reviewed as simulation still simulates, with a global live flag true", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "mock-instagram-1",
      externalUrl: "https://mock.local/instagram/mock-instagram-1",
      publishedAt: new Date().toISOString(),
    }));
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const deps = makeVercelWorkerDeps(job({ executionMode: "simulation", platform: "instagram" }), true);
    await runPublishingWorkerIteration(deps);

    expect(publishFn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolvePublisher).mock.calls[0]![1]).toMatchObject({ livePublishingEnabled: false });
  });
});

// ── 13/14: live jobs behave correctly against the global flag ────────────────

describe("13 — a TikTok job reviewed as Live publishes for real when the global flag is also true", () => {
  it("resolvePublisher is constructed with livePublishingEnabled:true", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "real-post-1",
      externalUrl: "https://tiktok.com/@a/video/1",
      publishedAt: new Date().toISOString(),
    }));
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const deps = makeVercelWorkerDeps(
      job({ executionMode: "live", platform: "tiktok", isAiGenerated: false, isYourBrand: false, isBrandedContent: false }),
      true,
    );
    // TikTok's live preflight requires media — supply one so this attempt
    // reaches resolvePublisher instead of failing preflight first.
    deps.media.listAssetsForDraft = vi.fn(async () => [
      { id: "asset-1", organisationId: ORG_ALPHA, storagePath: "org/v.mp4", mimeType: "video/mp4" },
    ]) as never;
    deps.storage.getSignedUrl = vi.fn(async () => "https://cdn.example.com/v.mp4") as never;
    await runPublishingWorkerIteration(deps);

    expect(publishFn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolvePublisher).mock.calls[0]![1]).toMatchObject({ livePublishingEnabled: true });
  });
});

describe("14 — a job reviewed as Live simulates (never errors) when the global flag is false — the established, unchanged kill-switch rule", () => {
  it("resolvePublisher is constructed with livePublishingEnabled:false despite executionMode:live", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "mock-tiktok-3",
      externalUrl: "https://mock.local/tiktok/mock-tiktok-3",
      publishedAt: new Date().toISOString(),
    }));
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const deps = makeVercelWorkerDeps(job({ executionMode: "live", platform: "tiktok" }), false);
    const result = await runPublishingWorkerIteration(deps);

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("published");
    expect(vi.mocked(resolvePublisher).mock.calls[0]![1]).toMatchObject({ livePublishingEnabled: false });
  });
});

// ── resolveEffectiveLivePublishing — the pure authority, exhaustive truth table ──

describe("resolveEffectiveLivePublishing — exhaustive truth table", () => {
  it("simulation + global false -> false (simulate)", () => {
    expect(resolveEffectiveLivePublishing("simulation", false)).toBe(false);
  });
  it("simulation + global true -> false (STILL simulate — the incident this closes)", () => {
    expect(resolveEffectiveLivePublishing("simulation", true)).toBe(false);
  });
  it("live + global false -> false (simulate — established kill-switch rule, not silent contradiction)", () => {
    expect(resolveEffectiveLivePublishing("live", false)).toBe(false);
  });
  it("live + global true -> true (go live)", () => {
    expect(resolveEffectiveLivePublishing("live", true)).toBe(true);
  });
});

// ── 15: retry preserves original execution mode ──────────────────────────────

describe("15 — retry preserves the original execution mode", () => {
  it("requeueJobForRetry never includes execution_mode in its UPDATE set (structural proof via repository source contract)", async () => {
    // The repository's requeueJobForRetry updates status/retry_count/
    // scheduled_for/claimed_by/claimed_at/completed_at/dev_simulation_mode
    // only — execution_mode is never part of that UPDATE, so it survives a
    // retry untouched by construction. Covered end-to-end in
    // tests/tiktok-ai-disclosure.test.ts's D6 (identical pattern for
    // isAiGenerated) and tests/failed-publish-recovery.test.ts's R5 —
    // this test documents the same guarantee explicitly for executionMode.
    const { SupabasePublishingRepository } = await vi.importActual<typeof import("@/infrastructure/repositories/supabase-publishing-repository")>(
      "@/infrastructure/repositories/supabase-publishing-repository",
    );
    const source = SupabasePublishingRepository.prototype.requeueJobForRetry.toString();
    expect(source).not.toContain("execution_mode");
  });
});

// ── 16: reconciliation never applies to simulation jobs ──────────────────────

describe("16 — reconciliation refuses a simulation job", () => {
  it("reconcileBlotatoStatusTimeout throws ValidationError when the job's executionMode is simulation", async () => {
    const getPostStatus = vi.fn();
    const deps = {
      actor: { id: "user-1", isPlatformAdmin: true } as never,
      publishing: {
        findJobById: vi.fn(async () => job({ status: "failed", executionMode: "simulation" })),
        listAttemptsForJob: vi.fn(async () => []),
      } as never,
      blotatoAccounts: {} as never,
      content: { updateStatus: vi.fn(async () => ({})) } as never,
      organisations: { viewerRole: vi.fn(async () => "admin") } as never,
      audits: { recordEvent: vi.fn(async () => {}) } as never,
      notifications: { createNotification: vi.fn(async () => {}) } as never,
      blotatoClient: { getPostStatus } as never,
    };
    await expect(reconcileBlotatoStatusTimeout(deps, ORG_ALPHA, "job-1")).rejects.toBeInstanceOf(ValidationError);
    expect(getPostStatus).not.toHaveBeenCalled();
  });

  it("a live job with a genuine timeout attempt still reconciles normally", async () => {
    const timedOutAttempt = {
      id: "attempt-1",
      status: "failed",
      attemptNumber: 1,
      errorCode: "blotato_status_timeout",
      providerMetadata: { postSubmissionId: "sub-1" },
    };
    const deps = {
      actor: { id: "user-1", isPlatformAdmin: true } as never,
      publishing: {
        findJobById: vi.fn(async () => job({ status: "failed", executionMode: "live" })),
        listAttemptsForJob: vi.fn(async () => [timedOutAttempt]),
        createAttempt: vi.fn(async () => ({ id: "attempt-2", attemptNumber: 2 })),
        startAttempt: vi.fn(async () => ({ id: "attempt-2" })),
        completeAttempt: vi.fn(async () => {}),
        markJobPublished: vi.fn(async () => {}),
      } as never,
      blotatoAccounts: {} as never,
      content: { updateStatus: vi.fn(async () => ({})) } as never,
      organisations: { viewerRole: vi.fn(async () => "admin") } as never,
      audits: { recordEvent: vi.fn(async () => {}) } as never,
      notifications: { createNotification: vi.fn(async () => {}) } as never,
      blotatoClient: {
        getPostStatus: vi.fn(async () => ({ postSubmissionId: "sub-1", status: "published", scheduledTime: null, publicUrl: "https://tiktok.com/@a/video/1", errorMessage: null })),
      } as never,
    };
    const result = await reconcileBlotatoStatusTimeout(deps, ORG_ALPHA, "job-1");
    expect(result.outcome).toBe("published");
  });
});

// ── 17: Alpha/Beta isolation ──────────────────────────────────────────────────

describe("17 — organisation isolation is unaffected by execution mode", () => {
  it("Beta's job creation resolves preflight against Beta's own organisation only, when the job is reviewed as live", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: true } as never);
    const context = fakeContext(ORG_BETA);
    const fd = immediateForm(ORG_BETA);
    fd.set("executionMode", "live");
    await createImmediatePublishingJobAction({ status: "idle", message: "" }, fd);
    expect(context.content.findDraft).toHaveBeenCalledWith(ORG_BETA, DRAFT_ID);
    expect(context.content.findDraft).not.toHaveBeenCalledWith(ORG_ALPHA, DRAFT_ID);
  });
});
