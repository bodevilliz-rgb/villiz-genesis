import { createAdminClient } from "../src/infrastructure/supabase/admin-client";
import { createWorkerBackendFetch, sharedWorkerBackendGate } from "./worker-backend-gate";

export function createWorkerBackendClient() {
  const client = createAdminClient(createWorkerBackendFetch(sharedWorkerBackendGate));
  // The sole half-open probe bypasses the work gate, has a ten-second network
  // deadline, and reads at most one id. It cannot claim or mutate a job.
  const health = createAdminClient((input, init) => fetch(input, {
    ...init, signal: AbortSignal.timeout(10_000),
  }));
  const probe = async () => {
    const { error } = await health.from("publishing_jobs").select("id").limit(1).retry(false);
    if (error) throw error;
  };
  return { client, probe };
}
