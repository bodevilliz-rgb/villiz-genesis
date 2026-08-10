import type {
  EngagementMetricSnapshot,
  EngagementObjectiveType,
  EngagementPerformanceSummary,
} from "@/core/domain/entities/engagement";

export const MINIMUM_PERFORMANCE_SAMPLE = 10;
export const STRONG_PERFORMANCE_SAMPLE = 30;

const ALIASES = {
  views: ["views", "viewCount", "videoViews", "mediaViews"],
  reach: ["reach", "uniqueViews", "accountsReached"],
  impressions: ["impressions", "impressionCount"],
  likes: ["likes", "likeCount"],
  comments: ["comments", "commentCount"],
  shares: ["shares", "shareCount", "sends"],
  saves: ["saves", "saveCount", "bookmarks"],
  clicks: ["clicks", "clickCount", "linkClicks"],
  profileVisits: ["profileVisits", "profileVisitCount"],
  enquiries: ["enquiries", "inquiries", "leads"],
  bookings: ["bookings", "conversions"],
  watchTimeMs: ["watchTimeMs", "watchTime", "totalWatchTimeMs"],
} as const;

export type CanonicalEngagementMetrics = { [K in keyof typeof ALIASES]: number | null };

function finiteNonNegative(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function flattenRecord(value: unknown, output: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = child;
    if (child && typeof child === "object" && !Array.isArray(child)) flattenRecord(child, output);
  }
  return output;
}

export function normaliseEngagementMetrics(raw: unknown): CanonicalEngagementMetrics {
  const flat = flattenRecord(raw);
  return Object.fromEntries(
    Object.entries(ALIASES).map(([canonical, aliases]) => {
      const match = aliases.map((alias) => finiteNonNegative(flat[alias])).find((value) => value !== null) ?? null;
      return [canonical, match];
    }),
  ) as CanonicalEngagementMetrics;
}

export function objectiveDirectionalScore(
  objective: EngagementObjectiveType,
  metrics: CanonicalEngagementMetrics,
): number | null {
  const denominator = metrics.reach ?? metrics.views;
  if (!denominator || denominator <= 0) return null;
  const perThousand = 1000 / denominator;
  const signals = objective === "awareness"
    ? [metrics.views, metrics.shares, metrics.saves]
    : objective === "engagement"
      ? [metrics.likes, metrics.comments, metrics.shares, metrics.saves]
      : objective === "enquiries"
        ? [metrics.clicks, metrics.profileVisits, metrics.enquiries]
        : [metrics.clicks, metrics.enquiries, metrics.bookings];
  if (signals.every((value) => value === null)) return null;
  const value = objective === "awareness"
    ? (metrics.views ?? 0) + (metrics.shares ?? 0) * 8 + (metrics.saves ?? 0) * 5
    : objective === "engagement"
      ? (metrics.likes ?? 0) + (metrics.comments ?? 0) * 3 + (metrics.shares ?? 0) * 5 + (metrics.saves ?? 0) * 4
      : objective === "enquiries"
        ? (metrics.clicks ?? 0) * 2 + (metrics.profileVisits ?? 0) + (metrics.enquiries ?? 0) * 10
        : (metrics.clicks ?? 0) + (metrics.enquiries ?? 0) * 5 + (metrics.bookings ?? 0) * 20;
  return Math.round(value * perThousand * 100) / 100;
}

export function performanceSummary(
  snapshots: EngagementMetricSnapshot[],
  objective: EngagementObjectiveType,
): EngagementPerformanceSummary & { performanceConfidence: number | null } {
  const latestByPost = new Map<string, EngagementMetricSnapshot>();
  for (const snapshot of snapshots) {
    const current = latestByPost.get(snapshot.externalPostId);
    if (!current || snapshot.observedAt > current.observedAt) latestByPost.set(snapshot.externalPostId, snapshot);
  }
  const latest = [...latestByPost.values()];
  const scores = latest
    .map((snapshot) => objectiveDirectionalScore(objective, snapshot.metrics as CanonicalEngagementMetrics))
    .filter((score): score is number => score !== null);
  const sampleSize = scores.length;
  const directionalScore = sampleSize > 0
    ? Math.round((scores.reduce((total, score) => total + score, 0) / sampleSize) * 100) / 100
    : null;
  const variantEntries = [...new Set(latest.map((snapshot) => snapshot.selectedVariant).filter(Boolean))]
    .map((variant) => {
      const variantScores = latest.filter((snapshot) => snapshot.selectedVariant === variant)
        .map((snapshot) => objectiveDirectionalScore(objective, snapshot.metrics as CanonicalEngagementMetrics))
        .filter((score): score is number => score !== null);
      return [variant!, {
        sampleSize: variantScores.length,
        directionalScore: Math.round((variantScores.reduce((total, score) => total + score, 0) / variantScores.length) * 100) / 100,
      }] as const;
    }).filter(([, value]) => value.sampleSize >= 3)
    .sort((a, b) => b[1].directionalScore - a[1].directionalScore);
  const variantScores = Object.fromEntries(variantEntries);
  const championVariant = variantEntries.length >= 2 ? variantEntries[0]![0] : null;
  const challengerVariant = variantEntries.length >= 2 ? variantEntries[1]![0] : null;
  if (sampleSize < MINIMUM_PERFORMANCE_SAMPLE) {
    return { sampleSize, minimumSampleSize: MINIMUM_PERFORMANCE_SAMPLE, directionalScore, label: "insufficient_data", performanceConfidence: null, championVariant, challengerVariant, variantScores };
  }
  const performanceConfidence = Math.min(85, sampleSize < STRONG_PERFORMANCE_SAMPLE
    ? 45 + sampleSize
    : 75 + Math.floor((sampleSize - STRONG_PERFORMANCE_SAMPLE) / 3));
  return {
    sampleSize,
    minimumSampleSize: MINIMUM_PERFORMANCE_SAMPLE,
    directionalScore,
    label: sampleSize < STRONG_PERFORMANCE_SAMPLE ? "directional" : "performance_informed",
    performanceConfidence,
    championVariant,
    challengerVariant,
    variantScores,
  };
}
