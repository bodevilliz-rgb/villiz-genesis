import "server-only";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { EngagementFeedbackWriteModel, EngagementMetricSnapshotWriteModel, EngagementRecommendationWriteModel } from "@/core/domain/entities/engagement";
import type { Json } from "@/infrastructure/supabase/database.types";
import type { GenesisClient } from "@/infrastructure/supabase/server-client";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import type { EngagementObjectiveType } from "@/core/domain/entities/engagement";
import { toEngagementFeedbackEvent, toEngagementMetricSnapshot, toEngagementRecommendation } from "@/infrastructure/mappers/engagement-mapper";
import { translateError, unwrap } from "./errors";

export class SupabaseEngagementRepository implements EngagementRepository {
  constructor(private readonly client: GenesisClient) {}

  async create(input: EngagementRecommendationWriteModel) {
    const result = await this.client
      .from("engagement_recommendations")
      .insert({
        organisation_id: input.organisationId,
        draft_id: input.draftId,
        draft_version: input.draftVersion,
        platform: input.platform,
        objective_type: input.objectiveType,
        objective: input.objective,
        data_basis: input.dataBasis,
        recommended_caption: input.recommendedCaption,
        alternative_captions: input.alternativeCaptions,
        hook: input.hook,
        cta: input.cta,
        hashtag_groups: input.hashtags as unknown as Json,
        rationale: input.rationale,
        predicted_strengths: input.predictedStrengths,
        limitations: input.limitations,
        creative_guidance: input.creativeGuidance as unknown as Json,
        confidence: input.confidence,
        performance_confidence: input.performanceConfidence,
        performance_summary: input.performanceSummary as unknown as Json,
        evidence: input.evidence as unknown as Json,
        created_by: input.createdBy,
      })
      .select("*")
      .single();

    return toEngagementRecommendation(unwrap(result, "Engagement recommendation"));
  }

  async findLatest(organisationId: string, draftId: string) {
    const { data, error } = await this.client
      .from("engagement_recommendations")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) translateError(error, "Engagement recommendation");
    return data ? toEngagementRecommendation(data) : null;
  }

  async findById(organisationId: string, recommendationId: string) {
    const { data, error } = await this.client.from("engagement_recommendations").select("*")
      .eq("organisation_id", organisationId).eq("id", recommendationId).maybeSingle();
    if (error) translateError(error, "Engagement recommendation");
    return data ? toEngagementRecommendation(data) : null;
  }

  async createFeedback(input: EngagementFeedbackWriteModel) {
    const result = await this.client.from("engagement_feedback_events").insert({
      organisation_id: input.organisationId, draft_id: input.draftId,
      recommendation_id: input.recommendationId, action: input.action, variant: input.variant,
      caption_snapshot: input.captionSnapshot, hashtag_snapshot: input.hashtagSnapshot,
      reason: input.reason, created_by: input.createdBy,
    }).select("*").single();
    return toEngagementFeedbackEvent(unwrap(result, "Engagement feedback"));
  }

  async findLatestFeedback(organisationId: string, draftId: string, before?: string) {
    let query = this.client.from("engagement_feedback_events").select("*")
      .eq("organisation_id", organisationId).eq("draft_id", draftId);
    if (before) query = query.lte("created_at", before);
    const { data, error } = await query.order("created_at", { ascending: false })
      .order("id", { ascending: false }).limit(1).maybeSingle();
    if (error) translateError(error, "Engagement feedback");
    return data ? toEngagementFeedbackEvent(data) : null;
  }

  async listFeedbackForDraft(organisationId: string, draftId: string, before: string, limit: number) {
    const { data, error } = await this.client.from("engagement_feedback_events").select("*")
      .eq("organisation_id", organisationId).eq("draft_id", draftId).eq("action", "selected")
      .lte("created_at", before).order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 20));
    if (error) translateError(error, "Engagement feedback attribution candidates");
    return (data ?? []).map(toEngagementFeedbackEvent);
  }

  async listMetricSnapshots(organisationId: string, platform: CampaignPlatform, objectiveType: EngagementObjectiveType, providerAccountId: string) {
    const { data, error } = await this.client.from("engagement_metric_snapshots").select("*")
      .eq("organisation_id", organisationId).eq("platform", platform).eq("objective_type", objectiveType)
      .eq("provider_account_id", providerAccountId)
      .order("observed_at", { ascending: false }).limit(250);
    if (error) translateError(error, "Engagement metrics");
    return (data ?? []).map(toEngagementMetricSnapshot);
  }

  async listMetricSnapshotsForDraft(organisationId: string, draftId: string) {
    const { data, error } = await this.client.from("engagement_metric_snapshots").select("*")
      .eq("organisation_id", organisationId).eq("draft_id", draftId)
      .order("observed_at", { ascending: false }).limit(100);
    if (error) translateError(error, "Engagement draft metrics");
    return (data ?? []).map(toEngagementMetricSnapshot);
  }

  async createMetricSnapshot(input: EngagementMetricSnapshotWriteModel) {
    const metrics = input.metrics;
    const existing = await this.client.from("engagement_metric_snapshots").select("*")
      .eq("organisation_id", input.organisationId).eq("provider_snapshot_key", input.providerSnapshotKey).maybeSingle();
    if (existing.error) translateError(existing.error, "Engagement metric snapshot");
    if (existing.data) return { snapshot: toEngagementMetricSnapshot(existing.data), created: false };
    const values = {
      organisation_id: input.organisationId, draft_id: input.draftId,
      publishing_attempt_id: input.publishingAttemptId, recommendation_id: input.recommendationId,
      feedback_event_id: input.feedbackEventId, selected_variant: input.selectedVariant,
      platform: input.platform, objective_type: input.objectiveType,
      provider_account_id: input.providerAccountId,
      external_post_id: input.externalPostId, provider_snapshot_key: input.providerSnapshotKey,
      observed_at: input.observedAt, provider_captured_at: input.providerCapturedAt,
      views: metrics.views ?? null, reach: metrics.reach ?? null, impressions: metrics.impressions ?? null,
      likes: metrics.likes ?? null, comments: metrics.comments ?? null, shares: metrics.shares ?? null,
      saves: metrics.saves ?? null, clicks: metrics.clicks ?? null, profile_visits: metrics.profileVisits ?? null,
      enquiries: metrics.enquiries ?? null, bookings: metrics.bookings ?? null,
      watch_time_ms: metrics.watchTimeMs ?? null, raw_metrics: input.rawMetrics as unknown as Json,
    };
    const result = await this.client.from("engagement_metric_snapshots").insert(values).select("*").single();
    if (result.error?.code === "23505") {
      const concurrent = await this.client.from("engagement_metric_snapshots").select("*")
        .eq("organisation_id", input.organisationId).eq("provider_snapshot_key", input.providerSnapshotKey).single();
      return { snapshot: toEngagementMetricSnapshot(unwrap(concurrent, "Engagement metric snapshot")), created: false };
    }
    return { snapshot: toEngagementMetricSnapshot(unwrap(result, "Engagement metric snapshot")), created: true };
  }
}
