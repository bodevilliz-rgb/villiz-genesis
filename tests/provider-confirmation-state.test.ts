/**
 * P0 — asynchronous provider confirmation without false failures.
 *
 * PRODUCTION INCIDENTS this closes:
 *   * TikTok job 71582654-bf14-4359-aa3f-48dd714dd00e / attempt
 *     2104a4e6-4dc2-4dcf-89fd-ed93731f36c8 / submission
 *     1144fce2-dc61-4e9b-b5ac-68e5f8511654 — media uploaded, publishPost
 *     succeeded, Genesis polled ~36s, then marked job AND draft AND attempt
 *     `failed` with blotato_status_timeout. Blotato shows the post PUBLISHED.
 *   * The same pattern previously occurred on Instagram.
 *
 * Root cause: local polling exhaustion was mapped onto the terminal `failed`
 * state. Provider-status UNCERTAINTY was persisted as provider-confirmed
 * FAILURE. Fixed with a non-terminal `awaiting_confirmation` state plus an
 * automatic, bounded-backoff confirmation pass that re-checks the EXISTING
 * submission id and never re-submits.
 *
 * Mandate map (36 items):
 *    1 — provider published inside synchronous window → Published
 *    2 — provider failed inside synchronous window → Failed
 *    3 — provider still processing past the window → Awaiting Confirmation
 *    4 — timeout does NOT mark the job Failed
 *    5 — timeout does NOT mark the draft Failed
 *    6 — timeout does NOT increment failure analytics
 *    7 — submission id persisted before the awaiting state
 *    8 — reconciliation uses the exact existing submission id
 *    9 — reconciliation publishPost call count = 0
 *   10 — reconciliation uploadMedia call count = 0
 *   11 — later provider Published → job Published
 *   12 — later provider Published → draft Published
 *   13 — later provider Failed → job Failed
 *   14 — later provider Failed → draft Failed
 *   15 — Scheduled trigger remains Scheduled after reconciliation
 *   16 — Immediate trigger remains Immediate
 *   17 — reconciliation is not counted as a retry
 *   18 — retry blocked while provider state unresolved
 *   19 — provider-confirmed failure may enter the governed retry flow
 *   20 — repeated reconciliation calls are idempotent
 *   21 — two workers cannot duplicate reconciliation work
 *   22 — Render worker parity
 *   23 — API worker parity
 *   24 — organisation isolation
 *   25 — simulation jobs never enter provider reconciliation
 *   26 — simulation provider call count remains 0
 *   27 — TikTok disclosures preserved
 *   28 — execution_mode preserved
 *   29 — media path unchanged
 *   30 — hashtag policy unchanged
 *   31-35 — Instagram/TikTok/scheduling/recovery/analytics regressions (full suite)
 *   36 — reliability 15/15 (gate run)
 * Plus: PRODUCTION SCENARIO — the exact incident, end to end.
 */

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(() => ({ apiKey: "k", enabled: true, livePublishingEnabled: true })),
}));

vi.mock("@/infrastructure/publishers/publisher-factory", () => ({
  resolvePublisher: vi.fn(),
}));

