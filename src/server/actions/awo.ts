"use server";

import { z } from "zod";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import { applyEngagementRecommendation, generateEngagementRecommendation, getEngagementLearningOverview, recordEngagementCommercialOutcome, recordEngagementFeedback } from "@/core/application/use-cases/engagement";
import { collectEngagementAnalytics, type EngagementCollectionResult } from "@/core/application/use-cases/engagement/collector";
import type { AwoGenerationAttribution, EngagementFeedbackEvent, EngagementLearningOverview, EngagementObjectiveType, EngagementRecommendation } from "@/core/domain/entities/engagement";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import { isDomainError } from "@/core/domain/errors";
import { canWriteContent } from "@/core/domain/entities/identity";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { SupabaseEngagementRepository } from "@/infrastructure/repositories/supabase-engagement-repository";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";
import { HttpBlotatoClient } from "@/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { requireContext } from "../container";
import {
  extractAwoMembrainContext,
  buildCaptionSystemPrompt,
  buildRewriteSystemPrompt,
  buildApprovedPillarChoices,
  classifyContentIntent,
  PILLAR_CHOICE_CONTRACT_VERSION,
  resolveApprovedPillarChoice,
  type GenerationIntentHints,
  type GenerationGuidedContext,
} from "./awo-grounding";
import {
  detectComplianceViolations,
  repairComplianceViolations,
} from "@/core/application/use-cases/generation/compliance";
import { assembleMarketGenerationContext, rejectsCompetitorImitation } from "@/core/application/use-cases/market-intelligence/context";
import { buildVisibilityPlan, BUYER_ORIENTATION_CONTRACT, deriveClientVisibilityEvidence, visibilityPlanPrompt } from "@/core/application/use-cases/market-intelligence/visibility";
import type { EngagementVisibilityPlan } from "@/core/domain/entities/engagement";
import type { CommercialIntent, CulturalVoiceLevel } from "@/core/domain/entities/market-intelligence";
import { filterUnsupportedOccasionHashtags, growthOutputViolations } from "@/core/application/use-cases/market-intelligence/growth-output-guard";
import { toBlotatoPlatform } from "@/core/domain/entities/blotato";
import { isPublishingPlatform } from "@/core/domain/entities/publishing";

const mediaDecisionSchema = z.object({
  assetType: z.string().max(80),
  subjectStructure: z.string().max(160),
  visualStyle: z.string().max(200),
  setting: z.string().max(200),
  dominantConcept: z.string().max(240),
  moodVisualEnergy: z.string().max(200),
  stylingWardrobe: z.string().max(240),
  propsVisualDevices: z.string().max(240),
  compositionPresentation: z.string().max(240),
  formatOpportunities: z.array(z.string().max(120)).max(4),
  potentialContentTerritory: z.string().max(240),
  evidenceLimitations: z.string().max(300),
  selectedPillarChoiceId: z.string().regex(/^P[1-9]\d*$/).max(20),
  pillarRationale: z.string().max(300),
  narrowedTargetAudience: z.string().max(300),
  hookFamily: z.enum(["outcome_led", "transformation", "curiosity", "confidence", "educational", "social_proof", "occasion_milestone", "problem_solution", "authority", "story", "question", "proof_result"]),
  actualHook: z.string().min(3).max(240),
});

type MediaDecision = z.infer<typeof mediaDecisionSchema>;

function renderMediaObservation(decision: MediaDecision): string {
  return [
    `Asset type: ${decision.assetType}`,
    `Subject structure: ${decision.subjectStructure}`,
    `Visual style: ${decision.visualStyle}`,
    `Setting: ${decision.setting}`,
    `Dominant concept: ${decision.dominantConcept}`,
    `Mood / visual energy: ${decision.moodVisualEnergy}`,
    `Styling / wardrobe: ${decision.stylingWardrobe}`,
    `Props / visual devices: ${decision.propsVisualDevices}`,
    `Composition / presentation: ${decision.compositionPresentation}`,
    `Format opportunities: ${decision.formatOpportunities.join(", ") || "None safely identified"}`,
    `Potential content territory: ${decision.potentialContentTerritory}`,
    `Evidence limitations: ${decision.evidenceLimitations}`,
  ].join("\n");
}

