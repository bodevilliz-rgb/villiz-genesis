import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import type { CommercialIntent } from "@/core/domain/entities/market-intelligence";
import type { EngagementMetricSnapshot, EngagementObjectiveType, EngagementRecommendation, EngagementVisibilityPlan, VisibilityContentFormat, VisibilityEvidenceLevel, VisibilityHookFamily } from "@/core/domain/entities/engagement";
import { normaliseEngagementMetrics, objectiveDirectionalScore } from "@/core/application/use-cases/engagement/performance";

export const VISIBILITY_STRATEGY_VERSION = "visibility-v1";
export const VERTICAL_PLAYBOOK_VERSION = "vertical-v1";
export const BUYER_ORIENTATION_CONTRACT = [
  "=== BUYER ORIENTATION — public-copy boundary ===",
  "When the configured business is a consumer service, write to a plausible prospective buyer or user of that service, not to practitioners who deliver it.",
  "Technical media observations are internal evidence. Translate them into a supported customer desire, identity, occasion, problem or outcome in the public hook, caption and CTA/question; do not turn craft terminology into the audience or subject of the post.",
  "Photographers, stylists, technicians, marketers, creators and other practitioners are the public audience only when authoritative MemBrain audience context explicitly defines them as such.",
  "For professional services, products or an unknown business type, follow the authoritative configured audience without assuming either a consumer buyer or practitioner audience. If the audience is unclear, remain neutral rather than inventing one.",
  "Every CTA or closing question must address the same legitimate prospective customer or explicitly configured audience as the caption.",
].join("\n");
export type VerticalKey = "photography" | "hair_beauty" | "professional_services";

interface VerticalPlaybook {
  key: VerticalKey;
  version: string;
  aliases: string[];
  formats: VisibilityContentFormat[];
  hooks: VisibilityHookFamily[];
  opportunities: string[];
  proofMechanisms: string[];
  educationAngles: string[];
  ctaCategories: string[];
  audienceQuestions: string[];
  platformConsiderations: Partial<Record<CampaignPlatform, string>>;
}

export const VERTICAL_PLAYBOOKS: Record<VerticalKey, VerticalPlaybook> = {
  photography: { key: "photography", version: VERTICAL_PLAYBOOK_VERSION, aliases: ["photography", "photographer", "photo studio"], formats: ["carousel", "short_form_video", "single_image"], hooks: ["transformation", "occasion_milestone", "proof_result", "story"], opportunities: ["Show the decision process and the outcome without inventing client results."], proofMechanisms: ["Use only approved portfolio work, process evidence or client-approved proof."], educationAngles: ["Help the audience prepare for or evaluate a photography experience."], ctaCategories: ["enquiry", "booking", "conversation"], audienceQuestions: ["What would help the audience feel confident before booking?"], platformConsiderations: { instagram: "Choose a visually legible treatment supported by the attached media." } },
  hair_beauty: { key: "hair_beauty", version: VERTICAL_PLAYBOOK_VERSION, aliases: ["hair", "beauty", "salon", "barber", "cosmetics"], formats: ["short_form_video", "carousel", "single_image"], hooks: ["transformation", "confidence", "educational", "proof_result"], opportunities: ["Explain a visible service outcome or care decision without promising results."], proofMechanisms: ["Use approved work, process or product facts only."], educationAngles: ["Offer practical preparation or aftercare guidance grounded in MemBrain."], ctaCategories: ["booking", "enquiry", "save"], audienceQuestions: ["Which concern can be answered truthfully before an appointment?"], platformConsiderations: { instagram: "Use close, clear visual evidence only when suitable media is attached." } },
  professional_services: { key: "professional_services", version: VERTICAL_PLAYBOOK_VERSION, aliases: ["professional service", "consulting", "consultancy", "agency", "legal", "accounting", "finance"], formats: ["text_led", "carousel", "short_form_video"], hooks: ["problem_solution", "authority", "educational", "outcome_led"], opportunities: ["Make expertise useful through a concrete, supported decision or explanation."], proofMechanisms: ["Use approved experience, method or case evidence without inventing outcomes."], educationAngles: ["Clarify a decision, risk or process the audience legitimately faces."], ctaCategories: ["enquiry", "conversation", "lead_generation"], audienceQuestions: ["What decision can this content make easier?"], platformConsiderations: { linkedin: "Prefer a clear professional point of view supported by approved evidence." } },
};

