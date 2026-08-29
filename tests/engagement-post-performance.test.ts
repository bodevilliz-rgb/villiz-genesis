import { describe, expect, it } from "vitest";
import {
  buildPostPerformanceView,
  engagementPerThousand,
} from "@/core/application/use-cases/engagement/post-performance";
import type { EngagementMetricSnapshot, EngagementMeasurementWindow } from "@/core/domain/entities/engagement";

function snapshot(window: EngagementMeasurementWindow, observedAt: string, overrides: Partial<EngagementMetricSnapshot> = {}): EngagementMetricSnapshot {
  return {
    id: `${window}-${observedAt}`,
    organisationId: "org-1",
    draftId: "draft-1",
    publishingAttemptId: "attempt-1",
    recommendationId: "rec-1",
    feedbackEventId: "feedback-1",
    selectedVariant: "recommended",
    platform: "instagram",
    objectiveType: "engagement",
    providerAccountId: "account-1",
    externalPostId: "post-1",
    providerSnapshotKey: `${window}-${observedAt}`,
    observedAt,
    providerCapturedAt: observedAt,
    measurementWindow: window,
    metrics: { reach: 800, views: 1000, impressions: 1200, likes: 40, comments: 5, shares: 8, saves: 7, clicks: 3 },
    rawMetrics: {},
    createdAt: observedAt,
    ...overrides,
  };
}

describe("per-post performance view", () => {
  it("normalises interactions per 1,000 reach", () => {
    expect(engagementPerThousand({ reach: 800, views: 1000, likes: 40, comments: 5, shares: 8, saves: 7 })).toBe(75);
  });

  it("uses views only when reach is unavailable", () => {
    expect(engagementPerThousand({ reach: null, views: 500, likes: 10, comments: 2, shares: 1, saves: 2 })).toBe(30);
  });

  it("keeps the latest immutable capture for each fixed checkpoint", () => {
    const older24h = snapshot("24h", "2026-08-11T10:00:00Z", { metrics: { reach: 500, likes: 10 } });
    const newer24h = snapshot("24h", "2026-08-11T11:00:00Z", { metrics: { reach: 600, likes: 15 } });
    const at72h = snapshot("72h", "2026-08-13T10:00:00Z");
    const result = buildPostPerformanceView([older24h, at72h, newer24h]);
    expect(result.latest?.id).toBe(at72h.id);
    expect(result.checkpoints["24h"]?.id).toBe(newer24h.id);
    expect(result.checkpoints["72h"]?.id).toBe(at72h.id);
    expect(result.checkpoints["7d"]).toBeUndefined();
    expect(result.exactRecommendationMatch).toBe(true);
    expect(result.evidenceStatus).toBe("awaiting_7d");
    expect(result.learningStatus).toBe("not_eligible");
  });

  it("labels metrics as unattributed when the exact recommendation link is absent", () => {
    const result = buildPostPerformanceView([
      snapshot("24h", "2026-08-11T10:00:00Z", { recommendationId: null, feedbackEventId: null }),
    ]);
    expect(result.exactRecommendationMatch).toBe(false);
    expect(result.attributionStatus).toBe("unverified");
    expect(result.learningStatus).toBe("not_eligible");
  });

  it("does not treat a tiny seven-day sample as learning evidence", () => {
    const result = buildPostPerformanceView([
      snapshot("7d", "2026-08-18T10:00:00Z", { metrics: { reach: 11, views: 8, likes: 0, comments: 0, shares: 0, saves: 0 } }),
    ]);
    expect(result.exposure).toBe(11);
    expect(result.evidenceStatus).toBe("insufficient_exposure");
    expect(result.learningStatus).toBe("not_eligible");
  });

  it("marks an attributed seven-day post eligible only above the exposure floor", () => {
    const result = buildPostPerformanceView([snapshot("7d", "2026-08-18T10:00:00Z")]);
    expect(result.evidenceStatus).toBe("sufficient");
    expect(result.learningStatus).toBe("eligible");
  });
});
