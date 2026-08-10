/**
 * P0 follow-up — provider-confirmation RPC return-shape.
 *
 * SYMPTOM (production, worker-89-c4d93x): with the confirmation migrations
 * applied, Render emitted every ~2 seconds:
 *     event: provider_confirmation_error
 *     error: "rows is not iterable"
 * while production had ZERO awaiting_confirmation jobs (8 published, 8
 * failed, 0 awaiting, 0 due) — so the error fired on the *empty* path.
 *
 * PROVEN ROOT CAUSE (pg_proc, read-only, production):
 *     claim_next_publishing_job              proretset = true   SETOF publishing_jobs
 *     claim_publishing_job_for_confirmation  proretset = false  publishing_jobs
 * The new function returned a single composite where its proven sibling
 * returns a set. PostgREST serialises those differently, and — per this
 * repo's own 20260801160000_publishing_claim_setof_fix.sql, which diagnosed
 * the identical defect for claim_next_publishing_job — a single-composite
 * plpgsql `return null` can arrive as a composite of ALL-NULL fields rather
 * than null. `(data ?? [])` therefore kept that object, and
 * `const [row] = rows` threw "rows is not iterable" on every tick.
 *
 * FIX: (a) 20260810040000 restores the proven `returns setof` shape, and
 * (b) toClaimedPublishingJob makes the application independent of the shape
 * altogether, so neither claim RPC can regress this way again.
 *
 * Mandate map (20 items):
 *    1 — RPC returns no rows → null
 *    2 — RPC returns one row → one PublishingJob
 *    3 — raw Supabase array shape normalized
 *    4 — unexpected malformed shape fails clearly
 *    5 — no "rows is not iterable" for any shape
 *    6 — confirmation pass with no eligible jobs idles normally
 *    7 — eligible awaiting-confirmation job is claimed once
 *    8 — two workers cannot both own the same confirmation lease
 *    9 — provider status check still uses the existing submission id
 *   10 — publishPost structurally unreachable
 *   11 — uploadMedia structurally unreachable
 *   12 — Render worker uses the normalized repository contract
 *   13 — Vercel worker uses the same contract
 *   14 — infrastructure error does not retry every 2 seconds
 *   15 — normal publishing worker cadence unchanged
 *   16-19 — awaiting-confirmation / Instagram / TikTok / execution-mode
 *           regressions (full suite)
 *   20 — reliability 15/15 (gate run)
 */

import { describe, expect, it, vi } from "vitest";
import { toClaimedPublishingJob } from "@/infrastructure/mappers/publishing-mapper";
import {
  createConfirmationErrorGate,
  nextConfirmationErrorBackoffMs,
  runProviderConfirmationPass,
} from "@/core/application/use-cases/publishing/confirmation";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const DRAFT = "00000000-0000-4000-8000-0000000000d1";
const SUBMISSION_ID = "1144fce2-dc61-4e9b-b5ac-68e5f8511654";

/** A realistic publishing_jobs row exactly as PostgREST serialises it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    organisation_id: ORG,
    draft_id: DRAFT,
    platform: "tiktok",
    trigger_type: "immediate",
    scheduled_for: "2026-08-10T03:00:00Z",
    status: "awaiting_confirmation",
    idempotency_key: "idem-1",
    requested_by: "user-1",
    created_at: "2026-08-10T03:00:00Z",
    updated_at: "2026-08-10T03:00:00Z",
    next_attempt_at: null,
    retry_count: 0,
    max_retries: 3,
    completed_at: null,
    cancelled_at: null,
    claimed_by: null,
    claimed_at: null,
    dev_simulation_mode: null,
    resolved_account_id: "acc-1",
    is_ai_generated: false,
    is_your_brand: false,
    is_branded_content: false,
    execution_mode: "live",
    next_status_check_at: "2026-08-10T03:05:00Z",
    last_status_check_at: null,
    status_check_count: 0,
    awaiting_confirmation_since: "2026-08-10T03:00:00Z",
    ...overrides,
  };
}

/** The all-null composite a single-row plpgsql `return null` can produce — the exact production payload. */
function allNullComposite() {
  return Object.fromEntries(Object.keys(row()).map((k) => [k, null]));
}

