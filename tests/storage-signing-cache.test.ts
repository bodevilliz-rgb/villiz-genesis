import { afterEach, expect, it, vi } from "vitest";
import { SupabaseStoragePort } from "@/infrastructure/ports/supabase-storage-port";
function harness(token = "session-a", supabaseUrl = "https://project-a.supabase.co") {
  const sign = vi.fn(async (path: string) => ({ data: { signedUrl: `${path}?signature=${Math.random()}` }, error: null }));
  const client = { supabaseUrl, auth: { getSession: async () => ({ data: { session: { access_token: token } } }) }, storage: { from: () => ({ createSignedUrl: sign }) } };
  return { sign, client, port: new SupabaseStoragePort(client as never) };
}
afterEach(() => vi.useRealTimers());
it("reuses unchanged paths across request clients in the same session, isolates sessions, refreshes early", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const a = harness(); const b = harness(); const other = harness("other");
  const first = await a.port.getSignedUrl("private/a", 100);
  expect(await b.port.getSignedUrl("private/a", 100)).toBe(first);
  expect(b.sign).not.toHaveBeenCalled();
  await other.port.getSignedUrl("private/a", 100); expect(other.sign).toHaveBeenCalledOnce();
  await a.port.getSignedUrl("private/b", 100); expect(a.sign).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(91_000);
  expect(await a.port.getSignedUrl("private/a", 100)).not.toBe(first);
});
it("deduplicates concurrent signing and evicts old entries at a finite capacity", async () => {
  const a = harness("bounded");
  await Promise.all(Array.from({ length: 10 }, () => a.port.getSignedUrl("same")));
  expect(a.sign).toHaveBeenCalledOnce();
  for (let i = 0; i < 520; i++) await a.port.getSignedUrl(`path-${i}`);
  await a.port.getSignedUrl("same");
  expect(a.sign).toHaveBeenCalledTimes(522);
});
it("never shares service/anonymous clients and does not cache failures or mix requested lifetimes", async () => {
  const a = harness("failure-test");
  a.sign.mockRejectedValueOnce({ code: "exceed_egress_quota" });
  await expect(a.port.getSignedUrl("failure")).rejects.toEqual({ code: "exceed_egress_quota" });
  await a.port.getSignedUrl("failure"); await a.port.getSignedUrl("failure", 21600);
  expect(a.sign).toHaveBeenCalledTimes(3);
  const sign = vi.fn().mockResolvedValue({ data: { signedUrl: "signed" } });
  const client = { storage: { from: () => ({ createSignedUrl: sign }) } };
  const first = new SupabaseStoragePort(client as never); const second = new SupabaseStoragePort(client as never);
  await first.getSignedUrl("private"); await first.getSignedUrl("private"); await second.getSignedUrl("private");
  expect(sign).toHaveBeenCalledTimes(2);
});
it("refreshes long-lived publishing URLs with at least ten percent of their lifetime remaining", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const a = harness("publishing-window");
  const first = await a.port.getSignedUrl("publish/image", 21600);
  await vi.advanceTimersByTimeAsync(21600 * 900);
  expect(await a.port.getSignedUrl("publish/image", 21600)).not.toBe(first);
});

it("isolates identical credentials and paths across Supabase projects", async () => {
  const a = harness("shared-project-token", "https://project-a.supabase.co");
  const b = harness("shared-project-token", "https://project-b.supabase.co");
  const first = await a.port.getSignedUrl("same/path");
  expect(await b.port.getSignedUrl("same/path")).not.toBe(first);
  expect(b.sign).toHaveBeenCalledOnce();
});
