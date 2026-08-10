import { beforeEach, describe, expect, it, vi } from "vitest";

const collectEngagementAnalytics = vi.fn(async () => ({
  checked: 0, recorded: 0, alreadyRecorded: 0, skipped: 0, failed: 0,
}));

vi.mock("@/core/application/use-cases/engagement/collector", () => ({ collectEngagementAnalytics }));
vi.mock("@/infrastructure/supabase/admin-client", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/infrastructure/repositories/supabase-engagement-repository", () => ({
  SupabaseEngagementRepository: class {},
}));
vi.mock("@/infrastructure/repositories/supabase-publishing-repository", () => ({
  SupabasePublishingRepository: class {},
}));
vi.mock("@/infrastructure/blotato/http-blotato-client", () => ({ HttpBlotatoClient: class {} }));
vi.mock("@/infrastructure/blotato/blotato-config", () => ({ blotatoConfig: vi.fn(() => ({ apiKey: "test" })) }));

describe("scheduled engagement collector route", () => {
  beforeEach(() => {
    collectEngagementAnalytics.mockClear();
    process.env.CRON_SECRET = "cron-secret-at-least-16";
    process.env.PUBLISHING_WORKER_SECRET = "worker-secret-at-least-16";
  });

  it("rejects a cron request that presents the worker secret", async () => {
    const { GET } = await import("@/app/api/internal/engagement/collect/route");
    const response = await GET(new Request("http://localhost/api/internal/engagement/collect", {
      headers: { authorization: `Bearer ${process.env.PUBLISHING_WORKER_SECRET}` },
    }) as never);
    expect(response.status).toBe(401);
    expect(collectEngagementAnalytics).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/internal/engagement/collect/route");
    const response = await GET(new Request("http://localhost/api/internal/engagement/collect") as never);
    expect(response.status).toBe(401);
    expect(collectEngagementAnalytics).not.toHaveBeenCalled();
  });

  it("runs a bounded pass for an authenticated Vercel cron request", async () => {
    const { GET } = await import("@/app/api/internal/engagement/collect/route");
    const response = await GET(new Request("http://localhost/api/internal/engagement/collect", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }) as never);
    expect(response.status).toBe(200);
    expect(collectEngagementAnalytics).toHaveBeenCalledWith(expect.any(Object), { limit: 50 });
  });

  it("keeps manual POST collection behind the separate publishing-worker secret", async () => {
    const { POST } = await import("@/app/api/internal/engagement/collect/route");
    const response = await POST(new Request("http://localhost/api/internal/engagement/collect", {
      method: "POST", headers: { authorization: `Bearer ${process.env.PUBLISHING_WORKER_SECRET}` },
    }) as never);
    expect(response.status).toBe(200);
  });
});
