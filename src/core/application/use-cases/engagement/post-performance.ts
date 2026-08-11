import type {
  EngagementMeasurementWindow,
  EngagementMetricSnapshot,
} from "@/core/domain/entities/engagement";
import type { CanonicalEngagementMetrics } from "./performance";

export const PERFORMANCE_CHECKPOINTS = ["24h", "72h", "7d"] as const;
export type PerformanceCheckpoint = (typeof PERFORMANCE_CHECKPOINTS)[number];

export interface PostPerformanceView {
  latest: EngagementMetricSnapshot | null;
  checkpoints: Partial<Record<PerformanceCheckpoint, EngagementMetricSnapshot>>;
  exactRecommendationMatch: boolean;
  engagementPerThousand: number | null;
}

function timestamp(snapshot: EngagementMetricSnapshot): number {
  return Date.parse(snapshot.providerCapturedAt ?? snapshot.observedAt);
}

function isFixedCheckpoint(value: EngagementMeasurementWindow | null): value is PerformanceCheckpoint {
  return value === "24h" || value === "72h" || value === "7d";
}

/** Likes + comments + shares + saves per 1,000 reach (or views as fallback). */
export function engagementPerThousand(metrics: Record<string, number | null>): number | null {
  const canonical = metrics as CanonicalEngagementMetrics;
  const denominator = canonical.reach ?? canonical.views;
  if (!denominator || denominator <= 0) return null;
  const interactions = [canonical.likes, canonical.comments, canonical.shares, canonical.saves];
  if (interactions.every((value) => value === null)) return null;
  const total = interactions.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Math.round((total / denominator) * 1000 * 100) / 100;
}

/**
 * Builds a factual view of one published post. Repeated provider snapshots in
 * the same checkpoint are reduced to the latest capture; no causal or
 * predictive claim is made.
 */
export function buildPostPerformanceView(snapshots: EngagementMetricSnapshot[]): PostPerformanceView {
  const ordered = [...snapshots].sort((a, b) => timestamp(b) - timestamp(a));
  const latest = ordered[0] ?? null;
  const checkpoints: Partial<Record<PerformanceCheckpoint, EngagementMetricSnapshot>> = {};
  for (const snapshot of ordered) {
    if (isFixedCheckpoint(snapshot.measurementWindow) && !checkpoints[snapshot.measurementWindow]) {
      checkpoints[snapshot.measurementWindow] = snapshot;
    }
  }
  return {
    latest,
    checkpoints,
    exactRecommendationMatch: Boolean(latest?.recommendationId && latest.feedbackEventId),
    engagementPerThousand: latest ? engagementPerThousand(latest.metrics) : null,
  };
}
