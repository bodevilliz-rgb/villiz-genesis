import { classifyPollError } from "../src/core/domain/entities/infrastructure-error";

/** One process-wide Supabase restriction gate; AI/provider traffic never enters here. */
export const SUPABASE_QUOTA_COOLDOWN_MS = 15 * 60_000;
export function createWorkerBackendGate(now = Date.now) {
  let retryAt: number | null = null;
  let probing = false;
  let generation = 0;
  return {
    isOpen: () => retryAt !== null,
    open() { retryAt = now() + SUPABASE_QUOTA_COOLDOWN_MS; generation += 1; },
    assertHealthy() {
      if (retryAt !== null) throw Object.assign(new Error("Supabase degraded gate is open"), { code: "exceed_egress_quota", infrastructureCategory: "quota" });
    },
    async allowWork(probe: () => Promise<void>): Promise<boolean> {
      if (retryAt === null) return true;
      if (probing || now() < retryAt) return false;
      probing = true;
      const observed = generation;
      try {
        await probe();
        if (generation === observed) retryAt = null;
      } catch {
        retryAt = now() + SUPABASE_QUOTA_COOLDOWN_MS;
      } finally { probing = false; }
      return retryAt === null;
    },
  };
}
export type WorkerBackendGate = ReturnType<typeof createWorkerBackendGate>;
export const sharedWorkerBackendGate = createWorkerBackendGate();

/** Install only on Supabase clients. Preserve the response for normal repository errors. */
export function createWorkerBackendFetch(gate: WorkerBackendGate, network: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    gate.assertHealthy();
    let response: Response;
    try { response = await network(input, init); }
    catch (error) {
      if (classifyPollError(error) === "quota") gate.open();
      throw error;
    }
    if (!response.ok) {
      // Read at most 4 KiB of diagnostics; never materialise an unbounded body.
      const reader = response.clone().body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let message = "";
        try {
          while (message.length < 4096) {
            const part = await reader.read();
            if (part.done) break;
            message += decoder.decode(part.value.subarray(0, 4096 - message.length));
          }
        } finally { void reader.cancel().catch(() => {}); }
        if (/exceed_egress_quota|quota|restrict/i.test(message)) gate.open();
      }
    }
    return response;
  };
}