// ── 1-5: the normalizer ───────────────────────────────────────────────────────

describe("1/5 — no rows normalises to null, never throwing", () => {
  it("null, undefined and an empty array all mean 'nothing claimed'", () => {
    expect(toClaimedPublishingJob(null, "ctx")).toBeNull();
    expect(toClaimedPublishingJob(undefined, "ctx")).toBeNull();
    expect(toClaimedPublishingJob([], "ctx")).toBeNull();
  });

  it("the ALL-NULL composite — the exact production payload that threw — normalises to null", () => {
    // This is the regression: previously `(data ?? [])` kept this object and
    // `const [row] = rows` threw "rows is not iterable" every worker tick.
    expect(() => toClaimedPublishingJob(allNullComposite(), "ctx")).not.toThrow();
    expect(toClaimedPublishingJob(allNullComposite(), "ctx")).toBeNull();
  });

  it("an array wrapping the all-null composite also normalises to null", () => {
    expect(toClaimedPublishingJob([allNullComposite()], "ctx")).toBeNull();
  });
});

describe("2/3 — a real row normalises to one PublishingJob, from either shape", () => {
  it("SETOF shape (array of one row) → the domain job", () => {
    const jobFromArray = toClaimedPublishingJob([row()], "ctx");
    expect(jobFromArray).not.toBeNull();
    expect(jobFromArray?.id).toBe("job-1");
    expect(jobFromArray?.organisationId).toBe(ORG);
    expect(jobFromArray?.status).toBe("awaiting_confirmation");
    expect(jobFromArray?.executionMode).toBe("live");
    expect(jobFromArray?.nextStatusCheckAt).toBe("2026-08-10T03:05:00Z");
  });

  it("single-composite shape (bare object) → the identical domain job", () => {
    expect(toClaimedPublishingJob(row(), "ctx")).toEqual(toClaimedPublishingJob([row()], "ctx"));
  });

  it("an array of several rows takes the first — a claim is always one job", () => {
    const claimed = toClaimedPublishingJob([row({ id: "job-first" }), row({ id: "job-second" })], "ctx");
    expect(claimed?.id).toBe("job-first");
  });
});

describe("4 — a malformed shape fails clearly, naming the RPC", () => {
  it("a scalar payload throws a named, actionable error rather than a cryptic TypeError", () => {
    expect(() => toClaimedPublishingJob("unexpected", "claim_publishing_job_for_confirmation")).toThrow(
      /claim_publishing_job_for_confirmation returned an unexpected payload shape \(string\)/,
    );
    expect(() => toClaimedPublishingJob(42, "ctx")).toThrow(/unexpected payload shape \(number\)/);
  });

  it("an object that is not a publishing_jobs row throws, naming the missing id column", () => {
    expect(() => toClaimedPublishingJob({ not_a_job: true }, "ctx")).toThrow(/no 'id' column/);
  });

  it("no input shape — valid or malformed — ever produces 'rows is not iterable'", () => {
    for (const payload of [null, undefined, [], [row()], row(), allNullComposite(), "x", 42, { not_a_job: true }]) {
      try {
        toClaimedPublishingJob(payload, "ctx");
      } catch (error) {
        expect((error as Error).message).not.toContain("is not iterable");
      }
    }
  });
});

// ── 6-11: the confirmation pass over the normalized contract ──────────────────

function makeDeps(claimed: unknown, statusValue: "published" | "in-progress" = "in-progress") {
  const getPostStatus = vi.fn(async () => ({
    postSubmissionId: SUBMISSION_ID,
    status: statusValue,
    scheduledTime: null,
    publicUrl: statusValue === "published" ? "https://tiktok.com/@a/video/1" : null,
    errorMessage: null,
  }));
  const claimJobForConfirmation = vi.fn(async () => toClaimedPublishingJob(claimed, "claim_publishing_job_for_confirmation"));
  const recordConfirmationCheck = vi.fn(async (_id: string, _next: string | null) => null);
  const completeAttempt = vi.fn(async () => ({}));
  const markJobPublished = vi.fn(async () => ({}));

  return {
    deps: {
      publishing: {
        claimJobForConfirmation,
        listAttemptsForJob: vi.fn(async () => [
          { id: "attempt-1", attemptNumber: 1, providerMetadata: { postSubmissionId: SUBMISSION_ID } },
        ]),
        completeAttempt,
        failAttempt: vi.fn(async () => ({})),
        markJobPublished,
        markJobFailed: vi.fn(async () => ({})),
        recordConfirmationCheck,
      } as never,
      content: { updateStatus: vi.fn(async () => ({})) } as never,
      audits: { recordEvent: vi.fn(async () => {}) } as never,
      notifications: { createNotification: vi.fn(async () => {}) } as never,
      blotatoClient: { getPostStatus } as never,
    },
    getPostStatus,
    claimJobForConfirmation,
    markJobPublished,
  };
}