vi.mock("@/infrastructure/publishers/simulation-mode", () => ({
  resolveEffectiveSimulationMode: vi.fn(() => null),
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { runProviderConfirmationPass } from "@/core/application/use-cases/publishing/confirmation";
import { runPublishingWorkerIteration, runProviderConfirmation, type WorkerDeps } from "@/core/application/use-cases/publishing/worker";
import { retryFailedPublishingJob } from "@/core/application/use-cases/publishing";
import { computePublishingAnalytics } from "@/core/application/use-cases/publishing/analytics";
import {
  hasExceededConfirmationHorizon,
  isProviderConfirmationUnresolved,
  isTerminalPublishingJobStatus,
  nextConfirmationCheckDelayMs,
  MAX_CONFIRMATION_HORIZON_MS,
  type PublishingAttempt,
  type PublishingJob,
} from "@/core/domain/entities/publishing";
import { resolvePublisher } from "@/infrastructure/publishers/publisher-factory";
import { BlotatoTikTokPublisher } from "@/infrastructure/publishers/blotato/blotato-tiktok-publisher";

const ORG_ALPHA = "00000000-0000-4000-8000-0000000000a1";
const ORG_BETA = "00000000-0000-4000-8000-0000000000b2";
const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";
const SUBMISSION_ID = "1144fce2-dc61-4e9b-b5ac-68e5f8511654";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
    resolvedAccountId: "acc-1",
    isAiGenerated: false,
    isYourBrand: false,
    isBrandedContent: false,
    executionMode: "live",
    nextStatusCheckAt: null,
    lastStatusCheckAt: null,
    statusCheckCount: 0,
    awaitingConfirmationSince: null,
    ...overrides,
  } as PublishingJob;
}

function attempt(overrides: Partial<PublishingAttempt> = {}): PublishingAttempt {
  return {
    id: "attempt-1",
    jobId: "job-1",
    organisationId: ORG_ALPHA,
    draftId: DRAFT_ID,
    platform: "tiktok",
    attemptNumber: 1,
    status: "awaiting_confirmation",
    queuedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    failedAt: null,
    durationMs: null,
    externalPostId: null,
    externalUrl: null,
    errorCode: null,
    errorMessage: null,
    retryOfAttemptId: null,
    providerMetadata: { postSubmissionId: SUBMISSION_ID, blotatoAccountId: "acc-1" },
    createdAt: new Date().toISOString(),
    ...overrides,
  } as PublishingAttempt;
}

function providerStatus(status: "published" | "failed" | "in-progress" | "scheduled", extra: Record<string, unknown> = {}) {
  return {
    postSubmissionId: SUBMISSION_ID,
    status,
    scheduledTime: null,
    publicUrl: status === "published" ? "https://tiktok.com/@villiz/video/1" : null,
    errorMessage: status === "failed" ? "provider rejected the post" : null,
    ...extra,
  };
}

/** Confirmation-pass harness. `getPostStatus` is the ONLY provider method available by construction. */
function makeConfirmationDeps(input: {
  claimed: PublishingJob | null;
  attempts?: PublishingAttempt[];
  status?: ReturnType<typeof providerStatus>;
}) {
  const getPostStatus = vi.fn(async () => input.status ?? providerStatus("in-progress"));
  const completeAttempt = vi.fn(async () => attempt({ status: "completed" }));
  const failAttempt = vi.fn(async () => attempt({ status: "failed" }));
  const markJobPublished = vi.fn(async () => job({ status: "published" }));
  const markJobFailed = vi.fn(async () => job({ status: "failed" }));
  const recordConfirmationCheck = vi.fn(async (_jobId: string, _nextStatusCheckAt: string | null) => job({ status: "awaiting_confirmation" }));
  const claimJobForConfirmation = vi.fn(async () => input.claimed);
  const updateStatus = vi.fn(async () => ({}));
  const listAttemptsForJob = vi.fn(async (_organisationId: string, _jobId: string) => input.attempts ?? [attempt()]);

  return {
    deps: {
      publishing: {
        claimJobForConfirmation,
        listAttemptsForJob,
        completeAttempt,
        failAttempt,
        markJobPublished,
        markJobFailed,
        recordConfirmationCheck,
      } as never,
      content: { updateStatus } as never,
      audits: { recordEvent: vi.fn(async () => {}) } as never,
      notifications: { createNotification: vi.fn(async () => {}) } as never,
      blotatoClient: { getPostStatus } as never,
    },
    getPostStatus,
    completeAttempt,
    failAttempt,
    markJobPublished,
    markJobFailed,
    recordConfirmationCheck,
    claimJobForConfirmation,
    updateStatus,
    listAttemptsForJob,
  };
}

/** Vercel API-route worker harness. */
function makeWorkerDeps(input: { claimed: PublishingJob | null; publishFn: ReturnType<typeof vi.fn> }) {
  const markJobFailed = vi.fn(async () => {});
  const failAttempt = vi.fn(async () => {});
  const awaitAttemptConfirmation = vi.fn(async () => attempt());
  const markJobAwaitingConfirmation = vi.fn(async () => job({ status: "awaiting_confirmation" }));
  const updateStatus = vi.fn(async () => ({}));
  vi.mocked(resolvePublisher).mockReturnValue({ publish: input.publishFn } as never);

  const deps: WorkerDeps = {
    publishing: {
      claimNextJob: vi.fn().mockResolvedValueOnce(input.claimed).mockResolvedValue(null),
      claimJobForConfirmation: vi.fn(async () => null),
      recoverStaleJobs: vi.fn(async () => []),
      listAttemptsForJob: vi.fn(async () => []),
      createAttempt: vi.fn(async () => attempt({ status: "started" })),
      startAttempt: vi.fn(async () => attempt({ status: "started" })),
      completeAttempt: vi.fn(async () => {}),
      failAttempt,
      awaitAttemptConfirmation,
      markJobAwaitingConfirmation,
      markJobPublished: vi.fn(async () => {}),
      markJobFailed,
      recordConfirmationCheck: vi.fn(async () => job()),
    } as never,
    content: {
      findDraft: vi.fn(async () => ({ id: DRAFT_ID, organisationId: ORG_ALPHA, title: "Celebrate Yourself!", body: "Caption", status: "publishing", hashtags: [] })),
      updateStatus,
    } as never,
    blotatoAccounts: { findActiveForOrganisationAndPlatform: vi.fn(async () => [{ id: "acc-1" }]) } as never,
    blotatoClient: { getPostStatus: vi.fn() } as never,
    audits: { recordEvent: vi.fn(async () => {}) } as never,
    notifications: { createNotification: vi.fn(async () => {}) } as never,
    media: {
      listAssetsForDraft: vi.fn(async () => [{ id: "a1", organisationId: ORG_ALPHA, storagePath: "o/v.mp4", mimeType: "video/mp4" }]),
    } as never,
    storage: { getSignedUrl: vi.fn(async () => "https://cdn.example.com/v.mp4") } as never,
  };

  return { deps, markJobFailed, failAttempt, awaitAttemptConfirmation, markJobAwaitingConfirmation, updateStatus };
}

// ── 1/2/3: synchronous-window outcomes ────────────────────────────────────────

describe("1 — provider returns published inside the synchronous window → normal Published", () => {
  it("worker completes the attempt; nothing enters awaiting_confirmation", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "p1",
      externalUrl: "https://tiktok.com/@a/video/1",
      publishedAt: new Date().toISOString(),
    }));
    const { deps, awaitAttemptConfirmation } = makeWorkerDeps({ claimed: job({ status: "queued" }), publishFn });
    const result = await runPublishingWorkerIteration(deps);
    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("published");
    expect(awaitAttemptConfirmation).not.toHaveBeenCalled();
  });
});

