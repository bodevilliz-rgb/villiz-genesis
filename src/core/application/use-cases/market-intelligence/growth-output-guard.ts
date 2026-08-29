const OCCASION_TERMS = ["birthday", "wedding", "anniversary", "graduation", "milestone", "event", "personal brand"] as const;
const PROCESS_CLAIM = /\b(?:we|our)\b[^.!?\n]{0,140}\b(?:every|all|always|process|sessions?|shoots?|clients?)\b|\bevery\s+(?:session|shoot|client|customer|project)\b/i;
const BOOKING_ESCALATION = /\b(?:book|booking|reserve|secure|pay|purchase)(?:\s+(?:your|a|the))?\b/i;
const WEAK_OPENING = /^\s*(?:ready for|looking for|capture your|create memories|bring your (?:creative )?vision to life)\b/i;
const GENERIC_PHRASES = [/\bbring your (?:creative )?vision (?:to life|into focus)\b/i, /\bevery detail is (?:carefully|thoughtfully) considered\b/i, /\bwhere (?:creativity|quality|style|passion) meets (?:excellence|expertise|innovation)\b/i, /\btake \w+ to the next level\b/i] as const;

export function supportedOccasionTerms(evidence: string): string[] {
  const normalised = evidence.toLocaleLowerCase();
  return OCCASION_TERMS.filter((term) => normalised.includes(term));
}

export function growthOutputViolations(input: { caption: string; evidence: string; conversionActions: string[] }): string[] {
  const violations: string[] = [];
  if (PROCESS_CLAIM.test(input.caption)) violations.push("The caption turns asset evidence into a universal or established client-process claim.");
  if (WEAK_OPENING.test(input.caption)) violations.push("The caption opens with a generic promotional hook instead of specific tension, curiosity, desire, identity, objection resolution, emotion, proof or usefulness.");
  if (GENERIC_PHRASES.some((pattern) => pattern.test(input.caption))) violations.push("The caption contains generic agency or cliché language that does not communicate a specific audience difference.");
  const firstSentence = input.caption.split(/[.!?]/, 1)[0] ?? "";
  if (/^\s*(?:we|our|at\s+\S+)/i.test(firstSentence)) violations.push("The opening makes the organisation the hero instead of the audience's want, problem or desired difference.");
  const allowed = new Set(supportedOccasionTerms(input.evidence));
  for (const term of OCCASION_TERMS) if (!allowed.has(term) && new RegExp(`\\b${term.replace(" ", "\\s+")}s?\\b`, "i").test(input.caption)) violations.push(`The caption introduces unsupported current-asset occasion/service language: ${term}.`);
  const enquiryOnly = input.conversionActions.length > 0 && input.conversionActions.every((action) => /enquir|message|whatsapp|contact/i.test(action));
  if (enquiryOnly && BOOKING_ESCALATION.test(input.caption)) violations.push("The caption escalates an enquiry-only conversion action to booking, reservation or purchase.");
  return violations;
}

export function filterUnsupportedOccasionHashtags(hashtags: string[], evidence: string): string[] {
  const allowed = new Set(supportedOccasionTerms(evidence));
  return hashtags.filter((hashtag) => {
    const token = hashtag.replaceAll(/[^a-z]/gi, "").toLocaleLowerCase();
    return !OCCASION_TERMS.some((term) => !allowed.has(term) && token.includes(term.replace(" ", "")));
  });
}