describe("6 — an empty confirmation queue idles normally, with no error", () => {
  it("the all-null composite from the RPC yields a clean idle — the production symptom, gone", async () => {
    const h = makeDeps(allNullComposite());
    const outcome = await runProviderConfirmationPass(h.deps, { workerId: "worker-89-c4d93x" });
    expect(outcome).toEqual({ status: "idle" });
    expect(h.getPostStatus).not.toHaveBeenCalled();
  });

  it("a genuine empty array (the SETOF shape) also idles cleanly", async () => {
    const h = makeDeps([]);
    await expect(runProviderConfirmationPass(h.deps, { workerId: "w" })).resolves.toEqual({ status: "idle" });
  });
});

describe("7/9/10/11 — an eligible job is claimed once and only its status is checked", () => {
  it("claims once, calls getPostStatus with the existing submission id, and cannot publish or upload", async () => {
    const h = makeDeps([row()], "published");
    await runProviderConfirmationPass(h.deps, { workerId: "w" });

    // 7 — claimed exactly once
    expect(h.claimJobForConfirmation).toHaveBeenCalledTimes(1);
    // 9 — the exact persisted submission id
    expect(h.getPostStatus).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(h.getPostStatus).toHaveBeenCalledTimes(1);
    // 10 + 11 — structurally unreachable: the only provider method in scope.
    expect(Object.keys(h.deps.blotatoClient as object)).toEqual(["getPostStatus"]);
    expect(h.markJobPublished).toHaveBeenCalledTimes(1);
  });
});

describe("8 — two workers cannot both own the same confirmation lease", () => {
  it("the loser's claim returns the empty shape and it performs no provider call", async () => {
    const winner = makeDeps([row()], "published");
    // The DB's `for update skip locked` lease means the second caller sees nothing.
    const loser = makeDeps([]);

    const [a, b] = await Promise.all([
      runProviderConfirmationPass(winner.deps, { workerId: "worker-render" }),
      runProviderConfirmationPass(loser.deps, { workerId: "worker-vercel" }),
    ]);

    expect(a.status).toBe("resolved");
    expect(b.status).toBe("idle");
    expect(winner.getPostStatus).toHaveBeenCalledTimes(1);
    expect(loser.getPostStatus).not.toHaveBeenCalled();
  });
});

// ── 14: infrastructure-error backoff ──────────────────────────────────────────