const MEDIA_SAFETY_PROMPT = `Analyse only visible, marketing-relevant image evidence. Never identify a person or infer race, ethnicity, religion, politics, health, sexual orientation, exact age, profession, location, exact occasion, cultural identity, testimonial sentiment, customer satisfaction or commercial results. Describe clothing visually without assigning cultural identity. Balloons may be celebratory elements but do not prove a birthday. Do not invent an established client process. Select one narrow, defensible primary audience for this asset using the brief, visible concept, approved pillar and supplied client truth; state uncertainty rather than expanding to an audience or service catalogue. Choose one attention mechanism and generate one actual hook with tension, curiosity, desire, identity, objection resolution, emotion, proof or usefulness. Never begin the hook with "Ready for", "Looking for", "Capture your", "Create memories" or "Bring your vision to life". Every field must distinguish visible evidence from uncertainty.\n\n${BUYER_ORIENTATION_CONTRACT}`;

function marketPlatform(value: string): CampaignPlatform {
  return (["instagram", "facebook", "linkedin", "x", "tiktok", "youtube", "pinterest", "threads"] as const).find((item) => item === value) ?? "instagram";
}

/**
 * Runs post-generation compliance: detects prohibited terms from MemBrain
 * restrictions and attempts coherence-safe lexical repair.
 *
 * Returns:
 *   { text }                         — clean, no violations detected
 *   { text: repaired }               — violations found and safely repaired
 *   { text: original, warning }      — violations found but repair was unsafe;
 *                                      caller must surface the warning
 */
function applyComplianceCheck(
  text: string,
  restrictions: string[],
): { text: string; complianceWarning?: string } {
  if (restrictions.length === 0) return { text };

  const violations = detectComplianceViolations(text, restrictions);
  if (violations.length === 0) return { text };

  const repairResult = repairComplianceViolations(text, violations);
  if (repairResult.safe) {
    return { text: repairResult.body };
  }

  return {
    text,
    complianceWarning: `REVIEW REQUIRED: Found prohibited term(s) (${violations.join(", ")}) that could not be automatically repaired. This output must be reviewed before use.`,
  };
}

export type EngagementRecommendationActionResult =
  | { ok: true; recommendation: EngagementRecommendation; learningOverview: EngagementLearningOverview }
  | { ok: false; error: string };

export async function generateEngagementRecommendationAction(input: {
  organisationId: string;
  draftId: string;
  platform: string;
  objectiveType?: string;
  objective?: string;
  commercialIntent?: "convert" | "engage" | "build_trust";
  culturalVoiceLevel?: "neutral" | "conversational" | "light_naija";
}): Promise<EngagementRecommendationActionResult> {
  try {
    const context = await requireContext();
    const recommendation = await generateEngagementRecommendation(
      {
        actor: context.actor,
        organisations: context.organisations,
        campaigns: context.campaigns,
        content: context.content,
        membrain: context.membrain,
        engagement: context.engagement,
        blotatoAccounts: context.blotatoAccounts,
        media: context.media,
        ai: getAIProvider(),
        marketIntelligence: context.marketIntelligence,
      },
      input,
    );
    const learningOverview = await getEngagementLearningOverview({
      actor: context.actor,
      organisations: context.organisations,
      engagement: context.engagement,
      blotatoAccounts: context.blotatoAccounts,
      publishing: context.publishing,
    }, {
      organisationId: input.organisationId,
      draftId: input.draftId,
      platform: recommendation.platform,
      objectiveType: recommendation.objectiveType,
    });
    return { ok: true, recommendation, learningOverview };
  } catch (error) {
    console.error("[genesis] engagement recommendation failed", error);
    return {
      ok: false,
      error: isDomainError(error)
        ? error.message
        : "AWO could not generate an engagement recommendation. Try again shortly.",
    };
  }
}

