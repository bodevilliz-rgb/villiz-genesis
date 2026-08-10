import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import { canWriteContent, type Actor } from "@/core/domain/entities/identity";
import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import {
  engagementRecommendationModelSchema,
  generateEngagementRecommendationSchema,
  type EngagementRecommendationModelOutput,
} from "@/core/application/dto/engagement-dto";
import type {
  EngagementEvidence,
  EngagementHashtagGroups,
  EngagementRecommendation,
} from "@/core/domain/entities/engagement";
import { retrieveContext } from "@/core/application/use-cases/membrain";

interface EngagementDeps {
  actor: Actor;
  organisations: OrganisationRepository;
  campaigns: CampaignRepository;
  content: ContentRepository;
  membrain: MembrainRepository;
  engagement: EngagementRepository;
  ai: AIProviderPort;
}

const BRAND_ONLY_CONFIDENCE_CAP = 70;
const BRAND_ONLY_LIMITATION =
  "Brand-informed recommendation only. Genesis does not yet have account-level engagement metrics to prove that it will increase reach or engagement.";

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

function normaliseModelOutput(output: EngagementRecommendationModelOutput): EngagementRecommendationModelOutput {
  return {
    ...output,
    alternativeCaptions: [...new Set(output.alternativeCaptions)].slice(0, 2),
    hashtags: uniqueHashtags(output.hashtags),
    limitations: [BRAND_ONLY_LIMITATION, ...output.limitations.filter((item) => item !== BRAND_ONLY_LIMITATION)].slice(0, 5),
    confidence: Math.min(output.confidence, BRAND_ONLY_CONFIDENCE_CAP),
  };
}

function buildSystemPrompt(input: {
  organisationName: string;
  platform: string;
  objective: string;
  contextPrompt: string;
}) {
  return `You are AWO Engagement Intelligence for ${input.organisationName}.

Create an evidence-grounded social post recommendation for ${input.platform}.
Objective: ${input.objective}

Authoritative MemBrain context:
${input.contextPrompt}

Rules:
- Treat MemBrain as the only source of brand facts, claims, location, services, audience, CTA rules and hashtag strategy.
- Never invent an offer, statistic, testimonial, price, location, trend or platform rule.
- Do not claim or imply that engagement is guaranteed.
- Optimise for clarity, relevance, a strong opening hook and a truthful CTA.
- Suggest only relevant hashtags. Group them as brand, local, service and audience; use an empty array when the context cannot support a group.
- Do not put reasoning or confidence claims inside the caption.
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

  const prompt = `Draft title: ${draft.title}\nDraft version: ${draft.version}\nCurrent draft:\n${draft.body}`;
  const modelOutput = await deps.ai.generateObject(prompt, engagementRecommendationModelSchema, {
    systemPrompt: buildSystemPrompt({
      organisationName: organisation.name,
      platform: input.platform,
      objective,
      contextPrompt: contextPack.prompt,
    }),
    temperature: 0.25,
  });
  const recommendation = normaliseModelOutput(modelOutput);

  const evidence: EngagementEvidence[] = contextPack.items.map((item) => ({
    sourceType: "membrain_entry",
    sourceId: item.id,
    title: item.title,
    categoryKey: item.categoryKey,
    version: item.version,
  }));

  return deps.engagement.create({
    organisationId: input.organisationId,
    draftId: input.draftId,
    draftVersion: draft.version,
    platform: input.platform,
    objective,
    dataBasis: "brand_only",
    recommendedCaption: recommendation.recommendedCaption,
    alternativeCaptions: recommendation.alternativeCaptions,
    hook: recommendation.hook,
    cta: recommendation.cta,
    hashtags: recommendation.hashtags,
    rationale: recommendation.rationale,
    predictedStrengths: recommendation.predictedStrengths,
    limitations: recommendation.limitations,
    confidence: recommendation.confidence,
    evidence,
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