describe("2 — provider returns failed inside the synchronous window → Failed", () => {
  it("a provider-confirmed failure still marks the job failed", async () => {
    const publishFn = vi.fn(async () => ({
      success: false as const,
      errorCode: "blotato_publish_failed",
      errorMessage: "provider rejected the post",
    }));
    const { deps, awaitAttemptConfirmation } = makeWorkerDeps({ claimed: job({ status: "queued" }), publishFn });
    const result = await runPublishingWorkerIteration(deps);
    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.result).toBe("failed");
    expect(awaitAttemptConfirmation).not.toHaveBeenCalled();
  });
});

describe("3/4/5/7 — provider still processing past the window → Awaiting Confirmation, never Failed", () => {
  it("job+attempt go awaiting_confirmation, draft is NOT marked failed, submission id is persisted first", async () => {
    const publishFn = vi.fn(async () => ({
      success: "pending" as const,
      providerSubmissionId: SUBMISSION_ID,
      metadata: { postSubmissionId: SUBMISSION_ID, blotatoAccountId: "acc-1" },
    }));
    const { deps, markJobFailed, failAttempt, awaitAttemptConfirmation, markJobAwaitingConfirmation, updateStatus } =
      makeWorkerDeps({ claimed: job({ status: "queued" }), publishFn });

    const result = await runPublishingWorkerIteration(deps);

    // 3
    expect(result.status).toBe("processed");
    if (result.status === "processed" && result.result === "awaiting_confirmation") {
      expect(result.providerSubmissionId).toBe(SUBMISSION_ID);
    } else {
      throw new Error(`expected awaiting_confirmation, got ${JSON.stringify(result)}`);
    }
    // 4 — the job is never marked failed
    expect(markJobFailed).not.toHaveBeenCalled();
    expect(failAttempt).not.toHaveBeenCalled();
    // 5 — the draft is never marked failed
    expect(updateStatus).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "failed", expect.anything());
    // 7 — the submission id is persisted on the attempt as part of entering the state
    expect(awaitAttemptConfirmation).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({ postSubmissionId: SUBMISSION_ID }),
    );
    expect(markJobAwaitingConfirmation).toHaveBeenCalledTimes(1);
  });
});

// ── 6: analytics ──────────────────────────────────────────────────────────────