export async function applyEngagementRecommendationAction(input: {
  organisationId: string;
  draftId: string;
  recommendationId: string;
  variant: "recommended" | "alternative_1" | "alternative_2" | "custom";
  captionSnapshot: string;
  hashtagSnapshot: string[];
}): Promise<{ ok: true; feedback: EngagementFeedbackEvent; draftVersion: number } | { ok: false; error: string }> {
  try {
    const context = await requireContext();
    const result = await applyEngagementRecommendation({
      actor: context.actor, organisations: context.organisations,
      engagement: context.engagement, content: context.content,
    }, { ...input, action: "selected" });
    return { ok: true, feedback: result.feedback, draftVersion: result.draftVersion };
  } catch (error) {
    console.error("[genesis] engagement recommendation apply failed", error);
    return { ok: false, error: isDomainError(error) ? error.message : "AWO could not apply that recommendation." };
  }
}

export async function recordEngagementFeedbackAction(input: {
  organisationId: string;
  draftId: string;
  recommendationId: string;
  action: "selected" | "dismissed";
  variant: "recommended" | "alternative_1" | "alternative_2" | "custom" | null;
  captionSnapshot: string | null;
  hashtagSnapshot: string[];
  reason?: string | null;
}): Promise<{ ok: true; feedback: EngagementFeedbackEvent } | { ok: false; error: string }> {
  try {
    const context = await requireContext();
    const feedback = await recordEngagementFeedback({
      actor: context.actor, organisations: context.organisations, engagement: context.engagement, content: context.content,
    }, input);
    return { ok: true, feedback };
  } catch (error) {
    console.error("[genesis] engagement feedback failed", error);
    return { ok: false, error: isDomainError(error) ? error.message : "AWO could not record that choice." };
  }
}

export async function refreshEngagementAnalyticsAction(input: {
  organisationId: string;
  draftId: string;
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
}): Promise<{ ok: true; result: EngagementCollectionResult; learningOverview: EngagementLearningOverview } | { ok: false; error: string }> {
  try {
    const context = await requireContext();
    const role = await context.organisations.viewerRole(input.organisationId);
    if (!canWriteContent(context.actor, role)) return { ok: false, error: "Contributor or Lead access is required." };
    const draft = await context.content.findDraft(input.organisationId, input.draftId);
    if (!draft) return { ok: false, error: "Draft not found." };
    const admin = createAdminClient();
    const result = await collectEngagementAnalytics({
      publishing: new SupabasePublishingRepository(admin),
      engagement: new SupabaseEngagementRepository(admin),
      blotatoClient: new HttpBlotatoClient(blotatoConfig().apiKey),
    }, { organisationId: input.organisationId, draftId: input.draftId, limit: 10 });
    const learningOverview = await getEngagementLearningOverview({
      actor: context.actor,
      organisations: context.organisations,
      engagement: new SupabaseEngagementRepository(admin),
      blotatoAccounts: context.blotatoAccounts,
      publishing: context.publishing,
    }, input);
    return { ok: true, result, learningOverview };
  } catch (error) {
    console.error("[genesis] engagement analytics refresh failed", error);
    return { ok: false, error: "AWO could not refresh published-post analytics." };
  }
}

export async function recordEngagementCommercialOutcomeAction(input: {
  organisationId: string;
  draftId: string;
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
  enquiries: number;
  bookings: number;
  revenueMinor: number;
  currency: string;
  note?: string | null;
}): Promise<{ ok: true; learningOverview: EngagementLearningOverview } | { ok: false; error: string }> {
  try {
    const context = await requireContext();
    await recordEngagementCommercialOutcome({
      actor: context.actor, organisations: context.organisations,
      engagement: context.engagement, blotatoAccounts: context.blotatoAccounts,
      publishing: context.publishing,
    }, input);
    const learningOverview = await getEngagementLearningOverview({
      actor: context.actor, organisations: context.organisations,
      engagement: context.engagement, blotatoAccounts: context.blotatoAccounts,
      publishing: context.publishing,
    }, input);
    return { ok: true, learningOverview };
  } catch (error) {
    console.error("[genesis] commercial outcome record failed", error);
    return { ok: false, error: isDomainError(error) ? error.message : "AWO could not record that commercial outcome." };
  }
}

