import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import type { MarketIntelligenceRepository } from "@/core/application/ports/market-intelligence-port";
import type { CommercialIntent, CulturalVoiceLevel, MarketIntelligenceProfile, MarketPattern } from "@/core/domain/entities/market-intelligence";

export interface MarketGenerationContext {
  enabled: boolean;
  commercialIntent: CommercialIntent;
  /** "operator" when the intent was explicitly chosen; "recommended" when Awo derived it. */
  commercialIntentSource: "operator" | "recommended";
  culturalVoiceLevel: CulturalVoiceLevel;
  selectedPatternIds: string[];
  selectedPatterns: Array<Pick<MarketPattern, "id" | "category" | "observation" | "confidence" | "provenance">>;
  targetAudience: string | null;
  targetGeographies: string[];
  serviceAreas: string[];
  conversionActions: string[];
  prompt: string;
}

/**
 * Deterministic "Awo recommends" for commercial intent. The New Draft goal
 * dropdown offers "Awo recommends" as its default option; before this existed,
 * that option silently fell through a `= "engage"` parameter default — the
 * operator's non-choice was converted into an explicit strategy without any
 * decision mechanism behind it. The rule here is deliberately simple and
 * evidence-bound: a profile that has configured legitimate conversion actions
 * and conversion-shaped business objectives is asking for enquiries — CONVERT;
 * trust-shaped objectives recommend BUILD_TRUST; anything else, including a
 * missing profile, stays ENGAGE (the least commercially presumptive intent).
 */
export function recommendCommercialIntent(profile: MarketIntelligenceProfile | null): CommercialIntent {
  if (!profile) return "engage";
  const objectives = new Set(profile.businessObjectives);
  const conversionShaped = ["enquiries", "bookings", "sales", "lead_generation"].some((objective) => objectives.has(objective as (typeof profile.businessObjectives)[number]));
  if (conversionShaped && profile.conversionActions.length > 0) return "convert";
  if (objectives.has("authority" as (typeof profile.businessObjectives)[number])) return "build_trust";
  return "engage";
}

const INTENT_RULES: Record<CommercialIntent, string> = {
  convert: "Prioritise a truthful, supported action that can lead to an enquiry, booking or purchase. Never invent the conversion channel.",
  engage: "Prioritise meaningful conversation, comments, saves or shares without engagement bait or promised reach.",
  build_trust: "Prioritise supported expertise, proof, clarity and credibility without inventing credentials or outcomes.",
};

const VOICE_RULES: Record<CulturalVoiceLevel, string> = {
  neutral: "Use polished standard English. Do not add regional or cultural phrasing.",
  conversational: "Use warm, natural conversational English appropriate to the configured audience.",
  light_naija: "Use restrained Nigerian rhythm only where the configured audience/context supports it. Never caricature, use phonetic imitation, stereotype, or mechanically inject pidgin such as abeg, omo or wahala.",
};

function relevantPatterns(patterns: MarketPattern[], organisationId: string, platform: CampaignPlatform): MarketPattern[] {
  return patterns
    .filter((pattern) => pattern.organisationId === organisationId && pattern.isActive && (!pattern.platform || pattern.platform === platform))
    // Proof-depth patterns are the calibration layer for every recommendation,
    // so they must survive the context cap no matter how many other patterns a
    // client accumulates; after that, higher-confidence patterns win. Without
    // this ordering the cap silently evicted whatever the repository happened
    // to return last — including the proof-depth matrix itself.
    .sort((a, b) => Number(b.category === "proof") - Number(a.category === "proof") || b.confidence - a.confidence)
    .slice(0, 12);
}

