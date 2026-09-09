import { expect, it, vi } from "vitest";
import { classifyPollError, createPublishingCircuit, createSingleFlightScheduler, createPublishingPoller } from "../scripts/publishing-worker-core";
it.each([[{ code: "exceed_egress_quota" }, "quota"], [{ message: "Project restricted" }, "quota"], [new Error("Storage quota exceeded"), "quota"], [{ status: 429 }, "rate_limit"], [new Error("Blotato returned 503 uploading media"), "service"], [{ statusCode: "502" }, "service"], [new TypeError("fetch failed"), "network"]])("classifies %j", (error, category) => {
  expect(classifyPollError(error)).toBe(category);
});
it("hard quota stops claims until a finite long probe and success recovers", () => {
  const circuit = createPublishingCircuit();
  circuit.fail({ code: "exceed_egress_quota" }, 0);
  expect(circuit.shouldAttempt(299_999)).toBe(false);
  expect(circuit.shouldAttempt(900_000)).toBe(true);
  circuit.succeed(); expect(circuit.shouldAttempt(0)).toBe(true);
});
it.each([429, 503])("%s backs off exponentially with a finite ceiling", status => {
  const circuit = createPublishingCircuit(); let now = 0; let last = 0;
  for (let i = 0; i < 30; i++) {
    const delay = circuit.fail({ status }, now);
    expect(delay).toBeGreaterThanOrEqual(last); expect(delay).toBeLessThanOrEqual(60_000);
    expect(circuit.shouldAttempt(now + delay - 1)).toBe(false);
    now += delay; expect(circuit.shouldAttempt(now)).toBe(true); last = delay;
  }
  circuit.succeed(); expect(circuit.fail({ status }, now)).toBe(2000);
});
it("scheduler runs one cycle at a time and stop releases its timer", async () => {
  vi.useFakeTimers();
  try {
    let resolve!: () => void;
    const cycle = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const stop = createSingleFlightScheduler(cycle, 2000);
    await vi.advanceTimersByTimeAsync(20_000); expect(cycle).toHaveBeenCalledOnce();
    resolve(); await vi.advanceTimersByTimeAsync(2000); expect(cycle).toHaveBeenCalledTimes(2);
    stop(); resolve(); await vi.advanceTimersByTimeAsync(20_000); expect(cycle).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it("poller refuses overlapping calls and makes no claim during quota cooldown; successful probe recovers", async () => {
  let now = 0; let reject!: (v: unknown) => void;
  const claimNextJob = vi.fn().mockImplementationOnce(() => new Promise((_, r) => { reject = r; })).mockResolvedValue(null);
  const deps = { publishing: { recoverStaleJobs: vi.fn().mockResolvedValue([]), claimNextJob, claimJobForConfirmation: vi.fn().mockResolvedValue(null) } };
  const poll = createPublishingPoller(deps as never, () => now);
  const first = poll(); await poll(); expect(claimNextJob).toHaveBeenCalledOnce();
  reject({ code: "exceed_egress_quota" }); await first;
  for (let i = 0; i < 20; i++) await poll(); expect(claimNextJob).toHaveBeenCalledOnce();
  now = 900_000; await poll(); await poll(); expect(claimNextJob).toHaveBeenCalledTimes(3);
});

it("passes effective mode and opaque generation proof into every pre-submission claim", async () => {
  const claimNextJob = vi.fn().mockResolvedValue(null);
  const capability = { livePublishingEnabled: true, generationId: "generation-current", proof: "opaque-proof" };
  const deps = {
    workerCapability: capability,
    publishing: {
      recoverStaleJobs: vi.fn().mockResolvedValue([]),
      claimNextJob,
      claimJobForConfirmation: vi.fn().mockResolvedValue(null),
    },
  };

  await createPublishingPoller(deps as never)();

  expect(claimNextJob).toHaveBeenCalledExactlyOnceWith(expect.any(String), true, capability);
});

it.each([[{ code: "exceed_egress_quota", message: "Request rejected" }, 403, "quota"], [{ message: "Too many requests" }, 429, "rate_limit"], [{ message: "Unavailable" }, 503, "service"]] as const)("retains classification through the actual publishing repository", async (error, status, category) => {
  const { SupabasePublishingRepository } = await import("@/infrastructure/repositories/supabase-publishing-repository");
  const repo = new SupabasePublishingRepository({ rpc: async () => ({ error, data: null, status }) } as never);
  const caught = await repo.claimNextJob("worker").catch(e => e);
  expect(classifyPollError(caught)).toBe(category);
});
it("quota during confirmation also pauses publishing claims", async () => {
  let now = 0;
  const deps = { publishing: { recoverStaleJobs: vi.fn().mockResolvedValue([]), claimNextJob: vi.fn().mockResolvedValue(null), claimJobForConfirmation: vi.fn().mockRejectedValue({ code: "exceed_egress_quota" }) } };
  const poll = createPublishingPoller(deps as never, () => now);
  await poll(); now += 60_000; await poll();
  expect(deps.publishing.claimNextJob).toHaveBeenCalledOnce();
});