export function resolveVerticalPlaybook(industry: string | null | undefined): VerticalPlaybook | null {
  const value = industry?.trim().toLocaleLowerCase();
  if (!value) return null;
  return Object.values(VERTICAL_PLAYBOOKS).find((playbook) => playbook.aliases.some((alias) => value.includes(alias))) ?? null;
}

export interface ClientVisibilityEvidence {
  sampleSize: number;
  preferredFormat: VisibilityContentFormat | null;
  preferredHook: VisibilityHookFamily | null;
}

const FORMAT_VALUES = new Set<VisibilityContentFormat>(["short_form_video", "carousel", "single_image", "supporting_story", "text_led", "other_supported"]);
const HOOK_VALUES = new Set<VisibilityHookFamily>(["outcome_led", "transformation", "curiosity", "confidence", "educational", "social_proof", "occasion_milestone", "problem_solution", "authority", "story", "question", "proof_result"]);

/** Derives only account/objective-scoped directional evidence supplied by the caller. */
export function deriveClientVisibilityEvidence(input: {
  snapshots: EngagementMetricSnapshot[];
  recommendations: EngagementRecommendation[];
  organisationId: string;
  platform: CampaignPlatform;
  providerAccountId: string;
  objective: EngagementObjectiveType;
}): ClientVisibilityEvidence | null {
  const { snapshots, recommendations, organisationId, platform, providerAccountId, objective } = input;
  const recommendationById = new Map(recommendations.map((recommendation) => [recommendation.id, recommendation]));
  const latestByPost = new Map<string, EngagementMetricSnapshot>();
  for (const snapshot of snapshots.filter((item) => item.measurementWindow === "7d" && item.organisationId === organisationId && item.platform === platform && item.providerAccountId === providerAccountId && item.objectiveType === objective)) {
    const current = latestByPost.get(snapshot.externalPostId);
    if (!current || snapshot.observedAt > current.observedAt) latestByPost.set(snapshot.externalPostId, snapshot);
  }
  const observations = [...latestByPost.values()].flatMap((snapshot) => {
    const score = objectiveDirectionalScore(objective, normaliseEngagementMetrics(snapshot.metrics));
    const metadata = snapshot.recommendationId ? recommendationById.get(snapshot.recommendationId)?.strategyMetadata : null;
    const recommendation = snapshot.recommendationId ? recommendationById.get(snapshot.recommendationId) : null;
    return score === null || !metadata || recommendation?.organisationId !== organisationId || recommendation.platform !== platform || recommendation.objectiveType !== objective ? [] : [{ score, format: metadata.contentFormat, hook: metadata.hookFamily }];
  });
  if (observations.length < 10) return null;
  const winner = <T extends string>(values: Array<{ value: T | null | undefined; score: number }>, allowed: Set<T>): T | null => {
    const grouped = new Map<T, number[]>();
    for (const item of values) if (item.value && allowed.has(item.value)) grouped.set(item.value, [...(grouped.get(item.value) ?? []), item.score]);
    return [...grouped.entries()].filter(([, scores]) => scores.length >= 3).sort((a, b) => (b[1].reduce((x, y) => x + y, 0) / b[1].length) - (a[1].reduce((x, y) => x + y, 0) / a[1].length))[0]?.[0] ?? null;
  };
  return { sampleSize: observations.length, preferredFormat: winner(observations.map((item) => ({ value: item.format, score: item.score })), FORMAT_VALUES), preferredHook: winner(observations.map((item) => ({ value: HOOK_VALUES.has(item.hook as VisibilityHookFamily) ? item.hook as VisibilityHookFamily : null, score: item.score })), HOOK_VALUES) };
}

export interface VisibilityMediaInput { mimeType: string; title?: string | null; description?: string | null; altText?: string | null; tags?: string[] }
export interface VisibilityMarketPattern { id: string; category: string; observation: string; confidence: number; provenance: string }

