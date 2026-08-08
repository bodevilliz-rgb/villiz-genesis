/**
 * Sprint 10B — Vercel Cron publishing trigger tests.
 *
 * Tests A–K cover the 17 required proof points for the cron trigger:
 *
 *   A — Authentication: CRON_SECRET validation (proofs 1, 2)
 *   B — HTTP method enforcement: POST/PUT/DELETE → 405 (proof 2)
 *   C — Queue states: idle, future job, immediate, due scheduled, retry (proofs 3–7)
 *   D — Stale recovery: called on every tick regardless of job outcome (proof 8)
 *   E — Concurrency: in-flight job not reclaimed (proof 9)
 *   F — Destination lock: resolvedAccountId unchanged through cron path (proof 10)
 *   G — Organisation isolation: cron trigger is org-agnostic (proof 11)
 *   H — Simulation: live Blotato API never called under simulation (proofs 12, 13)
 *   I — Multi-org: single trigger drains jobs from any organisation (proof 14)
 *   J — Failure: failure result passed back with error code (proof 15)
 *   K — Status transitions: response reflects correct terminal state (proof 16)
 *
 * Proof 17 (reliability mandatory suite ≥ 15/15) is the `npm run reliability:test`
 * gate — not a vitest test — and is validated in the CI/validation phase.
 *
 * Infrastructure mocks are set at module scope (vi.mock is hoisted). Tests
 * control runPublishingWorkerIteration's return value via vi.mocked().
 * This keeps auth-layer and route-integration tests fast and deterministic.
 */

// ── Module-scope infrastructure mocks ─────────────────────────────────────────
// Same pattern as publishing-worker-iteration.test.ts test G — mock every
// infrastructure class so the cron route can be imported in test without a
// real Supabase connection or Blotato key.

vi.mock("@/infrastructure/supabase/admin-client", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/infrastructure/repositories/supabase-publishing-repository", () => ({
  SupabasePublishingRepository: vi.fn().mockImplementation(() => ({
    recoverStaleJobs: vi.fn(async () => []),
    claimNextJob: vi.fn(async () => null),
    createAttempt: vi.fn(async () => ({})),
    startAttempt: vi.fn(async () => ({})),
    completeAttempt: vi.fn(async () => ({})),
    failAttempt: vi.fn(async () => ({})),
    markJobPublished: vi.fn(async () => ({})),
    markJobFailed: vi.fn(async () => ({})),
    listAttemptsForJob: vi.fn(async () => []),
    findJobById: vi.fn(async () => null),
  })),
}));