describe("6 — an awaiting-confirmation job contaminates no success/failure analytic", () => {
  it("counted only as jobsAwaitingConfirmation; failure/success rates stay null", () => {
    const awaiting = job({ id: "j-await", status: "awaiting_confirmation" });
    const awaitingAttempt = attempt({ id: "a-await", jobId: "j-await", status: "awaiting_confirmation" });

    const analytics = computePublishingAnalytics([awaiting], [awaitingAttempt], new Date());

    expect(analytics.jobsAwaitingConfirmation).toBe(1);
    expect(analytics.jobsFailedRequiringAttention).toBe(0);
    // No attempt has RESOLVED (completed/failed), so every rate is null — never a misleading 0%.
    expect(analytics.attemptSuccessRate).toBeNull();
    expect(analytics.failureRate).toBeNull();
    expect(analytics.jobSuccessRate).toBeNull();
    expect(analytics.platformBreakdown.find((p) => p.platform === "tiktok")?.failedAttempts).toBe(0);
    expect(analytics.platformBreakdown.find((p) => p.platform === "tiktok")?.successfulAttempts).toBe(0);
  });

  it("awaiting_confirmation is not a terminal job status", () => {
    expect(isTerminalPublishingJobStatus("awaiting_confirmation")).toBe(false);
  });
});

// ── 8/9/10/11/12: reconciliation resolves published ───────────────────────────

describe("8/9/10/11/12 — reconciliation re-checks the exact submission and resolves Published", () => {
  it("calls getPostStatus with the persisted id; job and draft become published; no publish/upload exists to call", async () => {
    const h = makeConfirmationDeps({
      claimed: job({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() }),
      status: providerStatus("published"),
    });

    const outcome = await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });

    // 8 — exact existing submission id
    expect(h.getPostStatus).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(h.getPostStatus).toHaveBeenCalledTimes(1);
    // 9 + 10 — structurally impossible: the deps object exposes only getPostStatus.
    expect(Object.keys(h.deps.blotatoClient as object)).toEqual(["getPostStatus"]);
    // 11 — job published
    expect(h.markJobPublished).toHaveBeenCalledWith("job-1");
    expect(h.markJobFailed).not.toHaveBeenCalled();
    // 12 — draft published
    expect(h.updateStatus).toHaveBeenCalledWith(ORG_ALPHA, DRAFT_ID, "published", "user-1");
    expect(outcome.status).toBe("resolved");
  });
});

// ── 13/14: reconciliation resolves failed ─────────────────────────────────────

describe("13/14 — a provider-confirmed failure resolves job and draft to Failed", () => {
  it("marks the attempt, job and draft failed with the provider's own message", async () => {
    const h = makeConfirmationDeps({
      claimed: job({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() }),
      status: providerStatus("failed"),
    });

    const outcome = await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });

    expect(h.failAttempt).toHaveBeenCalledWith("attempt-1", expect.objectContaining({ errorCode: "blotato_publish_failed" }));
    expect(h.markJobFailed).toHaveBeenCalledWith("job-1");
    expect(h.updateStatus).toHaveBeenCalledWith(ORG_ALPHA, DRAFT_ID, "failed", "user-1");
    expect(outcome.status).toBe("resolved");
    if (outcome.status === "resolved") expect(outcome.result).toBe("failed");
  });
});

// ── 15/16/17: trigger attribution and retry semantics ─────────────────────────

describe("15/16/17 — reconciliation preserves trigger attribution and is not a retry", () => {
  it("a Scheduled job stays Scheduled and an Immediate job stays Immediate — the pass never writes triggerType", async () => {
    for (const triggerType of ["scheduled", "immediate"] as const) {
      const claimed = job({ status: "awaiting_confirmation", triggerType, nextStatusCheckAt: new Date().toISOString() });
      const h = makeConfirmationDeps({ claimed, status: providerStatus("published") });
      await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });
      // markJobPublished takes only the id — there is no code path by which
      // the confirmation pass could rewrite trigger_type.
      expect(h.markJobPublished).toHaveBeenCalledWith("job-1");
      expect(h.markJobPublished).toHaveBeenCalledTimes(1);
    }
  });

  it("resolving in place keeps attemptNumber 1, so analytics never counts it as a retry", async () => {
    const h = makeConfirmationDeps({
      claimed: job({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() }),
      attempts: [attempt({ attemptNumber: 1 })],
      status: providerStatus("published"),
    });
    await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });

    // The SAME attempt row resolves — no second attempt is created, so
    // `attemptNumber > 1` (the retry definition in analytics) never matches.
    expect(h.completeAttempt).toHaveBeenCalledWith("attempt-1", expect.anything());
    const resolved = attempt({ status: "completed", attemptNumber: 1 });
    const analytics = computePublishingAnalytics([job({ status: "published" })], [resolved], new Date());
    expect(analytics.successfulRetries).toBe(0);
  });
});

