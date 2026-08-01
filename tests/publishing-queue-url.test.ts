import { describe, expect, it } from "vitest";
import { buildQueueUrl } from "@/lib/publishing-queue-url";

const ORG_ID = "00000000-0000-4000-8000-000000000001";

describe("buildQueueUrl", () => {
  it("returns the bare queue URL when no filters are active", () => {
    expect(buildQueueUrl(ORG_ID, {}, { tab: "queued" })).toBe(`/organisations/${ORG_ID}/publishing?tab=queued`);
  });

  it("preserves every other active filter when only one is overridden — switching tabs never drops a search or date range", () => {
    const current = { tab: "failed", platform: "linkedin", q: "launch", dateFrom: "2026-08-01" };
    const url = buildQueueUrl(ORG_ID, current, { tab: "published" });

    expect(url).toContain("tab=published");
    expect(url).toContain("platform=linkedin");
    expect(url).toContain("q=launch");
    expect(url).toContain("dateFrom=2026-08-01");
  });

  it("clears a filter when its override is explicitly undefined — the 'All platforms' / 'Clear filters' pattern", () => {
    const current = { tab: "queued", platform: "linkedin", triggerType: "immediate" };
    const url = buildQueueUrl(ORG_ID, current, { platform: undefined });

    expect(url).toContain("tab=queued");
    expect(url).toContain("triggerType=immediate");
    expect(url).not.toContain("platform");
  });

  it("drops every filter but the active tab when clearing all filters", () => {
    const current = { tab: "failed", q: "instagram", platform: "x", dateTo: "2026-08-10" };
    const url = buildQueueUrl(ORG_ID, {}, { tab: current.tab });

    expect(url).toBe(`/organisations/${ORG_ID}/publishing?tab=failed`);
  });
});