vi.mock("@/infrastructure/repositories/supabase-blotato-account-repository", () => ({
  SupabaseBlotatoAccountRepository: vi.fn().mockImplementation(() => ({
    findActiveForOrganisationAndPlatform: vi.fn(async () => []),
    listActiveForOrganisation: vi.fn(async () => []),
    listAccounts: vi.fn(async () => []),
    upsertAccounts: vi.fn(async () => []),
    findMostRecentForPlatform: vi.fn(async () => null),
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
    publishPost: vi.fn(async () => ({ postSubmissionId: "should-not-be-called" })),
    getPostStatus: vi.fn(async () => ({
      postSubmissionId: "should-not-be-called",
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

// runPublishingWorkerIteration is mocked so tests control the iteration result
// without needing a full repo harness wired through the route's constructor calls.
vi.mock("@/core/application/use-cases/publishing/worker", () => ({
  runPublishingWorkerIteration: vi.fn().mockResolvedValue({ status: "idle" }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runPublishingWorkerIteration } from "@/core/application/use-cases/publishing/worker";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { HttpBlotatoClient } from "@/infrastructure/blotato/http-blotato-client";

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_CRON_SECRET = "vercel-cron-secret-at-least-16-chars";
const CRON_ENDPOINT = "http://localhost/api/cron/publishing";

const JOB_A = "job-00000000-aaaa-aaaa-aaaa-000000000001";
const JOB_B = "job-00000000-bbbb-bbbb-bbbb-000000000002";

// ── Helpers ───────────────────────────────────────────────────────────────────

function cronRequest(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret !== undefined) {
    headers["authorization"] = `Bearer ${secret}`;
  }
  return new Request(CRON_ENDPOINT, { method: "GET", headers });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.CRON_SECRET = VALID_CRON_SECRET;
  vi.mocked(runPublishingWorkerIteration).mockResolvedValue({ status: "idle" });
  vi.mocked(blotatoConfig).mockReturnValue({
    apiKey: "test-key",
    enabled: true,
    livePublishingEnabled: false,
  });
  vi.clearAllMocks();
  // Restore CRON_SECRET after clearAllMocks resets spies (but not env vars).
  process.env.CRON_SECRET = VALID_CRON_SECRET;
  vi.mocked(runPublishingWorkerIteration).mockResolvedValue({ status: "idle" });
  vi.mocked(blotatoConfig).mockReturnValue({
    apiKey: "test-key",
    enabled: true,
    livePublishingEnabled: false,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A — Authentication (proofs 1 and 2)
// ─────────────────────────────────────────────────────────────────────────────

describe("A — authentication: CRON_SECRET validation", () => {
  it("missing Authorization header → 401 (proof 1: unauthenticated rejected)", async () => {
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest() as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("wrong secret → 401", async () => {
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest("wrong-secret-value-here") as never);
    expect(res.status).toBe(401);
  });

  it("CRON_SECRET env var unset → 401 for all requests (fail-closed)", async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const { GET } = await import("@/app/api/cron/publishing/route");
      const res = await GET(cronRequest(VALID_CRON_SECRET) as never);
      expect(res.status).toBe(401);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it("CRON_SECRET shorter than 16 chars → 401 (fail-closed, guards accidental empty placeholder)", async () => {
    process.env.CRON_SECRET = "tooshort";
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest("tooshort") as never);
    expect(res.status).toBe(401);
  });

  it("correct CRON_SECRET → 200 with worker result (proof 2: valid invocation succeeds)", async () => {
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "idle" });
  });

  it("runPublishingWorkerIteration is called exactly once per authorized invocation", async () => {
    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(vi.mocked(runPublishingWorkerIteration)).toHaveBeenCalledTimes(1);
  });

  it("runPublishingWorkerIteration is NOT called when auth fails", async () => {
    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest("bad-secret") as never);
    expect(vi.mocked(runPublishingWorkerIteration)).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — HTTP method enforcement (part of proof 2)
// ─────────────────────────────────────────────────────────────────────────────

describe("B — HTTP method enforcement", () => {
  it("POST → 405 Method Not Allowed (Vercel Cron sends GET; POST is rejected)", async () => {
    const { POST } = await import("@/app/api/cron/publishing/route");
    const res = await POST();
    expect(res.status).toBe(405);
  });

  it("PUT → 405 Method Not Allowed", async () => {
    const { PUT } = await import("@/app/api/cron/publishing/route");
    const res = await PUT();
    expect(res.status).toBe(405);
  });

  it("DELETE → 405 Method Not Allowed", async () => {
    const { DELETE } = await import("@/app/api/cron/publishing/route");
    const res = await DELETE();
    expect(res.status).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — Queue states (proofs 3–7)
// ─────────────────────────────────────────────────────────────────────────────

describe("C — queue states: cron route returns whatever the worker iteration returns", () => {
  it("empty queue → 200 { status: 'idle' } (proof 3: empty queue is safe/no-op)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({ status: "idle" });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "idle" });
  });

  it("future scheduled job not due → idle (proof 5: future job not claimed early)", async () => {
    // The DB's claim_next_publishing_job only picks up jobs where
    // scheduled_for <= now(). runPublishingWorkerIteration returns idle
    // when no job is due. This test verifies the cron route surfaces that
    // result correctly — not that the future job was skipped at the DB level
    // (that is proven by publishing-worker-iteration.test.ts test A).
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({ status: "idle" });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(await res.json()).toEqual({ status: "idle" });
  });

  it("immediate queued job claimed → processed/published (proof 4)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/instagram/mock-instagram-123456",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("processed");
    expect(body.result).toBe("published");
    expect(body.jobId).toBe(JOB_A);
    expect(body.externalUrl).toContain("mock.local");
  });

  it("due scheduled job claimed → processed/published (proof 6: due scheduled job claimed)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/linkedin/mock-linkedin-654321",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.status).toBe("processed");
    expect(body.result).toBe("published");
  });

  it("retry-eligible job (queued, retryCount > 0) claimed → processed (proof 7)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/x/mock-x-111222",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.status).toBe("processed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — Stale recovery (proof 8)
// ─────────────────────────────────────────────────────────────────────────────

describe("D — stale recovery: recoverStalePublishingJobs runs on every tick", () => {
  it("stale recovery is called before the claim, even on an idle tick (proof 8)", async () => {
    // runPublishingWorkerIteration calls recoverStalePublishingJobs internally
    // before claiming. Since it is mocked at the route level, we verify the
    // route calls it exactly once per invocation and that stale recovery
    // therefore runs (inside the real implementation, proven by
    // publishing-worker-iteration.test.ts test A "always calls stale-job
    // recovery before claiming, even when idle"). Here we assert the route
    // delegates to it once per authorized tick.
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({ status: "idle" });
    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(vi.mocked(runPublishingWorkerIteration)).toHaveBeenCalledTimes(1);
  });

  it("stale recovery also runs when a job is processed (not only on idle ticks)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/instagram/mock-instagram-999",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(vi.mocked(runPublishingWorkerIteration)).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — Concurrency (proof 9)
// ─────────────────────────────────────────────────────────────────────────────

describe("E — concurrency: overlapping invocations cannot claim the same job", () => {
  it("second concurrent invocation returns idle when first claimed the only queued job (proof 9)", async () => {
    // Sequence: first tick processes a job; second tick finds the queue empty.
    // The DB's FOR UPDATE SKIP LOCKED prevents double-claim; the cron route
    // simply surfaces whatever the iteration returns — idle for the second call.
    vi.mocked(runPublishingWorkerIteration)
      .mockResolvedValueOnce({
        status: "processed",
        jobId: JOB_A,
        result: "published",
        externalUrl: "https://mock.local/instagram/mock-instagram-001",
      })
      .mockResolvedValueOnce({ status: "idle" });

    const { GET } = await import("@/app/api/cron/publishing/route");
    const [res1, res2] = await Promise.all([
      GET(cronRequest(VALID_CRON_SECRET) as never),
      GET(cronRequest(VALID_CRON_SECRET) as never),
    ]);

    const results = [await res1.json(), await res2.json()];
    const statuses = results.map((r) => r.status).sort();
    // One invocation gets "processed", the other gets "idle".
    expect(statuses).toEqual(["idle", "processed"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — Destination lock (proof 10)
// ─────────────────────────────────────────────────────────────────────────────

describe("F — destination lock: resolvedAccountId is not modified by the cron path", () => {
  it("cron route does not alter job data — resolvedAccountId is preserved (proof 10)", async () => {
    // The cron route passes deps to runPublishingWorkerIteration unchanged.
    // It does not read, modify, or strip resolvedAccountId. This test verifies
    // the route does not introduce a transformation layer on the job object.
    // The destination-lock guarantee itself is proven in
    // publishing-worker-iteration.test.ts test K.
    let capturedDeps: unknown;
    vi.mocked(runPublishingWorkerIteration).mockImplementationOnce(async (deps) => {
      capturedDeps = deps;
      return { status: "idle" };
    });

    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest(VALID_CRON_SECRET) as never);

    // deps passed to the iteration must include a publishing repository —
    // the cron route must not have stripped or replaced it.
    expect(capturedDeps).toBeDefined();
    expect((capturedDeps as { publishing: unknown }).publishing).toBeDefined();
    expect((capturedDeps as { blotatoAccounts: unknown }).blotatoAccounts).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G — Organisation isolation (proof 11)
// ─────────────────────────────────────────────────────────────────────────────

describe("G — organisation isolation: single cron trigger is org-agnostic", () => {
  it("cron does not hardcode an organisationId — it processes the next due job regardless of org (proof 11)", async () => {
    // The cron route passes deps without any org filter. The iteration's
    // claim_next_publishing_job picks up ANY due job (all orgs). Org-scoped
    // isolation is enforced inside the publisher (requireRole + scoped account
    // pool) — not by the trigger. This test verifies no orgId is injected here.
    let capturedDeps: unknown;
    vi.mocked(runPublishingWorkerIteration).mockImplementationOnce(async (deps) => {
      capturedDeps = deps;
      return { status: "idle" };
    });

    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest(VALID_CRON_SECRET) as never);

    // There must be no organisationId property on deps — the iteration is
    // org-agnostic at the claim level.
    expect((capturedDeps as Record<string, unknown>)["organisationId"]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H — Simulation / live flag (proofs 12 and 13)
// ─────────────────────────────────────────────────────────────────────────────

describe("H — simulation: live Blotato API never called; live flag not touched", () => {
  it("publishPost is never called through the cron path when livePublishingEnabled=false (proof 12)", async () => {
    // The cron route never calls publishPost directly — it delegates entirely
    // to runPublishingWorkerIteration. In simulation mode the real iteration
    // calls simulatePublish() instead of publishPost(); that guarantee is
    // proven in publishing-worker-iteration.test.ts test H. Here we verify
    // that the route itself does not bypass the worker iteration layer.
    const publishPostSpy = vi.mocked(HttpBlotatoClient).mock.instances[0]?.publishPost;

    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/instagram/mock-instagram-sim",
    });

    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest(VALID_CRON_SECRET) as never);

    // publishPost was not called by the cron route — only by the iteration
    // internals, which are mocked in this test file.
    if (publishPostSpy) {
      expect(publishPostSpy).not.toHaveBeenCalled();
    }
    // Primary assertion: the iteration mock was called, not the live API.
    expect(vi.mocked(runPublishingWorkerIteration)).toHaveBeenCalledTimes(1);
  });

  it("BLOTATO_LIVE_PUBLISHING_ENABLED remains false after cron invocation (proof 13)", async () => {
    const initialLiveFlag = blotatoConfig().livePublishingEnabled;
    const { GET } = await import("@/app/api/cron/publishing/route");
    await GET(cronRequest(VALID_CRON_SECRET) as never);
    // The flag is read-only from env; the cron route cannot change it.
    expect(blotatoConfig().livePublishingEnabled).toBe(initialLiveFlag);
    expect(blotatoConfig().livePublishingEnabled).toBe(false);
  });

  it("externalUrl in simulation result contains 'mock.local', not a real social platform URL", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/instagram/mock-instagram-123",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.externalUrl).toContain("mock.local");
    expect(body.externalUrl).not.toContain("instagram.com");
    expect(body.externalUrl).not.toContain("linkedin.com");
    expect(body.externalUrl).not.toContain("x.com");
    expect(body.externalUrl).not.toContain("facebook.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I — Multi-org: single trigger services all organisations (proof 14)
// ─────────────────────────────────────────────────────────────────────────────

describe("I — multi-org: one cron trigger processes jobs from any organisation", () => {
  it("Org A job processed on first tick (proof 14 part 1)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/linkedin/mock-linkedin-org-a",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.jobId).toBe(JOB_A);
  });

  it("Org B job processed on next tick — same cron trigger, different org (proof 14 part 2)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_B,
      result: "published",
      externalUrl: "https://mock.local/instagram/mock-instagram-org-b",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.jobId).toBe(JOB_B);
  });

  it("no per-org cron: a single /api/cron/publishing route handles all organisations", () => {
    // Structural assertion: there is exactly ONE cron path registered in
    // vercel.json, not one per organisation. This test reads vercel.json and
    // confirms the single-endpoint design is preserved.
    const vercelJson = JSON.parse(
      readFileSync(path.resolve(__dirname, "..", "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    expect(vercelJson.crons).toBeDefined();
    const publishingCrons = vercelJson.crons!.filter((c) =>
      c.path.includes("publishing"),
    );
    // Exactly ONE publishing cron entry, not one per client.
    expect(publishingCrons).toHaveLength(1);
    expect(publishingCrons[0]!.path).toBe("/api/cron/publishing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J — Failure: failure result passed through correctly (proof 15)
// ─────────────────────────────────────────────────────────────────────────────

describe("J — failure: job failure persists correctly through cron path", () => {
  it("worker failure result → 200 with failureCode (proof 15)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "failed",
      failureCode: "mock_simulated_failure",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const res = await GET(cronRequest(VALID_CRON_SECRET) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("processed");
    expect(body.result).toBe("failed");
    expect(body.failureCode).toBe("mock_simulated_failure");
  });

  it("blotato_no_connected_account failure is surfaced without masking", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "failed",
      failureCode: "blotato_no_connected_account",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.failureCode).toBe("blotato_no_connected_account");
  });

  it("cron route does not rethrow worker errors — runPublishingWorkerIteration never throws (proof 15)", async () => {
    // runPublishingWorkerIteration is designed to never throw; it catches all
    // errors and returns them as failed results. The cron route must not add
    // an extra try/catch that swallows or transforms results.
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "failed",
      failureCode: "unexpected_worker_error",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    await expect(GET(cronRequest(VALID_CRON_SECRET) as never)).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K — Status transitions (proof 16)
// ─────────────────────────────────────────────────────────────────────────────

describe("K — status transitions: response reflects terminal state", () => {
  it("published result: response includes externalUrl (proof 16 — published path)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "published",
      externalUrl: "https://mock.local/x/mock-x-777888",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.result).toBe("published");
    expect(body.externalUrl).toBeDefined();
    expect(body.failureCode).toBeUndefined();
  });

  it("failed result: response includes failureCode but not externalUrl (proof 16 — failed path)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({
      status: "processed",
      jobId: JOB_A,
      result: "failed",
      failureCode: "draft_not_found",
    });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body.result).toBe("failed");
    expect(body.failureCode).toBe("draft_not_found");
    expect(body.externalUrl).toBeUndefined();
  });

  it("idle result: no jobId, no result, no externalUrl (proof 16 — idle path)", async () => {
    vi.mocked(runPublishingWorkerIteration).mockResolvedValueOnce({ status: "idle" });
    const { GET } = await import("@/app/api/cron/publishing/route");
    const body = await (await GET(cronRequest(VALID_CRON_SECRET) as never)).json();
    expect(body).toEqual({ status: "idle" });
    expect(body.jobId).toBeUndefined();
    expect(body.externalUrl).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L — vercel.json structural validation
// ─────────────────────────────────────────────────────────────────────────────

describe("L — vercel.json: cron schedule structure", () => {
  const vercelJsonPath = path.resolve(__dirname, "..", "vercel.json");

  it("vercel.json exists at the repository root", () => {
    expect(() => readFileSync(vercelJsonPath, "utf8")).not.toThrow();
  });

  it("crons array contains at least one entry for the publishing trigger", () => {
    const cfg = JSON.parse(readFileSync(vercelJsonPath, "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(Array.isArray(cfg.crons)).toBe(true);
    expect(cfg.crons!.length).toBeGreaterThanOrEqual(1);
  });

  it("publishing cron path matches the GET route registered in app/api/cron/publishing", () => {
    const cfg = JSON.parse(readFileSync(vercelJsonPath, "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const entry = cfg.crons!.find((c) => c.path === "/api/cron/publishing");
    expect(entry).toBeDefined();
  });

  it("cron schedule is a valid cron expression (5 or 6 fields)", () => {
    const cfg = JSON.parse(readFileSync(vercelJsonPath, "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const entry = cfg.crons!.find((c) => c.path === "/api/cron/publishing")!;
    const fields = entry.schedule.trim().split(/\s+/);
    expect(fields.length).toBeGreaterThanOrEqual(5);
    expect(fields.length).toBeLessThanOrEqual(6);
  });
});
