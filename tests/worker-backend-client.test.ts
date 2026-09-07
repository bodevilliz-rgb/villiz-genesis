import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/infrastructure/supabase/admin-client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { createAdminClient: (network: typeof fetch) => createClient("https://backend.test", "local-test-key", {
    global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false },
  }) };
});
import { createWorkerBackendClient } from "../scripts/worker-backend-client";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("one failed health probe sends exactly one bounded request even for SDK-retryable errors", async () => {
  vi.useFakeTimers();
  const network = vi.fn().mockImplementation(async () => new Response('{"message":"backend unavailable"}', { status: 520 }));
  vi.stubGlobal("fetch", network);
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const { probe } = createWorkerBackendClient();
  const result = probe().catch(error => error);
  await vi.advanceTimersByTimeAsync(30_000); await result;
  expect(network).toHaveBeenCalledOnce();
  expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
  const [url, options] = network.mock.calls[0]!;
  expect(String(url)).toMatch(/publishing_jobs\?select=id&limit=1$/);
  expect(options.signal).toBeInstanceOf(AbortSignal);
});
