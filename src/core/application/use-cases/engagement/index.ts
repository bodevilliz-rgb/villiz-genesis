import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import { canWriteContent, type Actor } from "@/core/domain/entities/identity";
import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { MediaRepository } from "@/core/application/ports/media-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import {
  engagementRecommendationModelSchema,
  generateEngagementRecommendationSchema,
  type EngagementRecommendationModelOutput,
  recordEngagementFeedbackSchema,
} from "@/core/application/dto/engagement-dto";
import type {
  EngagementEvidence,
  EngagementHashtagGroups,
  EngagementRecommendation,
  EngagementFeedbackEvent,
} from "@/core/domain/entities/engagement";
import { retrieveContext } from "@/core/application/use-cases/membrain";
import { performanceSummary } from "./performance";

interface EngagementDeps {
  actor: Actor;
  organisations: OrganisationRepository;
  campaigns: CampaignRepository;
  content: ContentRepository;
  membrain: MembrainRepository;
  engagement: EngagementRepository;
  media?: MediaRepository;
  ai: AIProviderPort;
}

const BRAND_ONLY_CONFIDENCE_CAP = 70;
const BRAND_ONLY_LIMITATION =
  "Brand-informed recommendation only. Genesis does not yet have enough comparable account-level results to call this performance-informed.";

