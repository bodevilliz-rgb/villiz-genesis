import { describe, expect, it } from "vitest";
import { normaliseEngagementMetrics, objectiveDirectionalScore, performanceSummary } from "@/core/application/use-cases/engagement/performance";
import type { EngagementCommercialOutcome, EngagementMetricSnapshot } from "@/core/domain/entities/engagement";

function snapshot(index: number, observedAt = `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`): EngagementMetricSnapshot {
  return {
    id: `snapshot-${index}`, organisationId: "org", draftId: `draft-${index}`,
    publishingAttemptId: `attempt-${index}`, recommendationId: `rec-${index}`, feedbackEventId: `feedback-${index}`,
    selectedVariant: null,
    platform: "instagram", objectiveType: "engagement", providerAccountId: "account-1", externalPostId: `post-${index}`,
    measurementWindow: "7d",
    providerSnapshotKey: `key-${index}-${observedAt}`, observedAt, providerCapturedAt: observedAt,
    metrics: { views: 1000, reach: 800, impressions: 1200, likes: 40, comments: 5, shares: 8, saves: 6,
      clicks: 3, profileVisits: 10, enquiries: 1, bookings: 0, watchTimeMs: 9000 },
    rawMetrics: {}, createdAt: observedAt,
  };
}

describe("engagement performance learning", () => {
  it("does not count early provider snapshots as comparable seven-day evidence", () => {
    const early = Array.from({ length: 12 }, (_, index) => ({ ...snapshot(index), measurementWindow: "72h" as const }));
    const result = performanceSummary(early, "engagement");
    expect(result.sampleSize).toBe(0);
    expect(result.performanceConfidence).toBeNull();
  });
  it("normalises provider aliases and rejects invalid values", () => {
    expect(normaliseEngagementMetrics({ analytics: { viewCount: "1200", sends: 12, likes: -2 } })).toEqual(expect.objectContaining({
      views: 1200, shares: 12, likes: null,
    }));
  });

  it("uses objective-specific weighted scores per 1,000 reach/views", () => {
    const metrics = normaliseEngagementMetrics({ reach: 1000, likes: 10, comments: 2, shares: 3, saves: 4, bookings: 2 });
    expect(objectiveDirectionalScore("engagement", metrics)).toBe(47);
    expect(objectiveDirectionalScore("bookings", metrics)).toBe(40);
  });

  it("does not unlock performance confidence below ten distinct posts", () => {
    const result = performanceSummary(Array.from({ length: 9 }, (_, index) => snapshot(index)), "engagement");
    expect(result.label).toBe("insufficient_data");
    expect(result.performanceConfidence).toBeNull();
  });

  it("excludes seven-day posts without exact applied-recommendation attribution", () => {
    const posts = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot(index), recommendationId: null, feedbackEventId: null,
    }));
    expect(performanceSummary(posts, "engagement").sampleSize).toBe(0);
  });

  it("excludes low-exposure noise from learning", () => {
    const posts = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot(index), metrics: { ...snapshot(index).metrics, reach: 11, views: 8 },
    }));
    expect(performanceSummary(posts, "engagement").sampleSize).toBe(0);
  });

  it("retains a verified commercial outcome below the exposure floor", () => {
    const post = { ...snapshot(0), metrics: { ...snapshot(0).metrics, reach: 11, views: 8 } };
    const outcome: EngagementCommercialOutcome = {
      id: "outcome-1", organisationId: "org", draftId: "draft-0", publishingAttemptId: "attempt-0",
      platform: "instagram", providerAccountId: "account-1", enquiries: 1, bookings: 0,
      revenueMinor: 0, currency: "GBP", note: null, createdBy: null, createdAt: "2026-08-10T00:00:00Z",
    };
    expect(performanceSummary([post], "enquiries", [outcome]).sampleSize).toBe(1);
  });

  it("does not count posts that lack the selected objective's outcome signals", () => {
    const posts = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot(index), metrics: normaliseEngagementMetrics({ views: 1000, reach: 800 }),
    }));
    const result = performanceSummary(posts, "bookings");
    expect(result.sampleSize).toBe(0);
    expect(result.performanceConfidence).toBeNull();
  });

  it("keeps 10–29 posts directional and confidence monotonic at the 30-post boundary", () => {
    const at29 = performanceSummary(Array.from({ length: 29 }, (_, index) => snapshot(index)), "engagement");
    const at30 = performanceSummary(Array.from({ length: 30 }, (_, index) => snapshot(index)), "engagement");
    expect(at29.label).toBe("directional");
    expect(at30.label).toBe("performance_informed");
    expect(at30.performanceConfidence!).toBeGreaterThanOrEqual(at29.performanceConfidence!);
  });

  it("counts posts rather than repeated snapshots and caps confidence at 85", () => {
    const posts = Array.from({ length: 60 }, (_, index) => snapshot(index));
    posts.push(snapshot(0, "2026-09-01T00:00:00Z"));
    const result = performanceSummary(posts, "engagement");
    expect(result.sampleSize).toBe(60);
    expect(result.label).toBe("performance_informed");
    expect(result.performanceConfidence).toBe(85);
  });

  it("names a champion and challenger only after both variants have three observations", () => {
    const posts = Array.from({ length: 10 }, (_, index) => ({
      ...snapshot(index),
      selectedVariant: index < 5 ? "recommended" as const : "alternative_1" as const,
      metrics: { ...snapshot(index).metrics, shares: index < 5 ? 12 : 2 },
    }));
    const result = performanceSummary(posts, "engagement");
    expect(result.championVariant).toBe("recommended");
    expect(result.challengerVariant).toBe("alternative_1");
    expect(result.variantScores.recommended?.sampleSize).toBe(5);
  });
});
