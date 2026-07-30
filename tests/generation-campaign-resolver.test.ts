import { describe, expect, it } from "vitest";
import { resolveCampaignReadiness } from "@/core/application/use-cases/generation/campaign-resolver";
import type { CampaignContext } from "@/core/domain/entities/generation";

function campaign(overrides: Partial<CampaignContext> = {}): CampaignContext {
  return {
    id: "campaign-1",
    name: "Spring promotion",
    objective: "Fill 15 new-patient slots",
    targetAudience: "Existing patients who haven't booked in 12 months",
    primaryCTA: "Book your check-up",
    platforms: ["instagram", "facebook"],
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    status: "active",
    ...overrides,
  };
}

describe("resolveCampaignReadiness", () => {
  it("returns null when no campaign is linked — not a failure state", () => {
    expect(resolveCampaignReadiness(null)).toBeNull();
  });

  it("scores 100% when every check passes", () => {
    const readiness = resolveCampaignReadiness(campaign());
    expect(readiness?.score).toBe(100);
    expect(readiness?.warnings).toHaveLength(0);
    expect(readiness?.recommendations).toHaveLength(0);
  });

  it("flags a missing objective", () => {
    const readiness = resolveCampaignReadiness(campaign({ objective: null }));
    expect(readiness?.checks.find((c) => c.key === "objective")?.met).toBe(false);
    expect(readiness?.warnings.length).toBeGreaterThan(0);
    expect(readiness?.recommendations.length).toBeGreaterThan(0);
  });

  it("flags no platforms selected", () => {
    const readiness = resolveCampaignReadiness(campaign({ platforms: [] }));
    expect(readiness?.checks.find((c) => c.key === "platforms")?.met).toBe(false);
  });

  it("flags missing dates only when either is absent", () => {
    expect(resolveCampaignReadiness(campaign({ startDate: null }))?.checks.find((c) => c.key === "dates")?.met).toBe(
      false,
    );
    expect(resolveCampaignReadiness(campaign({ endDate: null }))?.checks.find((c) => c.key === "dates")?.met).toBe(
      false,
    );
  });

  it("flags an archived campaign as not ready", () => {
    const readiness = resolveCampaignReadiness(campaign({ status: "archived" }));
    expect(readiness?.checks.find((c) => c.key === "status")?.met).toBe(false);
  });

  it("scores proportionally to the number of failed checks", () => {
    const readiness = resolveCampaignReadiness(campaign({ objective: null, primaryCTA: null }));
    // 4 of 6 checks pass = 67%, rounded.
    expect(readiness?.score).toBe(67);
  });
});
