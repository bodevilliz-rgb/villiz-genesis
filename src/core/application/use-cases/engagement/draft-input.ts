export const ENGAGEMENT_CONTENT_BRIEF_MESSAGE =
  "This draft looks like a content brief rather than a finished post. Use AI Generate first, review and save the full post, then run Engagement Intelligence.";

const HIGH_CONFIDENCE_BRIEF_PATTERNS = [
  /^(?:please\s+)?(?:write|create|generate|draft|compose|develop|prepare|produce|make)\s+(?:me\s+)?(?:a|an|the|this)?\s*(?:linkedin|social media|instagram|facebook|tiktok|professional|personal|business|brand|company)?\s*(?:post|caption|introduction|announcement|bio|content)\b/i,
  /^(?:a|an)?\s*(?:professional|personal|business|brand|company)\s+introduction\s+(?:of|for|about)\s+(?:myself|me|the business|the brand|our company)\b/i,
  /^(?:linkedin|instagram|facebook|tiktok|social media)\s+(?:post|caption)\s+(?:about|for|introducing|promoting)\b/i,
  /\b(?:i need|help me write|please draft)\s+(?:a|an)?\s*(?:linkedin|social media|professional|personal)?\s*(?:post|caption|introduction)\b/i,
];

export interface EngagementDraftInputAssessment {
  kind: "finished_post" | "content_brief";
  reason: string | null;
}

/**
 * Intentionally conservative: it blocks only explicit meta-writing requests.
 * Short genuine posts remain valid because length alone is never a signal.
 */
export function assessEngagementDraftInput(body: string): EngagementDraftInputAssessment {
  const normalised = body.trim().replace(/\s+/g, " ");
  const matched = HIGH_CONFIDENCE_BRIEF_PATTERNS.find((pattern) => pattern.test(normalised));
  return matched
    ? { kind: "content_brief", reason: ENGAGEMENT_CONTENT_BRIEF_MESSAGE }
    : { kind: "finished_post", reason: null };
}
