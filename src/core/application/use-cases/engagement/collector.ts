import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { PublishingRepository } from "@/core/application/ports/publishing-port";
import type { EngagementMeasurementWindow, EngagementObjectiveType, EngagementRecommendation } from "@/core/domain/entities/engagement";
import { isSimulatedPublishingAttempt } from "@/core/domain/entities/publishing";
import { engagementPayloadFingerprint } from "./fingerprint";
import { normaliseEngagementMetrics } from "./performance";

interface CollectorDeps {
  publishing: PublishingRepository;
  engagement: EngagementRepository;
  blotatoClient: BlotatoClient;
}

export interface EngagementCollectionResult {
  checked: number;
  recorded: number;
  alreadyRecorded: number;
  skipped: number;
  failed: number;
}

const MAX_PROVIDER_SNAPSHOTS_PER_POST = 20;
const MAX_FUTURE_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

function providerAccountId(metadata: Record<string, unknown>): string | null {
  const value = metadata.blotatoAccountId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isValidProviderTimestamp(value: string | null, nowMs: number): boolean {
  if (value === null) return true;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs + MAX_FUTURE_TIMESTAMP_DRIFT_MS;
}

function stableMetricKey(value: Record<string, unknown>): string {
  const serialised = JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  let hash = 2166136261;
  for (let index = 0; index < serialised.length; index += 1) {
    hash ^= serialised.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function measurementWindow(
  completedAt: string | null,
  capturedAt: string | null,
  observedAt: string,
): EngagementMeasurementWindow | null {
  if (!completedAt) return null;
  const completedMs = Date.parse(completedAt);
  const measuredMs = Date.parse(capturedAt ?? observedAt);
  if (!Number.isFinite(completedMs) || !Number.isFinite(measuredMs) || measuredMs < completedMs) return null;
  const ageHours = (measuredMs - completedMs) / (60 * 60 * 1000);
  if (ageHours >= 168) return "7d";
  if (ageHours >= 72) return "72h";
  if (ageHours >= 24) return "24h";
  return "under_24h";
}

export async function collectEngagementAnalytics(
  deps: CollectorDeps,
  input: { organisationId?: string; draftId?: string; limit?: number } = {},
): Promise<EngagementCollectionResult> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const attempts = await deps.publishing.listAttemptsForAnalytics(input.organisationId, {
    draftId: input.draftId,
    status: "completed",
    requireExternalPostId: true,
    newestFirst: true,
    limit: Math.min(requestedLimit * 2, 100),
  });
  const eligible = attempts
    .filter((attempt) => attempt.status === "completed" && attempt.externalPostId
      && !isSimulatedPublishingAttempt(attempt) && (!input.draftId || attempt.draftId === input.draftId))
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
    .slice(0, requestedLimit);
  const result: EngagementCollectionResult = { checked: eligible.length, recorded: 0, alreadyRecorded: 0, skipped: 0, failed: 0 };
  if (!deps.blotatoClient.getPostAnalytics || !deps.engagement.createMetricSnapshot) {
    return { ...result, skipped: eligible.length };
  }
  const observedAt = new Date().toISOString();
  const nowMs = Date.parse(observedAt);
  for (const attempt of eligible) {
    try {
      const before = attempt.completedAt ?? attempt.createdAt;
      const latestFeedback = deps.engagement.listFeedbackForDraft
        ? null
        : await deps.engagement.findLatestFeedback?.(attempt.organisationId, attempt.draftId, before) ?? null;
      const feedbackCandidates = deps.engagement.listFeedbackForDraft
        ? await deps.engagement.listFeedbackForDraft(attempt.organisationId, attempt.draftId, before, 20)
        : latestFeedback ? [latestFeedback] : [];
      const publishedFingerprint = typeof attempt.providerMetadata.publishedPayloadFingerprint === "string"
        ? attempt.providerMetadata.publishedPayloadFingerprint : null;
      let selectedFeedback = null as (typeof feedbackCandidates)[number] | null;
      let recommendation: EngagementRecommendation | null = null;
      for (const feedback of feedbackCandidates) {
        if (feedback.action !== "selected" || !feedback.captionSnapshot || !publishedFingerprint) continue;
        const fingerprint = engagementPayloadFingerprint(feedback.captionSnapshot, feedback.hashtagSnapshot);
        if (fingerprint !== publishedFingerprint) continue;
        const candidate = await deps.engagement.findById?.(attempt.organisationId, feedback.recommendationId) ?? null;
        if (candidate?.platform !== attempt.platform) continue;
        selectedFeedback = feedback;
        recommendation = candidate;
        break;
      }
      const analytics = await deps.blotatoClient.getPostAnalytics(attempt.externalPostId!);
      const accountId = providerAccountId(attempt.providerMetadata);
      const snapshots = [...analytics.history, analytics.latest]
        .filter((snapshot) => isValidProviderTimestamp(snapshot.capturedAt, nowMs))
        .sort((a, b) => (b.capturedAt ?? observedAt).localeCompare(a.capturedAt ?? observedAt))
        .slice(0, MAX_PROVIDER_SNAPSHOTS_PER_POST);
      const seenKeys = new Set<string>();
      for (const snapshot of snapshots) {
        const rawMetrics = snapshot.metrics;
        // Provider analytics are social/intent signals only. Commercial
        // outcomes enter Genesis through explicit append-only operator records.
        const metrics = { ...normaliseEngagementMetrics(rawMetrics), enquiries: null, bookings: null };
        if (Object.values(metrics).every((value) => value === null)) { result.skipped += 1; continue; }
        const providerSnapshotKey = `blotato:${accountId ?? "unknown-account"}:${attempt.externalPostId}:${snapshot.capturedAt ?? "undated"}:${stableMetricKey(rawMetrics)}`;
        if (seenKeys.has(providerSnapshotKey)) continue;
        seenKeys.add(providerSnapshotKey);
        const inserted = await deps.engagement.createMetricSnapshot({
          organisationId: attempt.organisationId, draftId: attempt.draftId,
          publishingAttemptId: attempt.id, recommendationId: recommendation?.id ?? null,
          feedbackEventId: selectedFeedback?.id ?? null, selectedVariant: selectedFeedback?.variant ?? null,
          platform: attempt.platform,
          objectiveType: recommendation?.objectiveType ?? "engagement" as EngagementObjectiveType,
          providerAccountId: accountId,
          externalPostId: attempt.externalPostId!,
          providerSnapshotKey,
          observedAt, providerCapturedAt: snapshot.capturedAt,
          measurementWindow: measurementWindow(attempt.completedAt, snapshot.capturedAt, observedAt),
          metrics, rawMetrics,
        });
        if (inserted.created) result.recorded += 1;
        else result.alreadyRecorded += 1;
      }
    } catch (error) {
      console.error("[genesis] engagement analytics collection failed", { attemptId: attempt.id, error });
      result.failed += 1;
    }
  }
  return result;
}

export { MAX_PROVIDER_SNAPSHOTS_PER_POST };