export interface VisibilityPlanInput {
  platform: CampaignPlatform;
  objectiveType: EngagementObjectiveType;
  commercialIntent: CommercialIntent;
  targetAudience: string | null;
  industry: string | null;
  mediaMimeTypes: string[];
  selectedMarketPatternIds: string[];
  media?: VisibilityMediaInput[];
  selectedMarketPatterns?: VisibilityMarketPattern[];
  targetGeographies?: string[];
  serviceAreas?: string[];
  conversionActions?: string[];
  contentPillar?: string | null;
  contentPillarRationale?: string | null;
  mediaObservation?: string | null;
  targetAudienceOverride?: string | null;
  goalRationale?: string | null;
  hookStrategyOverride?: VisibilityHookFamily | null;
  actualHook?: string | null;
  clientEvidence?: ClientVisibilityEvidence | null;
}

function compatible(format: VisibilityContentFormat, media: string[]): boolean {
  const images = media.filter((type) => type.startsWith("image/")).length;
  const videos = media.filter((type) => type.startsWith("video/")).length;
  if (format === "short_form_video") return videos > 0;
  if (format === "carousel") return images >= 2;
  if (format === "single_image") return images >= 1;
  if (format === "supporting_story") return images + videos > 0;
  return true;
}

function generalFormat(platform: CampaignPlatform, media: string[]): VisibilityContentFormat {
  if (media.some((type) => type.startsWith("video/"))) return "short_form_video";
  if (media.filter((type) => type.startsWith("image/")).length >= 2) return "carousel";
  if (media.some((type) => type.startsWith("image/"))) return "single_image";
  return "text_led";
}

function mediaObservation(media: VisibilityMediaInput[]): string {
  if (!media.length) return "No media was selected before generation.";
  const videoCount = media.filter((item) => item.mimeType.startsWith("video/")).length;
  const imageCount = media.filter((item) => item.mimeType.startsWith("image/")).length;
  const descriptors = media.flatMap((item) => [item.title, item.description, item.altText, ...(item.tags ?? [])]).filter((value): value is string => Boolean(value?.trim())).slice(0, 6);
  const basis = descriptors.length ? `Approved Media Library metadata: ${descriptors.join("; ")}.` : "No descriptive Media Library metadata is available.";
  if (videoCount) return `VIDEO CONTENT NOT ANALYSED; ${videoCount} video asset(s) are represented by metadata only. ${basis}`;
  if (imageCount) return `IMAGE CONTENT NOT VISUALLY ANALYSED; ${imageCount} image asset(s) are represented by approved metadata only. ${basis}`;
  return `Selected asset content was not analysed; metadata only. ${basis}`;
}

function configuredCta(intent: CommercialIntent, actions: string[]): string {
  if (intent === "engage") return "Ask one relevant question that invites a genuine response; do not use engagement bait.";
  if (!actions.length) return "No verified conversion action is configured; use a non-transactional invitation and do not invent a booking channel.";
  const action = actions[0]!.replaceAll("_", " ");
  return intent === "convert" ? `Direct the operator to the configured ${action}; do not substitute another channel.` : `Offer the configured ${action} as an optional next step after establishing trust.`;
}

function foundationHook(vertical: VerticalPlaybook | null): string {
  if (vertical?.key === "photography") return "A portrait can express identity without relying on a standard pose.";
  if (vertical?.key === "hair_beauty") return "The look matters, but so does the specific care concern behind it.";
  if (vertical?.key === "professional_services") return "A clearer decision starts with the one risk or question that matters most.";
  return "What specific difference would make this useful to the audience it is meant to serve?";
}

