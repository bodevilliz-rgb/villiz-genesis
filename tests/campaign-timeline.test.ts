import { describe, expect, it } from "vitest";
import { computeCampaignTimelineProgress } from "@/core/domain/entities/campaign";

describe("computeCampaignTimelineProgress", () => {
  it("returns nulls when either date is missing", () => {
    expect(computeCampaignTimelineProgress(null, "2026-06-01")).toEqual({
      percentElapsed: null,
      hasStarted: false,
      hasEnded: false,
      totalDays: null,
      elapsedDays: null,
    });
    expect(computeCampaignTimelineProgress("2026-06-01", null)).toEqual({
      percentElapsed: null,
      hasStarted: false,
      hasEnded: false,
      totalDays: null,
      elapsedDays: null,
    });
  });

  it("is 0% before the campaign starts", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const progress = computeCampaignTimelineProgress("2026-06-01", "2026-06-30", now);

    expect(progress.hasStarted).toBe(false);
    expect(progress.hasEnded).toBe(false);
    expect(progress.percentElapsed).toBe(0);
  });

  it("is 100% once the campaign has ended", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const progress = computeCampaignTimelineProgress("2026-06-01", "2026-06-30", now);

    expect(progress.hasStarted).toBe(true);
    expect(progress.hasEnded).toBe(true);
    expect(progress.percentElapsed).toBe(100);
  });

  it("is roughly halfway through a campaign at its midpoint", () => {
    const now = new Date("2026-06-16T00:00:00Z");
    const progress = computeCampaignTimelineProgress("2026-06-01", "2026-07-01", now);

    expect(progress.hasStarted).toBe(true);
    expect(progress.hasEnded).toBe(false);
    expect(progress.percentElapsed).toBeGreaterThanOrEqual(45);
    expect(progress.percentElapsed).toBeLessThanOrEqual(55);
  });

  it("treats a same-day campaign as ended once its single day has passed, not before", () => {
    const before = computeCampaignTimelineProgress("2026-06-01", "2026-06-01", new Date("2026-06-01T00:00:00Z"));
    expect(before.hasEnded).toBe(false);
    expect(before.percentElapsed).toBe(0);

    const after = computeCampaignTimelineProgress("2026-06-01", "2026-06-01", new Date("2026-06-02T00:00:00Z"));
    expect(after.hasEnded).toBe(true);
    expect(after.percentElapsed).toBe(100);
  });

  it("never reports elapsed days beyond the total", () => {
    const farFuture = new Date("2030-01-01T00:00:00Z");
    const progress = computeCampaignTimelineProgress("2026-06-01", "2026-06-30", farFuture);

    expect(progress.elapsedDays).toBe(progress.totalDays);
    expect(progress.percentElapsed).toBe(100);
  });
});