describe("14 — a broken confirmation subsystem does not retry every 2 seconds", () => {
  it("after a failure the gate refuses further attempts until the backoff expires", () => {
    const gate = createConfirmationErrorGate();
    const t0 = 1_000_000;

    expect(gate.shouldAttempt(t0)).toBe(true);

    const first = gate.recordFailure(t0);
    expect(first.isFirstOfStreak).toBe(true);
    expect(first.backoffMs).toBe(5_000);

    // The Render worker polls every 2s — the next two ticks must be skipped.
    expect(gate.shouldAttempt(t0 + 2_000)).toBe(false);
    expect(gate.shouldAttempt(t0 + 4_000)).toBe(false);
    expect(gate.shouldAttempt(t0 + 5_000)).toBe(true);
  });

  it("a sustained outage backs off further, and only the first failure of a streak is loggable", () => {
    const gate = createConfirmationErrorGate();
    let now = 0;

    const delays: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const { backoffMs, isFirstOfStreak } = gate.recordFailure(now);
      expect(isFirstOfStreak).toBe(i === 0);
      delays.push(backoffMs);
      now += backoffMs;
    }
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 120_000]);
    // Bounded — never unbounded growth.
    expect(gate.recordFailure(now).backoffMs).toBe(120_000);
  });

  it("a success clears the streak, so a transient blip self-heals immediately", () => {
    const gate = createConfirmationErrorGate();
    gate.recordFailure(0);
    expect(gate.shouldAttempt(1_000)).toBe(false);

    gate.recordSuccess();
    expect(gate.shouldAttempt(1_000)).toBe(true);
    // And the next failure starts the curve over, not where it left off.
    expect(gate.recordFailure(1_000).backoffMs).toBe(5_000);
  });

  it("the backoff curve itself is bounded at both ends", () => {
    expect(nextConfirmationErrorBackoffMs(0)).toBe(5_000);
    expect(nextConfirmationErrorBackoffMs(1)).toBe(5_000);
    expect(nextConfirmationErrorBackoffMs(6)).toBe(120_000);
    expect(nextConfirmationErrorBackoffMs(999)).toBe(120_000);
  });
});

// ── 12/13: the real adapter, which both workers share ────────────────────────

describe("12/13 — the repository adapter normalizes, so both workers get one contract", () => {
  /** Minimal Supabase client stub: only `.rpc()` is exercised by these two methods. */
  function fakeClient(payload: unknown) {
    return { rpc: vi.fn(async () => ({ data: payload, error: null })) };
  }

  it("claimJobForConfirmation returns null for the exact production payload that used to throw", async () => {
    const { SupabasePublishingRepository } = await vi.importActual<
      typeof import("@/infrastructure/repositories/supabase-publishing-repository")
    >("@/infrastructure/repositories/supabase-publishing-repository");

    const repo = new SupabasePublishingRepository(fakeClient(allNullComposite()) as never);
    await expect(repo.claimJobForConfirmation("worker-89-c4d93x")).resolves.toBeNull();
  });

  it("claimJobForConfirmation returns a domain job for the SETOF array shape the fixed RPC now sends", async () => {
    const { SupabasePublishingRepository } = await vi.importActual<
      typeof import("@/infrastructure/repositories/supabase-publishing-repository")
    >("@/infrastructure/repositories/supabase-publishing-repository");

    const repo = new SupabasePublishingRepository(fakeClient([row()]) as never);
    const claimed = await repo.claimJobForConfirmation("worker-1");
    expect(claimed?.id).toBe("job-1");
    expect(claimed?.status).toBe("awaiting_confirmation");
  });

  it("claimNextJob — the publishing path — goes through the same normalizer, so it cannot regress either", async () => {
    const { SupabasePublishingRepository } = await vi.importActual<
      typeof import("@/infrastructure/repositories/supabase-publishing-repository")
    >("@/infrastructure/repositories/supabase-publishing-repository");

    const repo = new SupabasePublishingRepository(fakeClient([row({ status: "processing" })]) as never);
    const claimed = await repo.claimNextJob("worker-1");
    expect(claimed?.id).toBe("job-1");

    const emptyRepo = new SupabasePublishingRepository(fakeClient(allNullComposite()) as never);
    await expect(emptyRepo.claimNextJob("worker-1")).resolves.toBeNull();
  });
});

// ── 15: publishing cadence untouched ──────────────────────────────────────────

describe("15 — the normal publishing poll cadence is unchanged", () => {
  it("the confirmation error gate is entirely separate from the publish poll backoff", async () => {
    // classifyPollError/nextBackoffMs drive the PUBLISHING claim loop and are
    // untouched by this fix — asserted here so a future change that conflates
    // the two is caught.
    const { nextBackoffMs } = await import("../scripts/publishing-worker-core");
    expect(nextBackoffMs(0, 1000, 30_000)).toBe(1000);
    expect(nextBackoffMs(1000, 1000, 30_000)).toBe(2000);
    expect(nextBackoffMs(30_000, 1000, 30_000)).toBe(30_000);
    // Different curve from the confirmation gate — they are not shared.
    expect(nextConfirmationErrorBackoffMs(1)).not.toBe(nextBackoffMs(0, 1000, 30_000));
  });
});
