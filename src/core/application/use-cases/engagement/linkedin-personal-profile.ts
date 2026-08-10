import type {
  LinkedInPersonalProfileGuidance,
  LinkedInReadinessDimensions,
} from "@/core/domain/entities/engagement";

export const LINKEDIN_PERSONAL_PROFILE_RULES = `LinkedIn personal-profile mode:
- The destination is a person's LinkedIn profile, never a company Page.
- Write as a credible human professional, not as a faceless corporate announcement.
- Use only MemBrain-supported identity, role, experience, results and claims. If the speaker identity or evidence is missing, do not invent it.
- Centre the post on one professional idea and make the reader value clear in the opening lines.
- Prefer short, scannable paragraphs and a natural conversation invitation. Avoid engagement bait, algorithm claims and guaranteed outcomes.
- Hashtags must be relevant and evidence-supported; never invent a trending tag.
- Set creativeGuidance.linkedinPersonalProfile to a complete personal-profile assessment. Score each rubric dimension from 0 to 5 and provide only the most useful improvement actions.`;

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
