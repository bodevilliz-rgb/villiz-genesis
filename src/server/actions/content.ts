"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "../container";
import {
  createDraft,
  createGenerationRequest,
  updateDraft,
  scheduleDraft,
  publishDraft,
  archiveDraft,
  duplicateDraft,
} from "@/core/application/use-cases/content";
import { errorState, successState, textOrEmpty, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";
import type { AwoGenerationAttribution, EngagementObjectiveType, EngagementStrategyMetadata } from "@/core/domain/entities/engagement";
import { toBlotatoPlatform } from "@/core/domain/entities/blotato";
import { DISTRIBUTION_READINESS_THRESHOLD, VISIBILITY_STRATEGY_VERSION } from "@/core/application/use-cases/market-intelligence/visibility";
import { isPublishingPlatform } from "@/core/domain/entities/publishing";
import { buildApprovedPillarChoices, PILLAR_CHOICE_CONTRACT_VERSION } from "./awo-grounding";

function contentDeps(context: Awaited<ReturnType<typeof requireContext>>) {
  return {
    actor: context.actor,
    content: context.content,
    membrain: context.membrain,
    organisations: context.organisations,
  };
}

function parseHashtagsField(formData: FormData): string[] {
  const raw = formData.get("hashtags");
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function draftFormPayload(formData: FormData) {
  return {
    organisationId: textOrEmpty(formData, "organisationId"),
    title: textOrEmpty(formData, "title"),
    contentType: textOrEmpty(formData, "contentType") || "social_post",
    categoryId: textOrEmpty(formData, "categoryId"),
    campaignId: textOrEmpty(formData, "campaignId"),
    summary: textOrEmpty(formData, "summary"),
    body: textOrEmpty(formData, "body"),
    hashtags: parseHashtagsField(formData),
  };
}

const awoAttributionSchema = z.object({
  caption: z.string().min(1).max(5000),
  platform: z.enum(["linkedin", "facebook", "instagram", "x", "tiktok"]),
  destinationAccountId: z.string().min(1).max(300).nullable(),
  mediaAssetIds: z.array(z.string().uuid()).max(20),
  commercialIntent: z.enum(["convert", "engage", "build_trust"]),
  commercialIntentSource: z.enum(["operator", "recommended"]),
  culturalVoiceLevel: z.enum(["neutral", "conversational", "light_naija"]),
  visibilityPlan: z.object({
    goal: z.enum(["convert", "engage", "build_trust"]),
    contentJob: z.enum(["DISCOVERY", "AUTHORITY", "PROOF", "CONVERSION"]),
    contentPillar: z.string().max(500),
    contentFormat: z.enum(["short_form_video", "carousel", "single_image", "supporting_story", "text_led", "other_supported"]),
    hookStrategy: z.string().min(1).max(100),
    actualHook: z.string().min(1).max(500),
    ctaStrategy: z.string().min(1).max(1000),
    discoveryStrategy: z.string().min(1).max(2000),
    targetLocalities: z.array(z.string().min(1).max(200)).max(50),
    platformStrategy: z.string().min(1).max(2000),
    discoveryRoles: z.array(z.enum(["local", "service", "audience_cultural", "occasion_topic", "campaign", "brand"])).max(6),
    distributionReadinessScore: z.number().int().min(0).max(100),
    distributionGate: z.enum(["pass", "blocked"]),
    distributionBlockers: z.array(z.string().min(1).max(500)).max(20),
    measurementPlan: z.string().min(1).max(2000),
    supportingDistributionActions: z.array(z.string().max(1000)).max(10),
    visibilityEvidenceLevel: z.enum(["CLIENT_EVIDENCE", "MARKET_EVIDENCE", "FOUNDATION_HYPOTHESIS", "FOUNDATION_AND_MARKET", "MARKET_PATTERN", "VERTICAL_HYPOTHESIS", "GENERAL_PLATFORM_OPTION", "INSUFFICIENT_EVIDENCE"]),
    evidenceSources: z.array(z.string().max(300)).max(50),
    confidence: z.number().int().min(0).max(100),
    foundationVersion: z.string().min(1).max(200),
    rationale: z.string().min(1).max(2000),
  }).passthrough(),
  suggestedHashtags: z.array(z.string().max(100)).max(30),
  pillarSourceEntryId: z.string().uuid().nullable().optional().default(null),
  pillarSemanticLabel: z.string().min(1).max(200).nullable().optional().default(null),
  pillarChoiceVersion: z.literal(PILLAR_CHOICE_CONTRACT_VERSION).nullable().optional().default(null),
});

function parseAwoAttribution(formData: FormData): AwoGenerationAttribution | null {
  const raw = formData.get("awoAttribution");
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (raw.length > 100_000) throw new Error("The Awo attribution payload is too large.");
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { throw new Error("The Awo attribution payload could not be understood."); }
  const parsed = awoAttributionSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("The Awo attribution payload is incomplete.");
  return parsed.data as unknown as AwoGenerationAttribution;
}

async function persistAwoAttribution(
  context: Awaited<ReturnType<typeof requireContext>>,
  draft: { id: string; organisationId: string; version: number; body: string; hashtags: string[] },
  attribution: AwoGenerationAttribution | null,
) {
  if (!attribution) return;
  const plan = attribution.visibilityPlan;
  if (plan.goal !== attribution.commercialIntent) throw new Error("The Awo goal attribution is inconsistent.");
  if (plan.distributionGate !== "pass"
    || plan.distributionReadinessScore < DISTRIBUTION_READINESS_THRESHOLD
    || plan.distributionBlockers.length > 0) {
    throw new Error(`Awo Audience Distribution Gate blocked this post (${plan.distributionReadinessScore}/100): ${plan.distributionBlockers.join(" ") || "regenerate after completing the required strategy inputs."}`);
  }
  if (!isPublishingPlatform(attribution.platform)) throw new Error("The attributed destination platform is not supported for publishing.");
  if (["instagram", "facebook", "tiktok"].includes(attribution.platform)) {
    const suggested = new Set(attribution.suggestedHashtags.map((tag) => tag.replace(/^#/, "").toLocaleLowerCase()));
    const applied = new Set(draft.hashtags.map((tag) => tag.replace(/^#/, "").toLocaleLowerCase()));
    if (suggested.size < 2 || [...suggested].some((tag) => !applied.has(tag))) {
      throw new Error("Apply the complete Awo-supported local and service discovery hashtag set before saving this post.");
    }
  }

  if (attribution.destinationAccountId) {
    const active = await context.blotatoAccounts.findActiveForOrganisationAndPlatform(toBlotatoPlatform(attribution.platform), draft.organisationId);
    if (!active.some((account) => account.id === attribution.destinationAccountId)) {
      throw new Error("The attributed destination is inactive or does not belong to this organisation.");
    }
  }
  const visibleAssets = await context.media.listAssets(draft.organisationId, { isArchived: false });
  const allowedAssetIds = new Set(visibleAssets.map((asset) => asset.id));
  if (attribution.mediaAssetIds.some((id) => !allowedAssetIds.has(id))) throw new Error("The attributed media does not belong to this organisation.");

  let pillarEvidence: { sourceType: "membrain_entry"; sourceId: string; title: string; categoryKey: string; version: number } | null = null;
  if (attribution.pillarSourceEntryId || attribution.pillarSemanticLabel || attribution.pillarChoiceVersion) {
    if (!attribution.pillarSourceEntryId || !attribution.pillarSemanticLabel || attribution.pillarChoiceVersion !== PILLAR_CHOICE_CONTRACT_VERSION) {
      throw new Error("The Awo pillar attribution is incomplete.");
    }
    const sourceEntry = await context.membrain.findEntry(draft.organisationId, attribution.pillarSourceEntryId);
    if (!sourceEntry || sourceEntry.status !== "active" || sourceEntry.category?.key !== "content_pillars") {
      throw new Error("The attributed MemBrain pillar source is inactive or does not belong to this organisation.");
    }
    const stillApproved = buildApprovedPillarChoices([sourceEntry]).some((choice) => choice.label === attribution.pillarSemanticLabel);
    if (!stillApproved || plan.contentPillar !== attribution.pillarSemanticLabel) {
      throw new Error("The attributed MemBrain pillar is stale or inconsistent.");
    }
    pillarEvidence = { sourceType: "membrain_entry", sourceId: sourceEntry.id, title: attribution.pillarSemanticLabel, categoryKey: "content_pillars", version: sourceEntry.version };
  }

  const objectiveType: EngagementObjectiveType = attribution.commercialIntent === "convert" ? "enquiries" : attribution.commercialIntent === "build_trust" ? "awareness" : "engagement";
  const strategyMetadata: EngagementStrategyMetadata = {
    commercialIntent: attribution.commercialIntent,
    commercialIntentSource: attribution.commercialIntentSource,
    contentJob: plan.contentJob,
    hookFamily: plan.hookStrategy,
    actualHook: plan.actualHook,
    ctaType: attribution.commercialIntent === "convert" ? "conversion" : attribution.commercialIntent === "build_trust" ? "trust_step" : "conversation",
    contentPillar: plan.contentPillar,
    destinationAccountId: attribution.destinationAccountId,
    destinationPlatform: attribution.platform,
    marketPatternIds: plan.evidenceSources.filter((source) => source.startsWith("market-pattern:")).map((source) => source.slice("market-pattern:".length)),
    hashtagRoleMix: plan.discoveryRoles,
    culturalVoiceLevel: attribution.culturalVoiceLevel,
    contentFormat: plan.contentFormat,
    visibilityStrategyVersion: VISIBILITY_STRATEGY_VERSION,
    visibilityEvidenceLevel: plan.visibilityEvidenceLevel,
    foundationVersion: plan.foundationVersion,
    growthDecisionEvidenceSources: plan.evidenceSources,
    discoveryStrategy: plan.discoveryStrategy,
    measurementPlan: plan.measurementPlan,
    supportingDistributionActions: plan.supportingDistributionActions,
    pillarSourceEntryId: attribution.pillarSourceEntryId,
    pillarSemanticLabel: attribution.pillarSemanticLabel,
    pillarChoiceVersion: attribution.pillarChoiceVersion,
  };
  const recommendation = await context.engagement.create({
    organisationId: draft.organisationId,
    draftId: draft.id,
    draftVersion: draft.version,
    platform: attribution.platform,
    objectiveType,
    objective: plan.contentJob,
    dataBasis: plan.visibilityEvidenceLevel === "CLIENT_EVIDENCE" ? "performance_informed" : "brand_only",
    recommendedCaption: attribution.caption,
    alternativeCaptions: [attribution.caption],
    hook: plan.actualHook,
    cta: plan.ctaStrategy,
    // Suggested hashtags remain optional until the operator accepts them.
    // Attribute only the hashtags actually persisted with this draft so the
    // immutable recommendation snapshot cannot claim an unselected suggestion.
    hashtags: { brand: [], local: [], service: [], audience: draft.hashtags },
    rationale: plan.rationale,
    predictedStrengths: [`${plan.contentFormat} using ${plan.hookStrategy}`],
    limitations: [plan.visibilityEvidenceLevel === "CLIENT_EVIDENCE" ? "Attributed client evidence is directional, not causal." : "This recommendation is a labelled hypothesis, not performance proof."],
    creativeGuidance: { mediaBasis: attribution.mediaAssetIds.length ? "metadata_only" : "none", visualHook: plan.actualHook, formatRecommendation: plan.contentFormat, shareTrigger: plan.supportingDistributionActions.join(" ") || "No supporting distribution action recorded.", saveTrigger: plan.measurementPlan, accessibilityNote: "Use accurate alt text for attached visual media.", visibilityPlan: plan },
    confidence: plan.confidence,
    performanceConfidence: plan.visibilityEvidenceLevel === "CLIENT_EVIDENCE" ? plan.confidence : null,
    performanceSummary: { sampleSize: 0, minimumSampleSize: 10, directionalScore: null, label: plan.visibilityEvidenceLevel === "CLIENT_EVIDENCE" ? "performance_informed" : "insufficient_data", championVariant: null, challengerVariant: null, variantScores: {} },
    evidence: [
      ...(pillarEvidence ? [pillarEvidence] : []),
      ...attribution.mediaAssetIds.map((id) => ({ sourceType: "media_asset" as const, sourceId: id, title: "Selected draft media" })),
    ],
    strategyMetadata,
    createdBy: context.actor.id,
  });
  await context.engagement.applyRecommendation({ organisationId: draft.organisationId, draftId: draft.id, recommendationId: recommendation.id, variant: draft.body === attribution.caption ? "recommended" : "custom", captionSnapshot: draft.body, hashtagSnapshot: draft.hashtags });
}

function revalidateContent(organisationId: string, draftId?: string) {
  revalidatePath(routes.organisations.content.index(organisationId));
  revalidatePath(routes.organisations.detail(organisationId));
  revalidatePath(routes.dashboard);
  revalidatePath(routes.review);
  revalidatePath(routes.organisations.campaigns.index(organisationId));
  if (draftId) {
    revalidatePath(routes.organisations.content.draft(organisationId, draftId));
    revalidatePath(routes.reviewWorkspace(draftId));
  }
}

export async function createDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const draft = await createDraft(contentDeps(context), draftFormPayload(formData));
    await persistAwoAttribution(context, draft, parseAwoAttribution(formData));

    revalidateContent(draft.organisationId, draft.id);
    return successState("Draft created.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const draft = await updateDraft(contentDeps(context), {
      ...draftFormPayload(formData),
      id: textOrEmpty(formData, "id"),
      changeSummary: textOrEmpty(formData, "changeSummary"),
    });
    await persistAwoAttribution(context, draft, parseAwoAttribution(formData));

    revalidateContent(draft.organisationId, draft.id);
    revalidatePath(routes.organisations.content.history(draft.organisationId, draft.id));
    return successState(`Saved as version ${draft.version}.`, draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function createGenerationRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const context = await requireContext();
    const request = await createGenerationRequest(contentDeps(context), {
      organisationId: textOrEmpty(formData, "organisationId"),
      draftId: textOrEmpty(formData, "draftId"),
      brief: textOrEmpty(formData, "brief"),
      targetAudience: textOrEmpty(formData, "targetAudience"),
      tone: textOrEmpty(formData, "tone"),
      contentPillarCategoryId: textOrEmpty(formData, "contentPillarCategoryId"),
    });

    revalidateContent(request.organisationId, request.draftId);
    return successState("Generation request sent to Awo. This draft is now ready for Awo.", request.draftId);
  } catch (error) {
    return errorState(error);
  }
}

export async function scheduleDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");
    const scheduledAt = textOrEmpty(formData, "scheduledAt");
    const platform = textOrEmpty(formData, "platform");
    const timezone = textOrEmpty(formData, "timezone");

    if (!scheduledAt || !platform || !timezone) {
      throw new Error("Missing scheduling details.");
    }

    const draft = await scheduleDraft(contentDeps(context), organisationId, draftId, {
      scheduledAt,
      platform,
      timezone,
    });

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content scheduled successfully.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function publishDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");

    const draft = await publishDraft(contentDeps(context), organisationId, draftId);

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content marked as published.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function archiveDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");

    const draft = await archiveDraft(contentDeps(context), organisationId, draftId);

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content archived.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function duplicateDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");

    const draft = await duplicateDraft(contentDeps(context), organisationId, draftId);

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content duplicated.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}
