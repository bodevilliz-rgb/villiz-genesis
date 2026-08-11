import type {
  LinkedInPersonalProfileGuidance,
  LinkedInReadinessDimensions,
} from "@/core/domain/entities/engagement";
import { z } from "zod";

export const linkedInPersonalProfileAuditSchema = z.object({
  dimensions: z.object({
    hook: z.number().int().min(0).max(5),
    singleIdea: z.number().int().min(0).max(5),
    personalVoice: z.number().int().min(0).max(5),
    credibility: z.number().int().min(0).max(5),
    scanability: z.number().int().min(0).max(5),
    conversationCta: z.number().int().min(0).max(5),
  }),
  audiencePromise: z.string().trim().min(1).max(500),
  credibilityAnchor: z.string().trim().min(1).max(500),
  credibilityEvidenceIds: z.array(z.string().uuid()).max(5),
  conversationPrompt: z.string().trim().min(1).max(500),
  improvementActions: z.array(z.string().trim().min(1).max(500)).max(5),
  blockingFindings: z.array(z.object({
    type: z.enum(["unsupported_claim", "invented_credential", "performance_promise"]),
    excerpt: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(500),
  })).max(10),
});

export type LinkedInPersonalProfileAudit = z.infer<typeof linkedInPersonalProfileAuditSchema>;

export const LINKEDIN_PERSONAL_PROFILE_RULES = `LinkedIn personal-profile mode:
- The destination is a person's LinkedIn profile, never a company Page.
- Write as a credible human professional, not as a faceless corporate announcement.
- Use only MemBrain-supported identity, role, experience, results and claims. If the speaker identity or evidence is missing, do not invent it.
- Centre the post on one professional idea and make the reader value clear in the opening lines.
- Prefer short, scannable paragraphs and a natural conversation invitation. Avoid engagement bait, algorithm claims and guaranteed outcomes.
- Hashtags must be relevant and evidence-supported; never invent a trending tag.
- Set creativeGuidance.linkedinPersonalProfile to a complete personal-profile draft. If provisional dimensions are requested by the output schema, use integer scores from 0 to 5 only.
- A separate audit will discard and replace every provisional score and validate all claims, so do not describe the generator's score as independently verified.`;

export const LINKEDIN_AUDIT_SYSTEM_PROMPT = `You are the independent LinkedIn grounding and editorial audit pass for Project Genesis.

Audit the recommended caption, every alternative caption, hashtags, rationale, predicted strengths and all displayed creative/LinkedIn guidance against only the supplied MemBrain context and evidence index. Score the recommended caption; grounding findings cover both applyable payloads and operator-facing explanations.

Rules:
- Treat every personal title, role, credential, experience, client result, statistic, location, service and performance statement as unsupported unless the supplied MemBrain evidence directly supports it.
- General world knowledge does not support a client-specific claim.
- Put every unsupported statement in blockingFindings using the shortest exact excerpt.
- Flag invented titles or roles as invented_credential.
- Flag promises or implications of increased visibility, reach, engagement, leads or sales as performance_promise unless MemBrain directly supports the precise historical claim. Never treat a recommendation as proof of future results.
- Score the six editorial dimensions independently from 0 to 5. Do not inherit or defer to the generator's scores.
- credibilityEvidenceIds may contain only exact IDs from the supplied evidence index. Use an empty array and score credibility 0 when no entry supports a credibility anchor.
- improvementActions must be concrete edits an operator can make before publishing. Never include replying to future comments, monitoring performance or other post-publication activity.
- Do not invent a replacement fact. Return structured data only.`;

export function buildLinkedInAuditPrompt(input: {
  caption: string;
  alternativeCaptions: string[];
  hashtags: Record<string, string[]>;
  hook: string;
  cta: string;
  displayedGuidance: Record<string, unknown>;
  rationale: string;
  predictedStrengths: string[];
  limitations: string[];
  contextPrompt: string;
  evidenceIndex: Array<{ id: string; title: string }>;
}): string {
  return `Recommended caption:\n${input.caption}\n\nAlternative captions:\n${input.alternativeCaptions.map((caption, index) => `${index + 1}. ${caption}`).join("\n\n")}\n\nHook:\n${input.hook}\n\nCTA:\n${input.cta}\n\nHashtag groups:\n${JSON.stringify(input.hashtags)}\n\nRationale:\n${input.rationale}\n\nPredicted strengths:\n${input.predictedStrengths.join("\n")}\n\nLimitations:\n${input.limitations.join("\n")}\n\nDisplayed creative and LinkedIn guidance:\n${JSON.stringify(input.displayedGuidance)}\n\nAuthoritative MemBrain context:\n${input.contextPrompt}\n\nEvidence index (use these exact IDs only):\n${input.evidenceIndex.map((item) => `${item.id} | ${item.title}`).join("\n")}`;
}

export function auditValidationFindings(
  audit: LinkedInPersonalProfileAudit,
  allowedEvidenceIds: Set<string>,
): string[] {
  const findings = audit.blockingFindings.map((finding) => `${finding.type}: ${finding.excerpt} — ${finding.reason}`);
  const invalidIds = audit.credibilityEvidenceIds.filter((id) => !allowedEvidenceIds.has(id));
  if (invalidIds.length > 0) findings.push("The audit referenced MemBrain evidence IDs that were not supplied.");
  if (audit.dimensions.credibility > 0 && audit.credibilityEvidenceIds.length === 0) {
    findings.push("The credibility score was above zero without a supporting MemBrain evidence ID.");
  }
  return findings;
}

export function applyLinkedInAudit(
  guidance: LinkedInPersonalProfileGuidance,
  audit: LinkedInPersonalProfileAudit,
  auditAttempts: 1 | 2,
): LinkedInPersonalProfileGuidance {
  return normaliseLinkedInPersonalProfileGuidance({
    ...guidance,
    dimensions: audit.dimensions,
    audiencePromise: audit.audiencePromise,
    credibilityAnchor: audit.credibilityAnchor,
    conversationPrompt: audit.conversationPrompt,
    improvementActions: audit.improvementActions,
    credibilityEvidenceIds: [...new Set(audit.credibilityEvidenceIds)],
    auditStatus: "passed",
    auditAttempts,
  });
}

export function linkedInReadinessScore(dimensions: LinkedInReadinessDimensions): number {
  const values = [
    dimensions.hook,
    dimensions.singleIdea,
    dimensions.personalVoice,
    dimensions.credibility,
    dimensions.scanability,
    dimensions.conversationCta,
  ];
  const boundedTotal = values.reduce((total, value) => total + Math.max(0, Math.min(5, value)), 0);
  return Math.round((boundedTotal / 30) * 100);
}

export function normaliseLinkedInPersonalProfileGuidance(
  guidance: LinkedInPersonalProfileGuidance,
): LinkedInPersonalProfileGuidance {
  return {
    ...guidance,
    accountType: "personal_profile",
    readinessScore: linkedInReadinessScore(guidance.dimensions),
    improvementActions: [...new Set(guidance.improvementActions)].slice(0, 5),
  };
}