function nonBlank(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueHashtags(groups: EngagementHashtagGroups): EngagementHashtagGroups {
  const seen = new Set<string>();
  const clean = (values: string[]) =>
    values.filter((value) => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    brand: clean(groups.brand),
    local: clean(groups.local),
    service: clean(groups.service),
    audience: clean(groups.audience),
  };
}

function normaliseModelOutput(output: EngagementRecommendationModelOutput, isPerformanceInformed = false): EngagementRecommendationModelOutput {
  return {
    ...output,
    alternativeCaptions: [...new Set(output.alternativeCaptions)].slice(0, 2),
    hashtags: uniqueHashtags(output.hashtags),
    limitations: isPerformanceInformed
      ? output.limitations.slice(0, 5)
      : [BRAND_ONLY_LIMITATION, ...output.limitations.filter((item) => item !== BRAND_ONLY_LIMITATION)].slice(0, 5),
    confidence: Math.min(output.confidence, BRAND_ONLY_CONFIDENCE_CAP),
  };
}

function buildSystemPrompt(input: {
  organisationName: string;
  platform: string;
  objective: string;
  contextPrompt: string;
  performancePrompt: string;
  mediaPrompt: string;
}) {
  return `You are AWO Engagement Intelligence for ${input.organisationName}.

Create an evidence-grounded social post recommendation for ${input.platform}.
Objective: ${input.objective}

Authoritative MemBrain context:
${input.contextPrompt}

Historical performance context (directional, never causal):
${input.performancePrompt}

Attached-media metadata (not pixel-level visual analysis):
${input.mediaPrompt}

Rules:
- Treat MemBrain as the only source of brand facts, claims, location, services, audience, CTA rules and hashtag strategy.
- Never invent an offer, statistic, testimonial, price, location, trend or platform rule.
- Do not claim or imply that engagement is guaranteed.
- Optimise for clarity, relevance, a strong opening hook and a truthful CTA.
- Suggest only relevant hashtags. Group them as brand, local, service and audience; use an empty array when the context cannot support a group.
- Do not put reasoning or confidence claims inside the caption.
- Creative guidance must be actionable and must not claim to have visually inspected media. Set mediaBasis to metadata_only when metadata is present, otherwise none.
- Treat historical scores as directional evidence, not proof that a caption caused an outcome.
- Return structured data matching the supplied schema.`;
}

export async function generateEngagementRecommendation(
  deps: EngagementDeps,
  raw: unknown,
): Promise<EngagementRecommendation> {
  const parsed = generateEngagementRecommendationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Check the engagement request.", parsed.error.flatten().fieldErrors);
  }

  const input = parsed.data;
  const role = await deps.organisations.viewerRole(input.organisationId);
  if (!canWriteContent(deps.actor, role)) {
    throw new ForbiddenError("You do not have permission to request engagement intelligence for this organisation.");
  }

  const [organisation, draft] = await Promise.all([
    deps.organisations.findById(input.organisationId),
    deps.content.findDraft(input.organisationId, input.draftId),
  ]);

  if (!organisation) throw new NotFoundError("Organisation");
  if (!draft) throw new NotFoundError("Draft");
  if (!new Set(["social_post", "caption", "campaign_copy", "ad_copy", "video_script"]).has(draft.contentType)) {
    throw new ValidationError("Engagement intelligence is currently available for social content only.");
  }
  if (!draft.body.trim()) {
    throw new ValidationError("Write and save some draft content before requesting engagement intelligence.");
  }

  const campaign = draft.campaign
    ? await deps.campaigns.findCampaign(input.organisationId, draft.campaign.id)
    : null;
  const objective =
    nonBlank(input.objective) ??
    nonBlank(campaign?.objective) ??
    `Improve relevant engagement with this ${draft.contentType.replaceAll("_", " ")}`;

  const contextQuery = [
    draft.title,
    objective,
    "brand voice audience CTA hashtag strategy location services business goals customer journey content performance",
  ]
    .join(" ")
    .slice(0, 500);

  const contextPack = await retrieveContext(
    { actor: deps.actor, membrain: deps.membrain, organisations: deps.organisations },
    {
      organisationId: input.organisationId,
      query: contextQuery,
      limit: 24,
      maxCharacters: 32000,
      recordUsage: true,
    },
  );

  if (contextPack.items.length === 0) {
    throw new ValidationError("Add active MemBrain knowledge before requesting engagement intelligence.");
  }

  const [snapshots, mediaAssets] = await Promise.all([
    deps.engagement.listMetricSnapshots?.(input.organisationId, input.platform, input.objectiveType) ?? Promise.resolve([]),
    deps.media?.listAssetsForDraft(input.draftId) ?? Promise.resolve([]),
  ]);
  const performance = performanceSummary(snapshots, input.objectiveType);
  const hasPerformanceContext = performance.sampleSize >= performance.minimumSampleSize;
  const isPerformanceInformed = performance.label === "performance_informed";
  const mediaPrompt = mediaAssets.length === 0
    ? "No media is attached."
    : mediaAssets.slice(0, 8).map((asset) => [
        `Asset ${asset.id}: ${asset.title ?? asset.fileName}`,
        `type=${asset.mimeType}`,
        asset.width && asset.height ? `dimensions=${asset.width}x${asset.height}` : null,
        asset.duration ? `durationSeconds=${asset.duration}` : null,
        asset.description ? `description=${asset.description}` : null,
        asset.altText ? `altText=${asset.altText}` : null,
        asset.tags.length ? `tags=${asset.tags.join(", ")}` : null,
      ].filter(Boolean).join("; ")).join("\n");
  const performancePrompt = hasPerformanceContext
    ? `${performance.sampleSize} comparable ${input.platform} posts for the ${input.objectiveType} objective; mean directional score ${performance.directionalScore ?? "unavailable"} per 1,000 reach/views. Performance confidence ${performance.performanceConfidence}%. ${performance.championVariant ? `Current champion variant: ${performance.championVariant}; challenger: ${performance.challengerVariant}. Treat this as a testable pattern, not causal proof.` : "No champion/challenger comparison has enough attributed observations yet."}`
    : `${performance.sampleSize}/${performance.minimumSampleSize} comparable posts. Insufficient data for performance-informed claims.`;

  const prompt = `Draft title: ${draft.title}\nDraft version: ${draft.version}\nCurrent draft:\n${draft.body}`;
  const modelOutput = await deps.ai.generateObject(prompt, engagementRecommendationModelSchema, {
    systemPrompt: buildSystemPrompt({
      organisationName: organisation.name,
      platform: input.platform,
      objective,
      contextPrompt: contextPack.prompt,
      performancePrompt,
      mediaPrompt,
    }),
    temperature: 0.25,
  });
  const recommendation = normaliseModelOutput(modelOutput, isPerformanceInformed);

  const evidence: EngagementEvidence[] = contextPack.items.map((item) => ({
    sourceType: "membrain_entry",
    sourceId: item.id,
    title: item.title,
    categoryKey: item.categoryKey,
    version: item.version,
  }));
  evidence.push(...mediaAssets.map((asset) => ({
    sourceType: "media_asset" as const,
    sourceId: asset.id,
    title: asset.title ?? asset.fileName,
  })));
  evidence.push(...[...new Map(snapshots.map((snapshot) => [snapshot.externalPostId, snapshot])).values()].slice(0, 20).map((snapshot) => ({
    sourceType: "performance_snapshot" as const,
    sourceId: snapshot.id,
    title: `${input.platform} result observed ${snapshot.observedAt.slice(0, 10)}`,
  })));

  return deps.engagement.create({
    organisationId: input.organisationId,
    draftId: input.draftId,
    draftVersion: draft.version,
    platform: input.platform,
    objectiveType: input.objectiveType,
    objective,
    dataBasis: isPerformanceInformed ? "performance_informed" : "brand_only",
    recommendedCaption: recommendation.recommendedCaption,
    alternativeCaptions: recommendation.alternativeCaptions,
    hook: recommendation.hook,
    cta: recommendation.cta,
    hashtags: recommendation.hashtags,
    rationale: recommendation.rationale,
    predictedStrengths: recommendation.predictedStrengths,
    limitations: recommendation.limitations,
    creativeGuidance: {
      ...recommendation.creativeGuidance,
      mediaBasis: mediaAssets.length > 0 ? "metadata_only" : "none",
    },
    confidence: recommendation.confidence,
    performanceConfidence: performance.performanceConfidence,
    performanceSummary: performance,
    evidence,
    createdBy: deps.actor.id,
  });
}

