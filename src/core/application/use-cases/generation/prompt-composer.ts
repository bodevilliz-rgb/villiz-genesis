import type { GenerationContext, PromptSpecification } from "@/core/domain/entities/generation";

/**
 * Phase 6 — Prompt Composer. Reshapes a GenerationContext into a
 * provider-independent structured specification — deliberately NOT a text
 * prompt. No provider's template syntax, message-role convention, or token
 * format appears anywhere here; that translation is the one job left for a
 * future GenerationProvider implementation (see the provider port).
 */
const STANDING_PRINCIPLES = [
  "Never fabricate a factual claim about the business, its products, or its offers.",
  "Follow the brand voice exactly as written — do not soften or embellish it.",
  "Respect every restriction listed in the constraints, without exception.",
  "Write only in the requested content type's format.",
];

function composeGenerationGoal(context: GenerationContext): string {
  if (context.campaign?.objective) {
    return `Support this campaign's objective: ${context.campaign.objective}`;
  }
  return `Produce a ${context.draft.contentType.replace("_", " ")} titled "${context.draft.title}".`;
}

export function composePromptSpecification(context: GenerationContext): PromptSpecification {
  return {
    systemContext: {
      role: "Content writer producing material on behalf of a specific client account.",
      principles: STANDING_PRINCIPLES,
    },
    businessContext: {
      organisationName: context.organisation.name,
      industry: context.organisation.industry,
    },
    campaignContext: context.campaign,
    brandContext: context.brand,
    draftContext: {
      contentType: context.draft.contentType,
      title: context.draft.title,
      currentBody: context.draft.body,
      status: context.draft.status,
    },
    generationGoal: composeGenerationGoal(context),
    constraints: context.brand.restrictions,
  };
}