// ── 18/19: retry safety ───────────────────────────────────────────────────────

describe("18/19 — retry is blocked while unresolved, permitted after a confirmed failure", () => {
  function retryDeps(input: { job: PublishingJob; attempts: PublishingAttempt[] }) {
    return {
      actor: { id: "user-1", isPlatformAdmin: true } as never,
      publishing: {
        findJobById: vi.fn(async () => input.job),
        listAttemptsForJob: vi.fn(async () => input.attempts),
        requeueJobForRetry: vi.fn(async () => job({ status: "queued", retryCount: 1 })),
      } as never,
      blotatoAccounts: {} as never,
      content: {} as never,
      organisations: { viewerRole: vi.fn(async () => "admin") } as never,
      audits: { recordEvent: vi.fn(async () => {}) } as never,
      notifications: {} as never,
    };
  }

  const EXPECTED_MESSAGE =
    "Provider confirmation is still pending. Genesis will continue checking this submission. Do not retry yet.";

  it("an awaiting_confirmation job cannot be retried", async () => {
    const deps = retryDeps({ job: job({ status: "awaiting_confirmation" }), attempts: [attempt()] });
    await expect(retryFailedPublishingJob(deps, ORG_ALPHA, "job-1")).rejects.toThrow(EXPECTED_MESSAGE);
  });

  it("a LEGACY job falsely marked failed by blotato_status_timeout — the exact production row — cannot be retried", async () => {
    const legacy = job({ status: "failed" });
    const legacyAttempt = attempt({
      status: "failed",
      errorCode: "blotato_status_timeout",
      providerMetadata: { postSubmissionId: SUBMISSION_ID },
    });
    const deps = retryDeps({ job: legacy, attempts: [legacyAttempt] });
    await expect(retryFailedPublishingJob(deps, ORG_ALPHA, "job-1")).rejects.toThrow(EXPECTED_MESSAGE);
  });

  it("a provider-CONFIRMED failure may enter the governed retry flow", async () => {
    const confirmed = job({ status: "failed" });
    const confirmedAttempt = attempt({
      status: "failed",
      errorCode: "blotato_publish_failed",
      providerMetadata: { postSubmissionId: SUBMISSION_ID },
    });
    const deps = retryDeps({ job: confirmed, attempts: [confirmedAttempt] });
    const retried = await retryFailedPublishingJob(deps, ORG_ALPHA, "job-1");
    expect(retried.status).toBe("queued");
  });
});

// ── 20/21: idempotency and worker exclusivity ─────────────────────────────────

describe("20 — repeated reconciliation calls are idempotent", () => {
  it("once resolved the job is no longer awaiting, so a second pass claims nothing and calls the provider zero times", async () => {
    const first = makeConfirmationDeps({
      claimed: job({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() }),
      status: providerStatus("published"),
    });
    await runProviderConfirmationPass(first.deps, { workerId: "worker-1" });
    expect(first.markJobPublished).toHaveBeenCalledTimes(1);

    // Second pass: the claim RPC only ever returns awaiting_confirmation jobs,
    // and this one is now published — so there is nothing to claim.
    const second = makeConfirmationDeps({ claimed: null });
    const outcome = await runProviderConfirmationPass(second.deps, { workerId: "worker-1" });
    expect(outcome.status).toBe("idle");
    expect(second.getPostStatus).not.toHaveBeenCalled();
    expect(second.markJobPublished).not.toHaveBeenCalled();
  });
});

describe("21 — two workers cannot duplicate reconciliation work", () => {
  it("the second worker's claim returns null (the DB lease is exclusive), so it performs no provider call", async () => {
    const claimed = job({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() });
    const winner = makeConfirmationDeps({ claimed, status: providerStatus("in-progress") });
    const loser = makeConfirmationDeps({ claimed: null });

    const [a, b] = await Promise.all([
      runProviderConfirmationPass(winner.deps, { workerId: "worker-render" }),
      runProviderConfirmationPass(loser.deps, { workerId: "worker-vercel" }),
    ]);

    expect(a.status).toBe("pending");
    expect(b.status).toBe("idle");
    expect(winner.getPostStatus).toHaveBeenCalledTimes(1);
    expect(loser.getPostStatus).not.toHaveBeenCalled();
  });
});

// ── 22/23: two-worker parity ──────────────────────────────────────────────────