export function buildVisibilityPlan(input: VisibilityPlanInput): EngagementVisibilityPlan {
  const vertical = resolveVerticalPlaybook(input.industry);
  const reliableClientEvidence = input.clientEvidence && input.clientEvidence.sampleSize >= 10;
  const clientFormat = reliableClientEvidence && input.clientEvidence?.preferredFormat && compatible(input.clientEvidence.preferredFormat, input.mediaMimeTypes) ? input.clientEvidence.preferredFormat : null;
  const verticalFormat = vertical?.formats.find((format) => compatible(format, input.mediaMimeTypes)) ?? null;
  const contentFormat = clientFormat ?? verticalFormat ?? generalFormat(input.platform, input.mediaMimeTypes);
  const mediaTerms = (input.media ?? []).flatMap((item) => [item.title, item.description, item.altText, ...(item.tags ?? [])]).filter((value): value is string => Boolean(value));
  const explicitTransformation = mediaTerms.some((value) => /before\s*(?:and|&|\/|-)\s*after|transformation/i.test(value));
  const explicitMilestone = mediaTerms.some((value) => /birthday|anniversary|graduation|wedding|milestone|celebration/i.test(value));
  const explicitProof = mediaTerms.some((value) => /case study|testimonial|result|portfolio|client-approved proof/i.test(value));
  const supportedFoundationHook = vertical?.hooks.find((hook) => {
    if (hook === "transformation") return explicitTransformation;
    if (hook === "occasion_milestone") return explicitMilestone;
    if (hook === "proof_result" || hook === "social_proof") return explicitProof;
    return true;
  });
  const hookStrategy = input.hookStrategyOverride ?? (reliableClientEvidence && input.clientEvidence?.preferredHook
    ? input.clientEvidence.preferredHook
    : supportedFoundationHook ?? (input.commercialIntent === "convert" ? "outcome_led" : input.commercialIntent === "build_trust" ? "authority" : "question"));
  const visibilityEvidenceLevel: VisibilityEvidenceLevel = clientFormat || (reliableClientEvidence && input.clientEvidence?.preferredHook)
    ? "CLIENT_EVIDENCE"
    : input.selectedMarketPatternIds.length > 0 && vertical ? "FOUNDATION_AND_MARKET" : input.selectedMarketPatternIds.length > 0 ? "MARKET_EVIDENCE" : vertical ? "FOUNDATION_HYPOTHESIS" : input.clientEvidence && input.clientEvidence.sampleSize < 10 ? "INSUFFICIENT_EVIDENCE" : "GENERAL_PLATFORM_OPTION";
  const measurementPlan = input.objectiveType === "awareness"
    ? "Measure reach or views and supporting shares or saves; do not treat reach as sales."
    : input.objectiveType === "engagement"
      ? "Measure meaningful comments, shares and saves alongside reach or views."
      : input.objectiveType === "enquiries"
        ? "Measure supported enquiry signals and clicks alongside reach; do not treat either as bookings."
        : "Measure legitimate booking outcomes separately from reach, clicks and enquiries.";
  const locationTerms = [...(input.targetGeographies ?? []), ...(input.serviceAreas ?? [])].filter(Boolean);
  const searchableLanguage = [...new Set([...(input.contentPillar ? [input.contentPillar] : []), ...locationTerms])].slice(0, 6);
  const ctaStrategy = configuredCta(input.commercialIntent, input.conversionActions ?? []);
  const supportingDistributionActions = input.mediaMimeTypes.length && ["instagram", "facebook"].includes(input.platform)
    ? ["Reshare the published post to Stories while it is current.", "Add it to a relevant existing Highlight only if that Highlight is maintained."]
    : [];
  const contentJob = input.commercialIntent === "convert" ? "CONVERSION" : input.commercialIntent === "build_trust" ? "AUTHORITY" : "DISCOVERY";
  const evidenceSources = [vertical ? `${vertical.key}:${vertical.version}` : "safe-general-baseline", ...(input.selectedMarketPatterns ?? []).map((pattern) => `market-pattern:${pattern.id}`), ...(reliableClientEvidence ? [`client-performance:${input.clientEvidence!.sampleSize}`] : [])];
  return {
    goal: input.commercialIntent,
    goalRationale: input.goalRationale?.trim() || `The ${input.commercialIntent.replaceAll("_", " ")} goal follows the current operator selection or configured business objective.`,
    contentJob,
    targetAudience: input.targetAudienceOverride?.trim() || input.targetAudience?.trim() || "No legitimate target audience is currently configured.",
    mediaObservation: input.mediaObservation?.trim() || mediaObservation(input.media ?? input.mediaMimeTypes.map((mimeType) => ({ mimeType }))),
    contentPillar: input.contentPillar?.trim() || "No MemBrain content pillar was selected; Awo must stay within the supplied brief and evidence.",
    contentPillarRationale: input.contentPillarRationale?.trim() || "The operator selected this pillar, or no request-scoped rationale was available.",
    contentFormat,
    formatRationale: `${contentFormat.replaceAll("_", " ")} is compatible with the media selected before generation; it is a recommendation, not a reach prediction.`,
    attentionMechanism: hookStrategy === "transformation" ? "Verified before/after contrast" : hookStrategy === "authority" ? "Useful expertise" : hookStrategy === "question" ? "Relevant audience question" : "Outcome or identity relevance",
    hookStrategy,
    actualHook: input.actualHook?.trim() || foundationHook(vertical),
    discoveryStrategy: searchableLanguage.length ? `Use natural searchable language around ${searchableLanguage.join(", ")}. Do not keyword-stuff or invent geography.` : "Use natural language from the approved brief and MemBrain only. No verified geography or service discovery terms are available; do not invent them.",
    searchableLanguage,
    ctaStrategy,
    measurementPlan,
    supportingDistributionActions,
    publishingWindow: "Not enough account-specific evidence yet.",
    publishingWindowEvidenceState: "INSUFFICIENT_ACCOUNT_EVIDENCE",
    visibilityEvidenceLevel,
    verticalIntelligenceAvailable: Boolean(vertical),
    evidenceSources,
    confidence: visibilityEvidenceLevel === "CLIENT_EVIDENCE" ? 75 : input.selectedMarketPatternIds.length ? 60 : vertical ? 45 : 25,
    foundationVersion: vertical?.version ?? "safe-general-v1",
    rationale: visibilityEvidenceLevel === "CLIENT_EVIDENCE" ? "Selected from sufficiently comparable account-level evidence; treat it as directional, not causal." : input.selectedMarketPatternIds.length ? "Combines approved market evidence with a versioned foundation hypothesis; neither is a promise of performance." : vertical ? `Uses the version-controlled ${vertical.key.replaceAll("_", " ")} foundation pack as a testable hypothesis.` : "Uses a safe general baseline because no supported vertical foundation or stronger evidence is available.",
  };
}

