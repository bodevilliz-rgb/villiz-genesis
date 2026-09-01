const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "brand", "business", "campaign", "client", "content", "from", "have", "into", "more", "only", "posts", "that", "the", "their", "them", "this", "tone", "using", "with", "your",
]);

export type CampaignDistributionProfile = {
  campaignName: string;
  brandTokens: string[];
  serviceTokens: string[];
  audienceTokens: string[];
  localityTokens: string[];
  localityRequired: boolean;
  objectiveTokens: string[];
  evidenceText: string;
};

export type CampaignDistributionProfileSource = {
  brief?: string | null;
  targetAudience?: string | null;
  memBrainContextPrompt?: string | null;
};

function compactToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function significantTokens(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)) ?? [])];
}

function extractLabelValues(text: string, labels: string[]): string[] {
  const values: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^\\s*${label}\\s*[:=-]\\s*(.+)$`, "i"));
      if (match?.[1]) values.push(match[1].trim());
    }
  }
  return values;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(compactToken).filter(Boolean))];
}

function deriveBrandTokens(campaignName: string, evidence: string): string[] {
  const labelled = extractLabelValues(evidence, ["brand", "brand name", "business name", "client"]);
  return unique([...significantTokens(campaignName), ...labelled.flatMap(significantTokens)]);
}

function deriveLocalityTokens(evidence: string): string[] {
  const labelled = extractLabelValues(evidence, ["location", "locations", "service area", "service areas", "geography", "market", "markets", "based in", "city", "region"]);
  const explicit: string[] = [];
  if (/\b(?:uk|u\.k\.|united kingdom)\b/i.test(evidence)) explicit.push("uk", "unitedkingdom");
  return unique([...labelled.flatMap(significantTokens), ...explicit]);
}

function deriveObjectiveTokens(briefs: string): string[] {
  const labelled = extractLabelValues(briefs, ["objective", "goal", "campaign objective", "primary objective"]);
  return unique(labelled.flatMap(significantTokens));
}

export function resolveCampaignDistributionProfile(
  campaignName: string,
  sources: CampaignDistributionProfileSource[],
): CampaignDistributionProfile {
  const briefs = sources.map((source) => source.brief ?? "").filter(Boolean).join("\n");
  const audiences = sources.map((source) => source.targetAudience ?? "").filter(Boolean).join("\n");
  const evidence = sources.map((source) => source.memBrainContextPrompt ?? "").filter(Boolean).join("\n");
  const localityTokens = deriveLocalityTokens(evidence);

  return {
    campaignName,
    brandTokens: deriveBrandTokens(campaignName, evidence),
    serviceTokens: unique(significantTokens(briefs)),
    audienceTokens: unique(significantTokens(audiences)),
    localityTokens,
    localityRequired: localityTokens.length > 0,
    objectiveTokens: deriveObjectiveTokens(briefs),
    evidenceText: [briefs, audiences, evidence].filter(Boolean).join("\n"),
  };
}

export function distributionProfilePrompt(profile: CampaignDistributionProfile): string {
  return [
    "CAMPAIGN DISTRIBUTION PROFILE — authoritative for every post in this campaign:",
    `Brand tokens: ${profile.brandTokens.join(", ") || "none resolved"}`,
    `Service/topic tokens: ${profile.serviceTokens.slice(0, 20).join(", ") || "none resolved"}`,
    `Audience/problem tokens: ${profile.audienceTokens.slice(0, 20).join(", ") || "none resolved"}`,
    `Verified locality tokens: ${profile.localityTokens.join(", ") || "none"}`,
    `Locality required: ${profile.localityRequired ? "yes — every post must carry at least one verified locality signal" : "no — do not invent locality"}`,
    `Objective tokens: ${profile.objectiveTokens.join(", ") || "use the supplied campaign brief"}`,
    "Treat this profile as shared campaign truth; do not independently decide whether locality or brand relevance applies per post.",
  ].join("\n");
}