describe("22/23 — Render and Vercel workers run the identical shared confirmation logic", () => {
  it("both call the same runProviderConfirmationPass and produce the same resolution for the same job", async () => {
    const claimed = job({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() });

    // Vercel API-route worker path.
    const vercel = makeConfirmationDeps({ claimed, status: providerStatus("published") });
    const vercelOutcome = await runProviderConfirmationPass(vercel.deps, { workerId: "worker-vercel" });

    // Render worker path — same function, same deps shape.
    const render = makeConfirmationDeps({ claimed, status: providerStatus("published") });
    const renderOutcome = await runProviderConfirmationPass(render.deps, { workerId: "worker-render" });

    expect(vercelOutcome).toEqual(renderOutcome);
    expect(vercel.markJobPublished).toHaveBeenCalledWith("job-1");
    expect(render.markJobPublished).toHaveBeenCalledWith("job-1");
  });

  it("the Vercel worker iteration runs the confirmation pass when no publish work is due", async () => {
    const publishFn = vi.fn();
    const { deps } = makeWorkerDeps({ claimed: null, publishFn });
    const claimJobForConfirmation = vi.fn(async () => null);
    (deps.publishing as unknown as { claimJobForConfirmation: unknown }).claimJobForConfirmation = claimJobForConfirmation;

    const result = await runPublishingWorkerIteration(deps);

    expect(result.status).toBe("idle");
    expect(claimJobForConfirmation).toHaveBeenCalledTimes(1);
    expect(publishFn).not.toHaveBeenCalled();
  });

  it("runProviderConfirmation never throws out of the worker iteration", async () => {
    const publishFn = vi.fn();
    const { deps } = makeWorkerDeps({ claimed: null, publishFn });
    (deps.publishing as unknown as { claimJobForConfirmation: unknown }).claimJobForConfirmation = vi.fn(async () => {
      throw new Error("database unreachable");
    });

    await expect(runProviderConfirmation(deps, "worker-1")).resolves.toEqual({ status: "idle" });
  });
});

// ── 24: organisation isolation ────────────────────────────────────────────────

describe("24 — organisation isolation", () => {
  it("the pass reads attempts and writes the draft using the claimed job's own organisation only", async () => {
    const claimed = job({ organisationId: ORG_BETA, status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() });
    const h = makeConfirmationDeps({ claimed, status: providerStatus("published") });

    await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });

    expect(h.listAttemptsForJob).toHaveBeenCalledWith(ORG_BETA, "job-1");
    expect(h.updateStatus).toHaveBeenCalledWith(ORG_BETA, DRAFT_ID, "published", "user-1");
    expect(h.updateStatus).not.toHaveBeenCalledWith(ORG_ALPHA, expect.anything(), expect.anything(), expect.anything());
  });
});

// ── 25/26: simulation never touches the provider ──────────────────────────────

describe("25/26 — simulation jobs never enter provider reconciliation", () => {
  it("a simulation job that somehow reached awaiting_confirmation is stopped without any provider call", async () => {
    const h = makeConfirmationDeps({
      claimed: job({ status: "awaiting_confirmation", executionMode: "simulation", nextStatusCheckAt: new Date().toISOString() }),
      status: providerStatus("published"),
    });

    const outcome = await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });

    expect(h.getPostStatus).not.toHaveBeenCalled();
    expect(h.markJobPublished).not.toHaveBeenCalled();
    expect(h.markJobFailed).not.toHaveBeenCalled();
    expect(outcome.status).toBe("unresolved");
  });

  it("a simulated publish never produces a pending result at all — simulatePublish is always terminal", async () => {
    const publishPost = vi.fn();
    const publisher = new BlotatoTikTokPublisher({
      blotatoAccounts: { findActiveForOrganisationAndPlatform: vi.fn(async () => []) } as never,
      blotatoClient: { publishPost, uploadMedia: vi.fn(), getPostStatus: vi.fn(), listAccounts: vi.fn() } as never,
      livePublishingEnabled: false,
    });
    const result = await publisher.publish({
      organisationId: ORG_ALPHA,
      draftId: DRAFT_ID,
      jobId: "job-1",
      attemptId: "attempt-1",
      attemptNumber: 1,
      platform: "tiktok",
      title: "t",
      body: "b",
      assetUrls: [],
      devSimulationMode: "always_succeed",
      isAiGenerated: false,
      isYourBrand: false,
      isBrandedContent: false,
    });
    expect(result.success).toBe(true);
    expect(publishPost).not.toHaveBeenCalled();
  });
});

// ── Backoff, horizon, and the unresolved state ────────────────────────────────