export function visibilityPlanPrompt(plan: EngagementVisibilityPlan): string {
  const foundation = plan.evidenceSources[0] ?? "safe-general-baseline";
  const foundationPrinciple = foundation.startsWith("photography:")
    ? "Lead with the audience's desired identity, feeling or visible difference; mention craft only when it explains that difference. Do not default to equipment, lighting or process narration."
    : foundation.startsWith("hair_beauty:")
      ? "Lead with one supported audience concern, desired look or useful care decision. Do not assume transformation, appointment intent or a before/after result."
      : foundation.startsWith("professional_services:")
        ? "Lead with one decision, risk, objection or useful insight the audience needs. Demonstrate authority through clarity, not self-congratulation or unsupported outcomes."
        : "Lead with one specific audience relevance, problem, desire or useful idea. Do not import service, booking, transformation or vertical-specific assumptions.";
  return ["=== AWO GROWTH DECISION (DETERMINISTIC; DO NOT OVERRIDE) ===", `Goal: ${plan.goal} — ${plan.goalRationale}`, `Content job: ${plan.contentJob}`, `Target audience: ${plan.targetAudience}`, `Media observation: ${plan.mediaObservation}`, `Content pillar: ${plan.contentPillar} — ${plan.contentPillarRationale}`, `Content format: ${plan.contentFormat} — ${plan.formatRationale}`, `Attention mechanism: ${plan.attentionMechanism}`, `Hook family: ${plan.hookStrategy}`, `Actual hook: ${plan.actualHook}`, `Discovery: ${plan.discoveryStrategy}`, `Searchable language: ${plan.searchableLanguage.join(", ") || "None verified"}`, `CTA: ${plan.ctaStrategy}`, `Supporting distribution: ${plan.supportingDistributionActions.join(" ") || "None supported."}`, `Measurement: ${plan.measurementPlan}`, `Publishing window: ${plan.publishingWindow}`, `Evidence: ${plan.visibilityEvidenceLevel}; sources ${plan.evidenceSources.join(", ")}; confidence ${plan.confidence}/100`, plan.rationale, `Foundation writing principle: ${foundationPrinciple}`, BUYER_ORIENTATION_CONTRACT, "Write the caption against this resolved decision; do not compensate for missing strategy by broadening the audience or service catalogue. Open with the actual hook or a faithful expression of its specific tension, curiosity, desire, identity, objection, emotion, proof or usefulness. Make the audience the hero: communicate what they want, why it matters, the supported difference and then the appropriate action. Use natural service/location language only where supported. A tagline is optional, never filler. Asset evidence may describe this asset only; it never establishes a universal client process. Do not introduce occasion/service claims unsupported by the brief or media evidence. Do not escalate an enquiry CTA to booking, reservation or purchase. Do not invent media details, identities, demographics, sensitive traits, locations, proof, offers or conversion channels."].join("\n");
}