export async function recordEngagementFeedback(
  deps: Pick<EngagementDeps, "actor" | "organisations" | "engagement" | "content">,
  raw: unknown,
): Promise<EngagementFeedbackEvent> {
  const parsed = recordEngagementFeedbackSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the engagement feedback.", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const role = await deps.organisations.viewerRole(input.organisationId);
  if (!canWriteContent(deps.actor, role)) throw new ForbiddenError("You do not have permission to record engagement feedback.");
  if (!deps.engagement.findById || !deps.engagement.createFeedback) throw new ValidationError("Engagement feedback storage is not available.");
  const recommendation = await deps.engagement.findById(input.organisationId, input.recommendationId);
  if (!recommendation || recommendation.draftId !== input.draftId) throw new NotFoundError("Engagement recommendation");
  const draft = await deps.content.findDraft(input.organisationId, input.draftId);
  if (!draft) throw new NotFoundError("Draft");
  if (input.action === "selected" && recommendation.draftVersion !== draft.version) {
    throw new ValidationError("This recommendation is outdated. Generate a new recommendation before selecting it.");
  }
  if (input.action === "selected" && (!input.variant || !input.captionSnapshot)) {
    throw new ValidationError("A selected recommendation must include the chosen caption and variant.");
  }
  if (input.action === "selected" && input.variant !== "custom") {
    const expectedCaption = input.variant === "recommended"
      ? recommendation.recommendedCaption
      : recommendation.alternativeCaptions[input.variant === "alternative_1" ? 0 : 1];
    if (!expectedCaption || input.captionSnapshot !== expectedCaption) {
      throw new ValidationError("The selected caption does not match that recommendation variant.");
    }
  }
  const expectedHashtags = [
    ...recommendation.hashtags.brand, ...recommendation.hashtags.local,
    ...recommendation.hashtags.service, ...recommendation.hashtags.audience,
  ];
  if (input.action === "selected" && JSON.stringify(input.hashtagSnapshot) !== JSON.stringify(expectedHashtags)) {
    throw new ValidationError("The selected hashtag snapshot does not match this recommendation.");
  }
  return deps.engagement.createFeedback({
    ...input,
    reason: input.reason?.trim() || null,
    createdBy: deps.actor.id,
  });
}

export async function getLatestEngagementRecommendation(
  deps: Pick<EngagementDeps, "actor" | "organisations" | "engagement">,
  organisationId: string,
  draftId: string,
): Promise<EngagementRecommendation | null> {
  const role = await deps.organisations.viewerRole(organisationId);
  if (!deps.actor.isPlatformAdmin && !role) throw new ForbiddenError();
  return deps.engagement.findLatest(organisationId, draftId);
}

export { BRAND_ONLY_CONFIDENCE_CAP, BRAND_ONLY_LIMITATION, normaliseModelOutput };
