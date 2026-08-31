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

const HASHTAG_PATTERN = /^[A-Za-z0-9_]+$/;

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
};

function normaliseHashtag(value: string): string {
  return value.trim().replace(/^#+/, "");
}

export function validateDistributionOutput(input: DistributionValidationInput): DistributionValidationResult {
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

  return { ok: errors.length === 0, errors, hashtags };
}