/**
 * Every Awo generation entry point must prove the actor can write content for
 * THIS organisation before assembling any context. Without this, a request for
 * an inaccessible organisation did not fail — RLS returned empty knowledge and
 * generation proceeded with zero grounding under the name "the organisation",
 * which is exactly the silent unsupported certainty the pipeline forbids.
 */
async function requireOrgWriteAccess(context: Awaited<ReturnType<typeof requireContext>>, organisationId: string) {
  const org = await context.organisations.findById(organisationId);
  if (!org) throw new Error("Awo cannot generate: this organisation was not found or you do not have access to it.");
  const role = await context.organisations.viewerRole(organisationId);
  if (!canWriteContent(context.actor, role)) throw new Error("Awo cannot generate: Contributor or Lead access to this organisation is required.");
  return org;
}

/** Surfaces the provider's real failure class without leaking credentials — a generic "failed" toast hid a billing outage for days. */
function describeProviderFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Awo's AI provider request failed: ${message.slice(0, 300)}`;
}

export async function generateCaption(
  organisationId: string,
  prompt: string,
  platform: string,
  intentHints?: GenerationIntentHints,
  guidedContext?: GenerationGuidedContext,
  commercialIntent?: CommercialIntent,
  culturalVoiceLevel?: CulturalVoiceLevel,
  mediaAssetIds: string[] = [],
  destinationAccountId?: string,
): Promise<{ text: string; complianceWarning?: string; visibilityPlan: EngagementVisibilityPlan; commercialIntent: CommercialIntent; commercialIntentSource: "operator" | "recommended"; culturalVoiceLevel: CulturalVoiceLevel; attribution: AwoGenerationAttribution }> {
  const context = await requireContext();
  const org = await requireOrgWriteAccess(context, organisationId);
  const orgName = org.name;

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const ctx = extractAwoMembrainContext(membrain);
  if (rejectsCompetitorImitation(prompt)) throw new Error("Awo can apply approved market patterns, but cannot imitate or copy a named competitor.");
  const intent = classifyContentIntent(prompt, ctx, intentHints ?? {});
  const resolvedPlatform = marketPlatform(platform);
  let resolvedDestinationAccountId: string | null = null;
  if (destinationAccountId) {
    if (!isPublishingPlatform(resolvedPlatform)) throw new Error("The selected destination is not supported for publishing.");
    const activeAccounts = await context.blotatoAccounts.findActiveForOrganisationAndPlatform(toBlotatoPlatform(resolvedPlatform), organisationId);
    const selectedAccount = activeAccounts.find((account) => account.id === destinationAccountId);
    if (!selectedAccount) throw new Error("The selected destination is inactive or does not belong to this organisation.");
    resolvedDestinationAccountId = selectedAccount.id;
  }
  // No silent goal default: when the operator chose "Awo recommends", the
  // deterministic recommendation inside the assembler decides — and the result
  // is reported back as commercialIntentSource so the UI can say so.
  const market = await assembleMarketGenerationContext({ marketIntelligence: context.marketIntelligence, organisationId, platform: resolvedPlatform, commercialIntent, culturalVoiceLevel });
  const selectedIdSet = new Set(mediaAssetIds);
  const selectedAssets = (await context.media.listAssets(organisationId, { isArchived: false })).filter((asset) => selectedIdSet.has(asset.id));
  const media = selectedAssets.map(({ mimeType, title, description, altText, tags }) => ({ mimeType, title, description, altText, tags }));
  const resolvedIntent = market.commercialIntent;
  const pillarEntries = membrain.groups.find((group) => group.category.key === "content_pillars")?.entries.filter((entry) => entry.status === "active") ?? [];
  const approvedPillarChoices = buildApprovedPillarChoices(pillarEntries);
  const ai = getAIProvider();
  let analysedMedia: MediaDecision | null = null;
  let mediaLimitation: string | null = null;
  const selectedImage = selectedAssets.find((asset) => asset.mimeType.startsWith("image/"));
  if (selectedImage) {
    if (!ai.analyzeImage || !context.storage.downloadMedia) {
      mediaLimitation = "ACTUAL IMAGE CONTENT NOT ANALYSED: the configured provider or storage adapter does not support request-scoped multimodal analysis.";
    } else {
      const imageBytes = await context.storage.downloadMedia(selectedImage.storagePath);
      const pillarOptions = approvedPillarChoices.map((choice) =>
        `- ${choice.choiceId} | ${choice.label}\n${choice.context}`,
      ).join("\n\n") || "- No active content-pillar choices are configured.";
      analysedMedia = await ai.analyzeImage(
        [
          "Inspect the attached image before the Growth Decision is made.",
          `Operator brief: ${prompt}`,
          `Resolved goal: ${resolvedIntent}`,
          `Configured audience context: ${market.targetAudience ?? "Not configured"}`,
          `Configured geography: ${[...market.targetGeographies, ...market.serviceAreas].join(", ") || "Not configured"}`,
          `Organisation industry: ${org.industry ?? "Not configured"}`,
          "Choose exactly one approved MemBrain pillar choice from this request-scoped list.",
          "Return its choice identifier in selectedPillarChoiceId. Do not return a pillar title as the identifier.",
          pillarOptions,
          market.enabled ? market.prompt : "No approved Market Intelligence profile is available.",
        ].join("\n\n"),
        { data: imageBytes, mediaType: selectedImage.mimeType },
        mediaDecisionSchema,
        { systemPrompt: MEDIA_SAFETY_PROMPT, temperature: 0.1 },
      );
    }
  } else if (selectedAssets.some((asset) => asset.mimeType.startsWith("video/"))) {
    mediaLimitation = "VIDEO CONTENT NOT ANALYSED: the current AGIE v1 multimodal path accepts still images only.";
  } else {
    mediaLimitation = "No image was selected before generation.";
  }

  const operatorPillar = guidedContext?.contentPillar?.trim() || null;
  const analysedPillarChoice = analysedMedia
    ? resolveApprovedPillarChoice(approvedPillarChoices, analysedMedia.selectedPillarChoiceId)
    : null;
  if (!operatorPillar && analysedMedia && !analysedPillarChoice) throw new Error("Awo returned an unknown request-scoped MemBrain pillar choice identifier.");
  const selectedPillar = operatorPillar ?? analysedPillarChoice?.label ?? null;
  const pillarRationale = operatorPillar ? "Selected by the operator." : analysedMedia?.pillarRationale ?? "No request-scoped pillar selection was available.";
  const goalRationale = commercialIntent
    ? "Selected explicitly by the operator."
    : resolvedIntent === "convert" && market.conversionActions.length
      ? `Awo recommends conversion because the client has conversion objectives and a configured ${market.conversionActions[0]!.replaceAll("_", " ")} action.`
      : resolvedIntent === "build_trust" ? "Awo recommends building trust from the configured authority objective." : "Awo recommends engagement as the least commercially presumptive supported goal.";
  const objectiveType: EngagementObjectiveType = resolvedIntent === "convert" ? "enquiries" : resolvedIntent === "build_trust" ? "awareness" : "engagement";
  const clientSnapshots = resolvedDestinationAccountId
    ? await context.engagement.listMetricSnapshots(organisationId, resolvedPlatform, objectiveType, resolvedDestinationAccountId)
    : [];
  const attributedIds = [...new Set(clientSnapshots.map((snapshot) => snapshot.recommendationId).filter((id): id is string => Boolean(id)))].slice(0, 20);
  const attributedRecommendations = (await Promise.all(attributedIds.map((id) => context.engagement.findById(organisationId, id)))).filter((item): item is EngagementRecommendation => Boolean(item));
  const clientEvidence = resolvedDestinationAccountId
    ? deriveClientVisibilityEvidence({ snapshots: clientSnapshots, recommendations: attributedRecommendations, organisationId, platform: resolvedPlatform, providerAccountId: resolvedDestinationAccountId, objective: objectiveType })
    : null;
  const visibilityPlan = buildVisibilityPlan({
    platform: resolvedPlatform,
    objectiveType,
    commercialIntent: resolvedIntent,
    targetAudience: market.targetAudience,
    industry: org.industry ?? null,
    mediaMimeTypes: media.map((asset) => asset.mimeType),
    media,
    selectedMarketPatternIds: market.selectedPatternIds,
    selectedMarketPatterns: market.selectedPatterns,
    targetGeographies: market.targetGeographies,
    serviceAreas: market.serviceAreas,
    conversionActions: market.conversionActions,
    platformStrategy: market.platformStrategy,
    hashtagStrategyRoles: market.hashtagStrategyRoles,
    contentPillar: selectedPillar,
    contentPillarRationale: pillarRationale,
    mediaObservation: analysedMedia ? renderMediaObservation(analysedMedia) : mediaLimitation,
    targetAudienceOverride: analysedMedia?.narrowedTargetAudience ?? null,
    goalRationale,
    hookStrategyOverride: analysedMedia?.hookFamily ?? null,
    actualHook: analysedMedia?.actualHook ?? null,
    clientEvidence,
  });
  const baselinePrompt = buildCaptionSystemPrompt(orgName, platform, ctx, intent, prompt, guidedContext);
  // The deterministic Visibility Plan the operator sees must also be the plan
  // the model writes against — previously it was returned to the UI but never
  // entered the prompt, so hook/format/CTA could contradict the plan panel.
  const systemPrompt = [baselinePrompt, market.enabled ? market.prompt : null, visibilityPlanPrompt(visibilityPlan)].filter(Boolean).join("\n\n");

  const outputEvidence = [prompt, analysedMedia ? renderMediaObservation(analysedMedia) : "", ...media.flatMap((asset) => [asset.title, asset.description, asset.altText, ...(asset.tags ?? [])]).filter((value): value is string => Boolean(value))].join("\n");
  const hookViolations = analysedMedia ? growthOutputViolations({ caption: analysedMedia.actualHook, evidence: outputEvidence, conversionActions: market.conversionActions }) : [];
  if (hookViolations.length) throw new Error(`Awo's media-grounded hook failed the growth guardrail: ${hookViolations.join(" ")}`);
  let text: string;
  try {
    text = await ai.generateText(prompt, { systemPrompt });
    const violations = growthOutputViolations({ caption: text, evidence: outputEvidence, conversionActions: market.conversionActions });
    if (violations.length) {
      text = await ai.generateText(text, { systemPrompt: ["Repair this caption once while preserving its supported meaning and Growth Decision.", ...violations.map((violation) => `- ${violation}`), `Primary audience: ${visibilityPlan.targetAudience}`, `Content job: ${visibilityPlan.contentJob}`, `Hook family: ${visibilityPlan.hookStrategy}`, `Actual hook: ${visibilityPlan.actualHook}`, `Discovery: ${visibilityPlan.discoveryStrategy}`, `CTA: ${visibilityPlan.ctaStrategy}`, BUYER_ORIENTATION_CONTRACT, "Use this internal check without displaying a score: hook, audience precision, stopping power, discovery, differentiation, natural voice, commercial intent, CTA, cultural precision and evidence discipline.", "Make the audience's want and supported difference primary. Describe only the current asset. Remove clichés, unsupported process/occasion/service claims, superlatives, technical filler and generic agency language. Follow the configured CTA stage exactly. Return only the repaired caption."].join("\n"), temperature: 0.1 });
      const remaining = growthOutputViolations({ caption: text, evidence: outputEvidence, conversionActions: market.conversionActions });
      if (remaining.length) throw new Error(`Growth guardrail rejected the generated caption: ${remaining.join(" ")}`);
    }
  } catch (error) {
    console.error("[genesis] caption generation provider failure", error);
    throw new Error(describeProviderFailure(error));
  }

  const clean = applyComplianceCheck(text, ctx.restrictions);
  return {
    ...clean,
    visibilityPlan,
    commercialIntent: resolvedIntent,
    commercialIntentSource: market.commercialIntentSource,
    culturalVoiceLevel: market.culturalVoiceLevel,
    attribution: {
      caption: clean.text,
      platform: resolvedPlatform,
      destinationAccountId: resolvedDestinationAccountId,
      mediaAssetIds: selectedAssets.map((asset) => asset.id),
      commercialIntent: resolvedIntent,
      commercialIntentSource: market.commercialIntentSource,
      culturalVoiceLevel: market.culturalVoiceLevel,
      visibilityPlan,
      suggestedHashtags: [],
      pillarSourceEntryId: operatorPillar ? null : analysedPillarChoice?.sourceEntryId ?? null,
      pillarSemanticLabel: selectedPillar,
      pillarChoiceVersion: operatorPillar ? null : PILLAR_CHOICE_CONTRACT_VERSION,
    },
  };
}

