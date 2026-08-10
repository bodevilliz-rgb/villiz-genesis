"use server";

import { z } from "zod";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import { generateEngagementRecommendation } from "@/core/application/use-cases/engagement";
import type { EngagementRecommendation } from "@/core/domain/entities/engagement";
import { isDomainError } from "@/core/domain/errors";
import { requireContext } from "../container";
import {
  extractAwoMembrainContext,
  buildCaptionSystemPrompt,
  buildRewriteSystemPrompt,
  classifyContentIntent,
  type GenerationIntentHints,
  type GenerationGuidedContext,
} from "./awo-grounding";
import {
  detectComplianceViolations,
  repairComplianceViolations,
} from "@/core/application/use-cases/generation/compliance";

/**
 * Runs post-generation compliance: detects prohibited terms from MemBrain
 * restrictions and attempts coherence-safe lexical repair.
 *
 * Returns:
 *   { text }                         — clean, no violations detected
 *   { text: repaired }               — violations found and safely repaired
 *   { text: original, warning }      — violations found but repair was unsafe;
 *                                      caller must surface the warning
 */
function applyComplianceCheck(
  text: string,
  restrictions: string[],
): { text: string; complianceWarning?: string } {
  if (restrictions.length === 0) return { text };

  const violations = detectComplianceViolations(text, restrictions);
  if (violations.length === 0) return { text };

  const repairResult = repairComplianceViolations(text, violations);
  if (repairResult.safe) {
    return { text: repairResult.body };
  }

  return {
    text,
    complianceWarning: `REVIEW REQUIRED: Found prohibited term(s) (${violations.join(", ")}) that could not be automatically repaired. This output must be reviewed before use.`,
  };
}

export type EngagementRecommendationActionResult =
  | { ok: true; recommendation: EngagementRecommendation }
  | { ok: false; error: string };

export async function generateEngagementRecommendationAction(input: {
  organisationId: string;
  draftId: string;
  platform: string;
  objective?: string;
}): Promise<EngagementRecommendationActionResult> {
  try {
    const context = await requireContext();
    const recommendation = await generateEngagementRecommendation(
      {
        actor: context.actor,
        organisations: context.organisations,
        campaigns: context.campaigns,
        content: context.content,
        membrain: context.membrain,
        engagement: context.engagement,
        ai: getAIProvider(),
      },
      input,
    );
    return { ok: true, recommendation };
  } catch (error) {
    console.error("[genesis] engagement recommendation failed", error);
    return {
      ok: false,
      error: isDomainError(error)
        ? error.message
        : "AWO could not generate an engagement recommendation. Try again shortly.",
    };
  }
}

export async function generateCaption(
  organisationId: string,
  prompt: string,
  platform: string,
  intentHints?: GenerationIntentHints,
  guidedContext?: GenerationGuidedContext,
): Promise<{ text: string; complianceWarning?: string }> {
  const context = await requireContext();
  const org = await context.organisations.findById(organisationId);
  const orgName = org?.name || "the organisation";

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const ctx = extractAwoMembrainContext(membrain);
  const intent = classifyContentIntent(prompt, ctx, intentHints ?? {});
  const systemPrompt = buildCaptionSystemPrompt(orgName, platform, ctx, intent, prompt, guidedContext);

  const ai = getAIProvider();
  const text = await ai.generateText(prompt, { systemPrompt });

  return applyComplianceCheck(text, ctx.restrictions);
}

export async function rewriteContent(
  organisationId: string,
  content: string,
  instruction: "expand" | "shorten" | "professional" | "casual" | "punchy",
): Promise<{ text: string; complianceWarning?: string }> {
  const context = await requireContext();
  const org = await context.organisations.findById(organisationId);
  const orgName = org?.name || "the organisation";

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const ctx = extractAwoMembrainContext(membrain);

  let modifier = "";
  if (instruction === "expand") modifier = "Expand this content, adding more detail and depth.";
  if (instruction === "shorten") modifier = "Shorten this content, making it concise and to the point.";
  if (instruction === "professional") modifier = "Rewrite this to be highly professional and formal.";
  if (instruction === "casual") modifier = "Rewrite this to be casual and friendly.";
  if (instruction === "punchy") modifier = "Rewrite this to be punchy, energetic, and high-impact.";

  const systemPrompt = buildRewriteSystemPrompt(orgName, modifier, ctx);

  const ai = getAIProvider();
  const text = await ai.generateText(content, { systemPrompt });

  return applyComplianceCheck(text, ctx.restrictions);
}

export async function generateHashtags(
  organisationId: string,
  content: string,
  count: number = 5,
): Promise<{ hashtags: string[] }> {
  const context = await requireContext();

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const ctx = extractAwoMembrainContext(membrain);

  const ai = getAIProvider();
  const brandVoiceCtx = ctx.brandVoice.join("\n") || "Professional.";
  const systemPrompt = `You are an expert social media manager. Suggest exactly ${count} highly relevant hashtags for the provided content. Ensure they align with the Brand Voice: ${brandVoiceCtx}`;

  const schema = z.object({
    hashtags: z.array(z.string()).describe("The suggested hashtags, including the # symbol"),
  });

  const result = await ai.generateObject(content, schema, { systemPrompt });
  return result;
}

