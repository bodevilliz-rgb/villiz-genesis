import { expect, it, vi } from "vitest";
import { createWorkerBackendGate, createWorkerBackendFetch } from "../scripts/worker-backend-gate";

it.each(["awo", "publishing"])("%s Supabase quota blocks both loops; one bounded probe restores both", async source => {
  let now = 0;
  const gate = createWorkerBackendGate(() => now);
  const network = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "exceed_egress_quota" }), { status: 403 }));
  const backend = createWorkerBackendFetch(gate, network);
  await backend("https://backend.test/rest/v1/" + source);
  expect(gate.isOpen()).toBe(true);
  const probe = vi.fn(async () => {});
  expect(await gate.allowWork(probe)).toBe(false);
  await expect(backend("https://backend.test/rest/v1/other")).rejects.toThrow();
  expect(network).toHaveBeenCalledOnce(); expect(probe).not.toHaveBeenCalled();
  now = 900_000;
  let resolve!: () => void;
  probe.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
  const first = gate.allowWork(probe);
  expect(await gate.allowWork(probe)).toBe(false);
  expect(probe).toHaveBeenCalledOnce();
  resolve(); expect(await first).toBe(true);
  expect(await gate.allowWork(probe)).toBe(true);
  expect(gate.isOpen()).toBe(false); expect(probe).toHaveBeenCalledOnce();
});
it("failed probe holds the shared gate for another cooldown", async () => {
  let now = 0; const gate = createWorkerBackendGate(() => now);
  gate.open(); now = 900_000;
  expect(await gate.allowWork(async () => { throw new Error("503"); })).toBe(false);
  now += 899_999; const probe = vi.fn(); expect(await gate.allowWork(probe)).toBe(false); expect(probe).not.toHaveBeenCalled();
});
it("a late healthy request cannot clear a newer quota incident", async () => {
  const gate = createWorkerBackendGate(() => 900_000);
  let resolve!: (response: Response) => void;
  const network = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
  const request = createWorkerBackendFetch(gate, network)("https://backend.test/rest/v1/jobs");
  gate.open(); resolve(new Response("[]")); await request;
  expect(gate.isOpen()).toBe(true);
});
it("ordinary backend 429/503 and AI provider quota do not open the Supabase gate", async () => {
  const gate = createWorkerBackendGate();
  for (const status of [429, 503]) {
    await createWorkerBackendFetch(gate, vi.fn().mockResolvedValue(new Response("unavailable", { status })))("https://backend.test/rest/v1/jobs");
    expect(gate.isOpen()).toBe(false);
  }
  // AI traffic never uses the backend-only fetch wrapper.
  await vi.fn().mockRejectedValue({ code: "insufficient_quota" })().catch(() => {});
  expect(gate.isOpen()).toBe(false);
});

it.each([
  ["awo", "recover"], ["awo", "claim"], ["awo", "process"],
  ["publishing", "recover"], ["publishing", "claim"], ["publishing", "confirmation"],
])("real %s %s quota prevents both runtime pollers from acquiring more work", async (source, stage) => {
  const { createPublishingPoller } = await import("../scripts/publishing-worker-core");
  const { createAwoPoller } = await import("../scripts/awo-campaign-worker-core");
  let now = 0; const gate = createWorkerBackendGate(() => now);
  const network = vi.fn().mockResolvedValueOnce(new Response('{"code":"exceed_egress_quota"}', { status: 403 })).mockImplementation(async () => new Response("[]"));
  const backend = createWorkerBackendFetch(gate, network);
  const quota = async () => { const response = await backend("https://backend.test/rest/v1/jobs"); if (!response.ok) throw { code: "exceed_egress_quota" }; };
  const publishing = { recoverStaleJobs: vi.fn().mockResolvedValue([]), claimNextJob: vi.fn().mockResolvedValue(null), claimJobForConfirmation: vi.fn().mockResolvedValue(null) };
  const awo = { recover: vi.fn().mockResolvedValue(undefined), claim: vi.fn().mockResolvedValue(null), process: vi.fn() };
  const probe = vi.fn(async () => {});
  const publish = createPublishingPoller({ publishing } as never, () => now, { gate, probe });
  const optimise = createAwoPoller(awo, { gate, probe }, () => now);
  if (source === "awo") {
    if (stage === "process") { awo.claim.mockResolvedValueOnce({ id: "job" }); awo.process.mockImplementationOnce(quota); }
    else if (stage === "claim") awo.claim.mockImplementationOnce(quota);
    else awo.recover.mockImplementationOnce(quota);
  } else {
    if (stage === "claim") publishing.claimNextJob.mockImplementationOnce(quota);
    else if (stage === "confirmation") publishing.claimJobForConfirmation.mockImplementationOnce(quota);
    else publishing.recoverStaleJobs.mockImplementationOnce(quota);
  }
  await (source === "awo" ? optimise().catch(() => {}) : publish());
  const publishingClaims = publishing.claimNextJob.mock.calls.length;
  const awoClaims = awo.claim.mock.calls.length;
  for (let i = 0; i < 5; i++) { await publish(); await optimise(); }
  expect(publishing.claimNextJob).toHaveBeenCalledTimes(publishingClaims); expect(awo.claim).toHaveBeenCalledTimes(awoClaims);
  now = 900_000;
  let resolve!: () => void;
  probe.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
  const resuming = publish(); await optimise();
  expect(probe).toHaveBeenCalledOnce(); expect(awo.claim).toHaveBeenCalledTimes(awoClaims);
  resolve(); await resuming; await optimise();
  expect(publishing.claimNextJob).toHaveBeenCalledTimes(publishingClaims + 1); expect(awo.claim).toHaveBeenCalledTimes(awoClaims + 1);
});

it("a thrown Supabase quota response also opens the shared gate", async () => {
  const gate = createWorkerBackendGate();
  const backend = createWorkerBackendFetch(gate, vi.fn().mockRejectedValue({ code: "exceed_egress_quota" }));
  await expect(backend("https://backend.test/rest/v1/jobs")).rejects.toMatchObject({ code: "exceed_egress_quota" });
  expect(gate.isOpen()).toBe(true);
});
