import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { SupabaseMediaRepository } from "@/infrastructure/repositories/supabase-media-repository";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";
const read = (path: string) => readFileSync(path, "utf8");
const migration = () => read("supabase/migrations/20260907000000_publishing_safe_recovery_settlement.sql");
it("recovery defers reacquisition and both claim paths share the due-time predicate", () => {
  expect(migration()).toMatch(/coalesce\(next_attempt_at, scheduled_for\) <= now\(\)/);
  expect(migration()).toMatch(/next_attempt_at = now\(\) \+ interval '60 seconds'/);
  expect(migration()).toContain("from public.claim_next_publishing_job(p_worker_id)");
});
it("SQL reassignment uses fresh fixtures and explicitly asserts terminal immutability", () => {
  const sql = read("supabase/tests/80_publishing_settlement.sql");
  expect(sql).not.toContain("set status = 'started', error_code = null");
  expect(sql).toContain("failed attempt remains immutable");
  expect(sql).toContain("completed attempt remains immutable");
  expect(sql).toContain("immediate legacy claim is empty");
  expect(sql).toContain("immediate recovery claim is empty");
  expect(sql).toContain("claim succeeds after backoff");
});
function harness(data: unknown[] = []) {
  const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), range: vi.fn(),
    then: (resolve: (v: unknown) => void) => resolve({ data, error: null }) };
  for (const method of [chain.select, chain.eq, chain.in, chain.order, chain.limit, chain.range]) method.mockReturnValue(chain);
  return { chain, client: { from: () => chain } };
}
it("library stats returns a single database aggregate without downloading sizes", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [{ total_assets: 10001, image_count: 10000, video_count: 1, total_storage_bytes: 999999 }], error: null });
  const from = vi.fn(() => { throw new Error("row scan"); });
  const repo = new SupabaseMediaRepository({ rpc, from } as never);
  await expect(repo.getLibraryStats("org")).resolves.toEqual({ totalAssets: 10001, imageCount: 10000, videoCount: 1, totalStorageBytes: 999999 });
  expect(rpc).toHaveBeenCalledWith("get_media_library_stats", { p_organisation_id: "org" });
});
it.each(["getAssetVersions", "listDraftsReferencingAsset", "listCampaignsReferencingAsset"] as const)("%s bounds every reference/history result", async method => {
  const { chain, client } = harness([{ draft_id: "d", campaign_id: "c" }]);
  await new SupabaseMediaRepository(client as never)[method]("asset");
  expect(chain.limit).toHaveBeenCalledTimes(method === "getAssetVersions" ? 1 : 2);
  for (const [limit] of chain.limit.mock.calls) expect(limit).toBeLessThanOrEqual(100);
});
it.each(["listAttemptsForJob", "listAttemptsForDraft", "listJobsForDraft", "listAttemptsForAnalytics", "listJobsForAnalytics"] as const)("%s always bounds returned rows", async method => {
  const { chain, client } = harness();
  await new SupabasePublishingRepository(client as never)[method]("org", {} as never);
  expect(chain.limit).toHaveBeenCalled();
});
it("latest attempt reads only one row in descending attempt order", async () => {
  const { chain, client } = harness();
  const repo = new SupabasePublishingRepository(client as never);
  expect(await repo.findLatestAttemptForJob("org", "job")).toBeNull();
  expect(chain.limit).toHaveBeenCalledWith(1);
  expect(chain.order).toHaveBeenCalledWith("attempt_number", { ascending: false });
});
it("worker and confirmation use latest attempt instead of materializing job history", () => {
  for (const path of ["src/core/application/use-cases/publishing/index.ts", "src/core/application/use-cases/publishing/confirmation.ts"]) {
    const source = read(path);
    expect(source).toContain("findLatestAttemptForJob");
    expect(source).not.toContain("existingAttempts.length + 1");
  }
});
it("campaign preview pipeline signs only thumbnails and maps UI URLs by asset ID", () => {
  const source = read("src/app/(workspace)/organisations/[orgId]/campaigns/[campaignId]/page.tsx");
  expect(source).not.toContain("getSignedUrl(a.storagePath)");
  expect(source).toContain("signCampaignPreviews");
  for (const component of ["campaign-assets-panel", "campaign-bulk-scheduler"]) {
    expect(read(`src/components/campaigns/${component}.tsx`)).not.toContain("signedUrls[asset.storagePath]");
  }
});
it("campaign schedule caps page fanout and aggregate migration preserves RLS", () => {
  expect(read("src/server/queries/campaign-schedule.ts")).toContain(".limit(417)");
  const sql = read("supabase/migrations/20260907001000_media_library_stats.sql");
  expect(sql).toMatch(/security invoker/i);
  expect(sql).toContain("sum(size_bytes)");
});
it.each(["listAttemptsForAnalytics", "listJobsForAnalytics"] as const)("%s refuses incomplete aggregate input instead of reporting partial totals", async method => {
  const { client } = harness(Array.from({ length: 101 }, () => ({})));
  await expect(new SupabasePublishingRepository(client as never)[method]("org", {})).rejects.toThrow("Narrow the date range");
});
