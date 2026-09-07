import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ count: 0, limit: vi.fn() }));
vi.mock("@/infrastructure/supabase/admin-client", () => ({ createAdminClient: () => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: state.limit };
  state.limit.mockImplementation(async (limit: number) => ({ data: Array.from({ length: Math.min(state.count, limit) }, (_, id) => ({ id: String(id) })), error: null }));
  return { from: () => chain };
} }));
import { getCampaignSchedule } from "@/server/queries/campaign-schedule";
it("preserves all 52 weeks across eight supported platforms", async () => {
  state.count = 416;
  expect(await getCampaignSchedule("campaign")).toHaveLength(416);
  expect(state.limit).toHaveBeenCalledWith(417);
});
it("refuses overflow so Awo cannot treat a partial campaign as complete", async () => {
  state.count = 417;
  await expect(getCampaignSchedule("campaign")).rejects.toThrow("Campaign schedule exceeds");
});