function renderProfile(profile: MarketIntelligenceProfile, patterns: MarketPattern[], platform: CampaignPlatform): string {
  const strategy = profile.platformStrategy[platform];
  return [
    "=== APPROVED CLIENT MARKET INTELLIGENCE ===",
    `Business objectives: ${profile.businessObjectives.join(", ") || "Not configured"}`,
    `Target geography: ${profile.targetGeographies.join(", ") || "Not configured"}`,
    `Service area: ${profile.serviceAreas.join(", ") || "Not configured"}`,
    `Audience context: ${profile.audienceContext ?? "Not configured"}`,
    `Cultural context: ${profile.culturalContext ?? "Not configured"}`,
    `Promotional focus: ${profile.promotionalFocus ?? "Not configured"}`,
    `Permitted conversion-action types: ${profile.conversionActions.join(", ") || "None configured"}`,
    `Platform strategy: ${strategy ?? "Not configured"}`,
    `Discovery strategy: ${JSON.stringify(profile.hashtagStrategy)}`,
    "Approved abstract patterns:",
    ...(patterns.length ? patterns.map((pattern) => `- [${pattern.id}; confidence ${pattern.confidence}/100; provenance: ${pattern.provenance}] ${pattern.observation}`) : ["- None approved"]),
  ].join("\n");
}

export async function assembleMarketGenerationContext(input: {
  marketIntelligence?: Pick<MarketIntelligenceRepository, "getSnapshot">;
  organisationId: string;
  platform: CampaignPlatform;
  commercialIntent?: CommercialIntent;
  culturalVoiceLevel?: CulturalVoiceLevel;
}): Promise<MarketGenerationContext> {
  const commercialIntentSource: MarketGenerationContext["commercialIntentSource"] = input.commercialIntent ? "operator" : "recommended";
  const unavailable = { enabled: false as const, commercialIntent: input.commercialIntent ?? recommendCommercialIntent(null), commercialIntentSource, culturalVoiceLevel: "neutral" as const, selectedPatternIds: [], selectedPatterns: [], targetAudience: null, targetGeographies: [], serviceAreas: [], conversionActions: [], prompt: "" };
  if (!input.marketIntelligence) return unavailable;
  const snapshot = await input.marketIntelligence.getSnapshot(input.organisationId);
  if (!snapshot.profile || snapshot.profile.organisationId !== input.organisationId) return unavailable;
  const commercialIntent = input.commercialIntent ?? recommendCommercialIntent(snapshot.profile);
  const patterns = relevantPatterns(snapshot.patterns, input.organisationId, input.platform);
  const requestedVoice = input.culturalVoiceLevel;
  const culturalVoiceLevel = requestedVoice === "light_naija" && !snapshot.profile.culturalContext?.trim()
    ? snapshot.profile.culturalVoiceLevel
    : requestedVoice ?? snapshot.profile.culturalVoiceLevel;
  return {
    enabled: true,
    commercialIntent,
    commercialIntentSource,
    culturalVoiceLevel,
    selectedPatternIds: patterns.map((pattern) => pattern.id),
    selectedPatterns: patterns.map(({ id, category, observation, confidence, provenance }) => ({ id, category, observation, confidence, provenance })),
    targetAudience: snapshot.profile.audienceContext,
    targetGeographies: snapshot.profile.targetGeographies,
    serviceAreas: snapshot.profile.serviceAreas,
    conversionActions: snapshot.profile.conversionActions,
    prompt: [
      renderProfile(snapshot.profile, patterns, input.platform),
      `Commercial intent: ${commercialIntent.toUpperCase()} — ${INTENT_RULES[commercialIntent]}`,
      `Cultural voice: ${culturalVoiceLevel.toUpperCase()} — ${VOICE_RULES[culturalVoiceLevel]}`,
      "Market Intelligence is strategic context only. MemBrain remains authoritative for facts, services, offers, locations, voice, claims, restrictions and exact contact/booking channels. If they conflict, follow MemBrain or omit the claim.",
      "Proof depth describes current market evidence, not whether a MemBrain-confirmed service is sellable. Use it to calibrate recommendation confidence, emphasise supported strengths and recommend proof development for weaker services; never turn it into an absolute prohibition. ADEQUATELY_PROVEN is not STRONGLY_PROVEN. Visual proof is not testimonial, consent or commercial-outcome evidence.",
      "Use only the abstract patterns above. Never reproduce or closely paraphrase competitor copy, imitate a named account, write in a competitor's style, or claim competitor performance that is not explicitly evidenced.",
    ].join("\n\n"),
  };
}

export function rejectsCompetitorImitation(text: string): boolean {
  return /(?:in the style of|imitate|copy|paraphrase)\s+@?[\p{L}\p{N}_.-]+/iu.test(text);
}