export async function rewriteContent(
  organisationId: string,
  content: string,
  instruction: "expand" | "shorten" | "professional" | "casual" | "punchy",
): Promise<{ text: string; complianceWarning?: string }> {
  const context = await requireContext();
  const org = await requireOrgWriteAccess(context, organisationId);
  const orgName = org.name;

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const ctx = extractAwoMembrainContext(membrain);

  let modifier = "";
  if (instruction === "expand") modifier = "Expand this content, adding more detail and depth.";
  if (instruction === "shorten") modifier = "Shorten this content, making it concise and to the point.";
  if (instruction === "professional") modifier = "Rewrite this to be highly professional and formal.";
  if (instruction === "casual") modifier = "Rewrite this to be casual and friendly.";
  if (instruction === "punchy") modifier = "Rewrite this to be punchy, energetic, and high-impact.";

  const systemPrompt = buildRewriteSystemPrompt(orgName, modifier, ctx);

  const ai = getAIProvider();
  let text: string;
  try {
    text = await ai.generateText(content, { systemPrompt });
  } catch (error) {
    console.error("[genesis] rewrite provider failure", error);
    throw new Error(describeProviderFailure(error));
  }

  return applyComplianceCheck(text, ctx.restrictions);
}

export async function generateHashtags(
  organisationId: string,
  content: string,
  count: number = 5,
  platform: CampaignPlatform = "instagram",
  commercialIntent?: "convert" | "engage" | "build_trust",
): Promise<{ hashtags: string[] }> {
  const context = await requireContext();
  await requireOrgWriteAccess(context, organisationId);

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const ctx = extractAwoMembrainContext(membrain);
  const market = await assembleMarketGenerationContext({ marketIntelligence: context.marketIntelligence, organisationId, platform, commercialIntent });

  const ai = getAIProvider();
  const brandVoiceCtx = ctx.brandVoice.join("\n") || "Professional.";
  const baselinePrompt = `You are an expert social media manager. Suggest exactly ${count} highly relevant hashtags for the provided content. Ensure they align with the Brand Voice: ${brandVoiceCtx}`;
  const systemPrompt = market.enabled ? `${baselinePrompt}\n\n${market.prompt}\n\nSelect a restrained mix across local, service, audience/cultural, occasion/topic, campaign and brand roles. Empty roles are valid. Never promise reach.` : baselinePrompt;

  const schema = z.object({
    hashtags: z.array(z.string()).describe("The suggested hashtags, including the # symbol"),
  });
  try {
    if (!market.enabled) {
      const result = await ai.generateObject(content, schema, { systemPrompt });
      return { hashtags: filterUnsupportedOccasionHashtags(result.hashtags, content).slice(0, count) };
    }
    const grouped = await ai.generateObject(content, z.object({
      local: z.array(z.string()), service: z.array(z.string()), audienceCultural: z.array(z.string()),
      occasionTopic: z.array(z.string()), campaign: z.array(z.string()), brand: z.array(z.string()),
    }), { systemPrompt });
    const groupedTags = {
      ...grouped,
      local: filterUnsupportedOccasionHashtags(grouped.local, content),
      service: filterUnsupportedOccasionHashtags(grouped.service, content),
    };
    if (["instagram", "facebook", "tiktok"].includes(platform) && (!groupedTags.local.length || !groupedTags.service.length)) {
      throw new Error("Awo could not produce both verified local and service discovery hashtags. Complete Market Intelligence and try again.");
    }
    const prioritised = [groupedTags.local[0], groupedTags.service[0], ...Object.values(groupedTags).flat()]
      .filter((tag): tag is string => Boolean(tag));
    return { hashtags: filterUnsupportedOccasionHashtags([...new Set(prioritised)], content).slice(0, count) };
  } catch (error) {
    console.error("[genesis] hashtag generation provider failure", error);
    throw new Error(describeProviderFailure(error));
  }
}