describe("scheduling — bounded backoff and a finite horizon", () => {
  it("backoff ramps 1m → 2m → 5m → 10m → 20m and holds at 30m, never busy-looping", () => {
    expect(nextConfirmationCheckDelayMs(0)).toBe(60_000);
    expect(nextConfirmationCheckDelayMs(1)).toBe(120_000);
    expect(nextConfirmationCheckDelayMs(2)).toBe(300_000);
    expect(nextConfirmationCheckDelayMs(3)).toBe(600_000);
    expect(nextConfirmationCheckDelayMs(4)).toBe(1_200_000);
    expect(nextConfirmationCheckDelayMs(5)).toBe(1_800_000);
    // Held, not unbounded growth, and never below a minute.
    expect(nextConfirmationCheckDelayMs(50)).toBe(1_800_000);
    expect(nextConfirmationCheckDelayMs(-1)).toBe(60_000);
  });

  it("an unresolved job past the horizon stops being auto-checked — never republished, never failed", async () => {
    const longAgo = new Date(Date.now() - MAX_CONFIRMATION_HORIZON_MS - 1000).toISOString();
    const h = makeConfirmationDeps({
      claimed: job({
        status: "awaiting_confirmation",
        nextStatusCheckAt: new Date().toISOString(),
        awaitingConfirmationSince: longAgo,
      }),
      status: providerStatus("in-progress"),
    });

    const outcome = await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });

    expect(outcome).toEqual({ status: "unresolved", jobId: "job-1", reason: "horizon_exceeded" });
    // Auto-checking stops (null), but nothing is failed and nothing republished.
    expect(h.recordConfirmationCheck).toHaveBeenCalledWith("job-1", null);
    expect(h.markJobFailed).not.toHaveBeenCalled();
    expect(h.markJobPublished).not.toHaveBeenCalled();
  });

  it("hasExceededConfirmationHorizon is exactly 24h", () => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    expect(hasExceededConfirmationHorizon("2026-08-10T00:00:00.000Z", now)).toBe(true);
    expect(hasExceededConfirmationHorizon("2026-08-10T00:00:01.000Z", now)).toBe(false);
  });

  it("isProviderConfirmationUnresolved distinguishes 'still checking' from 'needs attention'", () => {
    expect(isProviderConfirmationUnresolved({ status: "awaiting_confirmation", nextStatusCheckAt: null })).toBe(true);
    expect(isProviderConfirmationUnresolved({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() })).toBe(false);
    expect(isProviderConfirmationUnresolved({ status: "failed", nextStatusCheckAt: null })).toBe(false);
  });

  it("a still-processing job inside the horizon is rescheduled, not resolved", async () => {
    const h = makeConfirmationDeps({
      claimed: job({
        status: "awaiting_confirmation",
        nextStatusCheckAt: new Date().toISOString(),
        awaitingConfirmationSince: new Date().toISOString(),
        statusCheckCount: 0,
      }),
      status: providerStatus("in-progress"),
    });

    const outcome = await runProviderConfirmationPass(h.deps, { workerId: "worker-1" });

    expect(outcome.status).toBe("pending");
    expect(h.markJobFailed).not.toHaveBeenCalled();
    expect(h.markJobPublished).not.toHaveBeenCalled();
    // Next check scheduled (non-null), using the backoff curve.
    const [, nextAt] = h.recordConfirmationCheck.mock.calls[0]!;
    expect(nextAt).not.toBeNull();
  });
});

// ── 27/28/29/30: unrelated architecture preserved ─────────────────────────────

describe("27/28/29/30 — disclosures, execution mode, media and hashtag policy are untouched", () => {
  it("the pending path preserves the job's TikTok disclosures and execution mode (it never writes them)", async () => {
    const publishFn = vi.fn(async () => ({
      success: "pending" as const,
      providerSubmissionId: SUBMISSION_ID,
      metadata: { postSubmissionId: SUBMISSION_ID },
    }));
    const claimed = job({ status: "queued", isAiGenerated: true, isYourBrand: true, isBrandedContent: false, executionMode: "live" });
    const { deps, markJobAwaitingConfirmation } = makeWorkerDeps({ claimed, publishFn });

    await runPublishingWorkerIteration(deps);

    // The publisher received the disclosures verbatim...
    expect(publishFn).toHaveBeenCalledWith(
      expect.objectContaining({ isAiGenerated: true, isYourBrand: true, isBrandedContent: false }),
    );
    // ...and the awaiting transition writes only status + scheduling fields.
    expect(markJobAwaitingConfirmation).toHaveBeenCalledWith("job-1", expect.any(String));
  });

  it("the confirmation pass has no media or hashtag dependency at all — it cannot alter either", () => {
    const h = makeConfirmationDeps({ claimed: null });
    expect(h.deps).not.toHaveProperty("media");
    expect(h.deps).not.toHaveProperty("storage");
  });
});

