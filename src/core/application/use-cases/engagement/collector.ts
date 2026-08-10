import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { PublishingRepository } from "@/core/application/ports/publishing-port";
import type { EngagementObjectiveType } from "@/core/domain/entities/engagement";
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
  skipped: number;
  failed: number;
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

export async function collectEngagementAnalytics(
  deps: CollectorDeps,
  input: { organisationId?: string; draftId?: string; limit?: number } = {},
): Promise<EngagementCollectionResult> {
  const attempts = await deps.publishing.listAttemptsForAnalytics(input.organisationId, {});
  const eligible = attempts
    .filter((attempt) => attempt.status === "completed" && attempt.externalPostId
      && !isSimulatedPublishingAttempt(attempt) && (!input.draftId || attempt.draftId === input.draftId))
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
    .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50));
  const result: EngagementCollectionResult = { checked: eligible.length, recorded: 0, skipped: 0, failed: 0 };
  if (!deps.blotatoClient.getPostAnalytics || !deps.engagement.createMetricSnapshot) {
    return { ...result, skipped: eligible.length };
  }
  for (const attempt of eligible) {
    try {
      const feedback = await deps.engagement.findLatestFeedback?.(
        attempt.organisationId, attempt.draftId, attempt.completedAt ?? attempt.createdAt,
      ) ?? null;
      const candidateFeedback = feedback?.action === "selected" ? feedback : null;
      const publishedFingerprint = typeof attempt.providerMetadata.publishedPayloadFingerprint === "string"
        ? attempt.providerMetadata.publishedPayloadFingerprint : null;
      const candidateFingerprint = candidateFeedback?.captionSnapshot
        ? engagementPayloadFingerprint(candidateFeedback.captionSnapshot, candidateFeedback.hashtagSnapshot) : null;
      const fingerprintMatchedFeedback = publishedFingerprint && candidateFingerprint === publishedFingerprint ? candidateFeedback : null;
      const candidateRecommendation = fingerprintMatchedFeedback
        ? await deps.engagement.findById?.(attempt.organisationId, fingerprintMatchedFeedback.recommendationId) ?? null
        : null;
      const recommendation = candidateRecommendation?.platform === attempt.platform ? candidateRecommendation : null;
      const selectedFeedback = recommendation ? fingerprintMatchedFeedback : null;
      const analytics = await deps.blotatoClient.getPostAnalytics(attempt.externalPostId!);
      const snapshots = [...analytics.history, analytics.latest];
      const seenKeys = new Set<string>();
      for (const snapshot of snapshots) {
        const rawMetrics = snapshot.metrics;
        const metrics = normaliseEngagementMetrics(rawMetrics);
        if (Object.values(metrics).every((value) => value === null)) { result.skipped += 1; continue; }
        const providerSnapshotKey = `blotato:${attempt.externalPostId}:${snapshot.capturedAt ?? "undated"}:${stableMetricKey(rawMetrics)}`;
        if (seenKeys.has(providerSnapshotKey)) continue;
        seenKeys.add(providerSnapshotKey);
        await deps.engagement.createMetricSnapshot({
          organisationId: attempt.organisationId, draftId: attempt.draftId,
          publishingAttemptId: attempt.id, recommendationId: recommendation?.id ?? null,
          feedbackEventId: selectedFeedback?.id ?? null, selectedVariant: selectedFeedback?.variant ?? null,
          platform: attempt.platform,
          objectiveType: recommendation?.objectiveType ?? "engagement" as EngagementObjectiveType,
          externalPostId: attempt.externalPostId!,
          providerSnapshotKey,
          observedAt: new Date().toISOString(), providerCapturedAt: snapshot.capturedAt,
          metrics, rawMetrics,
        });
        result.recorded += 1;
      }
    } catch (error) {
      console.error("[genesis] engagement analytics collection failed", { attemptId: attempt.id, error });
      result.failed += 1;
    }
  }
  return result;
}
