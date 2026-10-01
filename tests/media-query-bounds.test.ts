import { expect, it, vi } from "vitest";
import { SupabaseMediaRepository } from "@/infrastructure/repositories/supabase-media-repository";
function harness() {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), range: vi.fn(), then: (resolve: (v: unknown) => void) => resolve({ data: [], count: 0 }) };
  for (const method of [chain.select, chain.eq, chain.order, chain.limit, chain.range]) method.mockReturnValue(chain);
  return { chain, repo: new SupabaseMediaRepository({ from: () => chain } as never) };
}
it.each(["listAssets", "listAssetsForDraft", "listAssetsForCampaign", "listAssetsForCollection", "listCollections", "listBrandKits"] as const)("%s bounds parent hydration and selects explicit columns", async (method) => {
  const { chain, repo } = harness();
  await repo[method]("id");
  expect(chain.limit.mock.calls.some(([n, options]) => n > 0 && n <= 200 && !options)).toBe(true);
  expect(chain.select.mock.calls[0]![0]).toBeTypeOf("string");
  expect(chain.select.mock.calls[0]![0]).not.toContain("*");
});
it.each([["listCollections", "media_collection_assets"], ["listBrandKits", "brand_kit_assets"]] as const)("%s also bounds the embedded relationship", async (method, relation) => {
  const { chain, repo } = harness(); await repo[method]("org");
  expect(chain.limit).toHaveBeenCalledWith(50, { referencedTable: relation });
});
it("clamps oversized grid page requests at the repository boundary", async () => {
  const { chain, repo } = harness(); await repo.listAssetsPage("org", { offset: 0, limit: 100000 });
  expect(chain.range).toHaveBeenCalledWith(0, 99);
});