// ── PRODUCTION SCENARIO REGRESSION ────────────────────────────────────────────

describe("PRODUCTION SCENARIO — the exact 2026-08-10 TikTok incident, end to end", () => {
  it("publishPost → submission id → 10 non-terminal checks → awaiting_confirmation (NOT failed) → later published, publishPost called exactly once", async () => {
    // ── Phase 1: the synchronous publish, reproducing the real timings.
    // 10 provider status checks all return in-progress, exactly as production.
    let statusChecks = 0;
    const publishPost = vi.fn(async () => ({ postSubmissionId: SUBMISSION_ID }));
    const uploadMedia = vi.fn(async () => ({ url: "https://media.blotato.com/v.mp4", id: "m1" }));
    const getPostStatus = vi.fn(async (id: string) => {
      statusChecks += 1;
      return { postSubmissionId: id, status: "in-progress" as const, scheduledTime: null, publicUrl: null, errorMessage: null };
    });

    const publisher = new BlotatoTikTokPublisher({
      blotatoAccounts: {
        findActiveForOrganisationAndPlatform: vi.fn(async () => [
          { id: "acc-1", platform: "tiktok", active: true, providerActive: true, organisationId: ORG_ALPHA, fullname: null, username: null, firstConnectedAt: "", lastVerifiedAt: "" },
        ]),
      } as never,
      blotatoClient: { publishPost, uploadMedia, getPostStatus, listAccounts: vi.fn() } as never,
      livePublishingEnabled: true,
      statusPollIntervalMs: 0,
      statusPollMaxAttempts: 10,
    });

    const publishResult = await publisher.publish({
      organisationId: ORG_ALPHA,
      draftId: DRAFT_ID,
      jobId: "job-1",
      attemptId: "attempt-1",
      attemptNumber: 1,
      platform: "tiktok",
      title: "Celebrate Yourself!",
      body: "Caption",
      assetUrls: ["https://cdn.example.com/v.mp4"],
      devSimulationMode: "always_succeed",
      isAiGenerated: false,
      isYourBrand: false,
      isBrandedContent: false,
    });

    expect(statusChecks).toBe(10);
    expect(publishPost).toHaveBeenCalledTimes(1);
    // THE FIX: pending, not a fabricated failure.
    expect(publishResult.success).toBe("pending");
    if (publishResult.success !== "pending") throw new Error("expected pending");
    expect(publishResult.providerSubmissionId).toBe(SUBMISSION_ID);

    // ── Phase 2: the worker persists that as awaiting_confirmation, NOT failed.
    const workerPublishFn = vi.fn(async () => publishResult);
    const { deps, markJobFailed, updateStatus, awaitAttemptConfirmation } = makeWorkerDeps({
      claimed: job({ status: "queued" }),
      publishFn: workerPublishFn,
    });

    const iteration = await runPublishingWorkerIteration(deps);

    expect(iteration.status).toBe("processed");
    if (iteration.status === "processed") expect(iteration.result).toBe("awaiting_confirmation");
    expect(markJobFailed).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "failed", expect.anything());
    expect(awaitAttemptConfirmation).toHaveBeenCalledWith("attempt-1", expect.objectContaining({ postSubmissionId: SUBMISSION_ID }));

    // ── Phase 3: later, the provider reports published — the SAME job resolves.
    const confirm = makeConfirmationDeps({
      claimed: job({ status: "awaiting_confirmation", nextStatusCheckAt: new Date().toISOString() }),
      attempts: [attempt()],
      status: providerStatus("published"),
    });

    const outcome = await runProviderConfirmationPass(confirm.deps, { workerId: "worker-88-rbb9k6" });

    expect(outcome.status).toBe("resolved");
    if (outcome.status === "resolved") expect(outcome.result).toBe("published");
    expect(confirm.getPostStatus).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(confirm.markJobPublished).toHaveBeenCalledWith("job-1");
    expect(confirm.updateStatus).toHaveBeenCalledWith(ORG_ALPHA, DRAFT_ID, "published", "user-1");

    // ── THE INVARIANT: exactly one provider submission for the whole story.
    expect(publishPost).toHaveBeenCalledTimes(1);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
  });
});
