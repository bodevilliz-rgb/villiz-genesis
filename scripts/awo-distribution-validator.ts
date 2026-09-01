import type { CampaignDistributionProfile } from "./awo-campaign-distribution-profile";

const GENERIC_VANITY_TAGS = new Set([
  "viral", "fyp", "foryou", "foryoupage", "trending", "explore", "explorepage", "instagood",
]);

const PROMPT_LEAK_PATTERNS = [
  /\bsource\s+truth\b/i,
  /\bauthoritative\s+source\b/i,
  /\bplatform\s+adaptation\b/i,
  /\bgeneration\s+brief\b/i,
  /\bsystem\s+prompt\b/i,
  /\binternal\s+instruction(?:s)?\b/i,
  /\bprompt\s+instruction(?:s)?\b/i,
];

const PROMPT_LEAK_HASHTAG_TOKENS = new Set([
  "sourcetruth",
  "authoritativesource",
  "platformadaptation",
  "generationbrief",
  "systemprompt",
  "internalinstruction",
  "internalinstructions",
  "promptinstruction",
  "promptinstructions",
]);

export const DISTRIBUTION_PRODUCTION_GATE = 95;
export const TOPIC_FIDELITY_GATE = 75;

const HASHTAG_PATTERN = /^[A-Za-z0-9_]+$/;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "brand", "business", "campaign", "client", "content", "from", "have", "into", "more", "only", "posts", "that", "the", "their", "them", "this", "tone", "using", "with", "your",
]);
const TOPIC_NOISE_WORDS = new Set([
  "create", "post", "posts", "monday", "week", "weekly", "campaign", "content", "engagement", "social", "caption", "instagram", "tiktok", "brand", "audience", "healthy", "routine", "care", "hair", "beauty",
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
  topicFidelityScore: number;
};

function normaliseHashtag(value: string): string { return value.trim().replace(/^#+/, ""); }
function compact(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
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

function deriveTopicPhraseAnchors(brief: string): string[] {
  const raw = brief.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const anchors: string[] = [];
  for (let index = 0; index < raw.length - 1; index += 1) {
    const first = raw[index];
    const second = raw[index + 1];
    if (!first || !second || first.length < 4 || second.length < 4) continue;
    if (STOP_WORDS.has(first) || STOP_WORDS.has(second)) continue;
    if (TOPIC_NOISE_WORDS.has(first) && TOPIC_NOISE_WORDS.has(second)) continue;
    anchors.push(`${first} ${second}`);
  }
  return [...new Set(anchors)];
}

function evaluateTopicFidelity(input: DistributionValidationInput, brief: string) {
  const topicTokens = significantTokens(brief);
  const specificTokens = topicTokens.filter((token) => !TOPIC_NOISE_WORDS.has(token));
  const phraseAnchors = deriveTopicPhraseAnchors(brief);
  const copyText = `${input.hook} ${input.caption} ${input.cta}`.toLowerCase();
  const copyCompact = compact(copyText);
  const hashtagCompacts = input.hashtags.map((tag) => compact(normaliseHashtag(tag)));

  const phraseMatchesInCopy = phraseAnchors.filter((phrase) => copyCompact.includes(compact(phrase)));
  const phraseMatchesInHashtags = phraseAnchors.filter((phrase) => hashtagCompacts.some((tag) => tag.includes(compact(phrase))));
  const matchedPhrases = new Set([...phraseMatchesInCopy, ...phraseMatchesInHashtags]);
  const specificInCopy = specificTokens.filter((token) => copyCompact.includes(compact(token)));
  const specificInHashtags = specificTokens.filter((token) => hashtagCompacts.some((tag) => tag.includes(compact(token))));
  const allText = `${copyCompact} ${hashtagCompacts.join(" ")}`;
  const matchedTopicTokens = topicTokens.filter((token) => allText.includes(compact(token)));

  const phraseScore = phraseAnchors.length === 0 ? 100 : Math.min(100, Math.round((matchedPhrases.size / Math.min(2, phraseAnchors.length)) * 100));
  const specificTarget = Math.min(2, specificTokens.length);
  const specificMatched = new Set([...specificInCopy, ...specificInHashtags]).size;
  const specificScore = specificTarget === 0 ? 100 : Math.min(100, Math.round((specificMatched / specificTarget) * 100));
  const tokenTarget = Math.min(4, topicTokens.length);
  const tokenScore = tokenTarget === 0 ? 100 : Math.min(100, Math.round((matchedTopicTokens.length / tokenTarget) * 100));
  const score = Math.round((phraseScore * 0.45) + (specificScore * 0.35) + (tokenScore * 0.20));

  return {
    score,
    phraseAnchors,
    matchedPhrases,
    specificTokens,
    specificInCopy,
    specificInHashtags,
  };
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
  if (/\b(guaranteed|guarantee)\s+(reach|views|ranking|results)\b/i.test(joined)) errors.push("Copy implies guaranteed algorithmic or performance results.");

  const promptLeakInCopy = PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(joined));
  const promptLeakHashtags = hashtags.filter((tag) => PROMPT_LEAK_HASHTAG_TOKENS.has(compact(tag)));
  if (promptLeakInCopy || promptLeakHashtags.length > 0) {
    errors.push("Prompt-leakage gate failed: public copy contains internal generation or control language.");
  }

  const topic = evaluateTopicFidelity({ ...input, hashtags }, context.brief ?? "");
  if (topic.phraseAnchors.length >= 2 && topic.matchedPhrases.size < 2) {
    errors.push("Weekly Topic Fidelity failed: copy/hashtags do not preserve at least two specific topic phrases from this week's brief.");
  }
  if (topic.specificTokens.length > 0 && topic.specificInCopy.length === 0) {
    errors.push("Weekly Topic Fidelity failed: generated copy has drifted away from the specific weekly subject.");
  }
  if (topic.specificTokens.length > 0 && topic.specificInHashtags.length === 0) {
    errors.push("Weekly Topic Fidelity failed: discovery hashtags do not represent the specific weekly subject.");
  }
  if (topic.score < TOPIC_FIDELITY_GATE) {
    errors.push(`Weekly Topic Fidelity score ${topic.score}/100 is below the ${TOPIC_FIDELITY_GATE}/100 hard gate.`);
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

  if (portfolioScore < DISTRIBUTION_PRODUCTION_GATE) errors.push(`Discovery portfolio score ${portfolioScore}/100 is below the ${DISTRIBUTION_PRODUCTION_GATE}/100 production eligibility gate.`);

  return { ok: errors.length === 0, errors, hashtags, portfolioScore, topicFidelityScore: topic.score };
}
