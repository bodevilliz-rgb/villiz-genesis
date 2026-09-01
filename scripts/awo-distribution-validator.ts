import type { CampaignDistributionProfile } from "./awo-campaign-distribution-profile";

const GENERIC_VANITY_TAGS = new Set([
  "viral",
  "fyp",
  "foryou",
  "foryoupage",
  "trending",
  "explore",
  "explorepage",
  "instagood",
]);

export const DISTRIBUTION_PRODUCTION_GATE = 95;

const HASHTAG_PATTERN = /^[A-Za-z0-9_]+$/;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "brand", "business", "campaign", "client", "content", "from", "have", "into", "more", "only", "posts", "that", "the", "their", "them", "this", "tone", "using", "with", "your"
]);

export type DistributionValidationContext = {
  campaignName?: string;
  brief?: string;
  targetAudience?: string;
  evidenceText?: string;
  profile?: CampaignDistributionProfile;
};

export type DistributionValidationInput = {
  caption: string;
  hook: string;
  cta: string;
  hashtags: string[];
};

export type DistributionValidationResult = {
  ok: boolean;
  errors: string[];
  hashtags: string[];
  portfolioScore: number;
};

function normaliseHashtag(value: string): string {
  return value.trim().replace(/^#+/, "");
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function significantTokens(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 4 && !STOP_WORDS.has(token)) ?? [])];
}

function tagMatchesAny(tag: string, tokens: string[]): boolean {
  const value = compact(tag);
  return tokens.some((token) => value.includes(compact(token)));
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

function deriveLocalityTokens(evidence: string): string[] {
  const labelled = extractLabelValues(evidence, ["location", "locations", "service area", "service areas", "geography", "market", "markets", "based in"]);
  const explicit: string[] = [];
  if (/\b(?:uk|u\.k\.|united kingdom)\b/i.test(evidence)) explicit.push("uk", "unitedkingdom");
  return [...new Set([...labelled.flatMap(significantTokens), ...explicit])];
}

function deriveBrandTokens(evidence: string): string[] {
  return [...new Set(extractLabelValues(evidence, ["brand", "brand name", "business name", "client"]).flatMap(significantTokens))];
}

export function validateDistributionOutput(input: DistributionValidationInput, context: DistributionValidationContext = {}): DistributionValidationResult {
  const errors: string[] = [];
  const hashtags = input.hashtags.map(normaliseHashtag).filter(Boolean);

  if (!input.hook.trim() || input.hook.trim().length < 4) errors.push("Hook is too short.");
  if (!input.caption.trim() || input.caption.trim().length < 20) errors.push("Caption is too short.");
  if (!input.cta.trim() || input.cta.trim().length < 2) errors.push("CTA is too short.");
  if (hashtags.length < 5) errors.push("Fewer than 5 usable hashtags were generated.");
  if (hashtags.length > 20) errors.push("More than 20 hashtags were generated.");

  const lower = hashtags.map((tag) => tag.toLowerCase());
  if (new Set(lower).size !== lower.length) errors.push("Duplicate hashtags were generated.");

  const malformed = hashtags.filter((tag) => !HASHTAG_PATTERN.test(tag));
  if (malformed.length) errors.push(`Malformed or unexpected-script hashtags: ${malformed.join(", ")}`);

  const vanity = lower.filter((tag) => GENERIC_VANITY_TAGS.has(tag));
  if (vanity.length) errors.push(`Generic vanity hashtags are not allowed by default: ${vanity.join(", ")}`);

  const joined = `${input.hook} ${input.caption} ${input.cta}`;
  if (/\b(guaranteed|guarantee)\s+(reach|views|ranking|results)\b/i.test(joined)) {
    errors.push("Copy implies guaranteed algorithmic or performance results.");
  }

  const evidence = context.profile?.evidenceText ?? context.evidenceText ?? "";
  const briefTokens = context.profile?.serviceTokens ?? significantTokens(context.brief ?? "");
  const audienceTokens = context.profile?.audienceTokens ?? significantTokens(context.targetAudience ?? "");
  const brandTokens = context.profile?.brandTokens ?? deriveBrandTokens(evidence);
  const localityTokens = context.profile?.localityTokens ?? deriveLocalityTokens(evidence);
  const localityRequired = context.profile?.localityRequired ?? localityTokens.length > 0;
  const evidenceTokens = significantTokens(`${context.brief ?? ""} ${context.targetAudience ?? ""} ${evidence}`);

  const evidenceAligned = hashtags.filter((tag) => tagMatchesAny(tag, evidenceTokens)).length;
  const serviceAligned = briefTokens.length === 0 || hashtags.some((tag) => tagMatchesAny(tag, briefTokens));
  const audienceAligned = audienceTokens.length === 0 || hashtags.some((tag) => tagMatchesAny(tag, audienceTokens));
  const brandAligned = brandTokens.length === 0 || hashtags.some((tag) => tagMatchesAny(tag, brandTokens));
  const localityAligned = !localityRequired || (localityTokens.length > 0 && hashtags.some((tag) => tagMatchesAny(tag, localityTokens)));

  if (evidenceTokens.length > 0 && evidenceAligned < Math.min(3, hashtags.length)) errors.push("Discovery portfolio is too weakly grounded in supplied campaign/MemBrain evidence.");
  if (!serviceAligned) errors.push("Discovery portfolio is missing a service/topic-intent hashtag grounded in the Campaign Distribution Profile.");
  if (!audienceAligned) errors.push("Discovery portfolio is missing an audience/problem-intent hashtag grounded in the Campaign Distribution Profile.");
  if (!brandAligned) errors.push("Discovery portfolio is missing a verified brand/owned discovery term from the Campaign Distribution Profile.");
  if (!localityAligned) errors.push("Campaign Distribution Profile requires locality, but this post contains no verified locality signal.");

  const applicable = [brandTokens.length > 0, briefTokens.length > 0, audienceTokens.length > 0, localityRequired];
  const passed = [brandAligned, serviceAligned, audienceAligned, localityAligned];
  const applicableCount = applicable.filter(Boolean).length;
  const passedCount = applicable.reduce((count, isApplicable, index) => count + (isApplicable && passed[index] ? 1 : 0), 0);
  const groundingTarget = Math.max(3, Math.min(hashtags.length, 6));
  const groundingScore = evidenceTokens.length === 0 ? 100 : Math.min(100, Math.round((evidenceAligned / groundingTarget) * 100));
  const bucketScore = applicableCount === 0 ? 100 : Math.round((passedCount / applicableCount) * 100);
  const portfolioScore = Math.round((bucketScore * 0.8) + (groundingScore * 0.2));

  if (portfolioScore < DISTRIBUTION_PRODUCTION_GATE) {
    errors.push(`Discovery portfolio score ${portfolioScore}/100 is below the ${DISTRIBUTION_PRODUCTION_GATE}/100 production eligibility gate.`);
  }

  return { ok: errors.length === 0, errors, hashtags, portfolioScore };
}
