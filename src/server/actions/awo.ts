"use server";

import { z } from "zod";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import { requireContext } from "../container";
import {
  extractAwoMembrainContext,
  buildCaptionSystemPrompt,
  buildRewriteSystemPrompt,
  classifyContentIntent,
  type GenerationIntentHints,
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

export async function generateCaption(
  organisationId: string,
  prompt: string,
  platform: string,
  intentHints?: GenerationIntentHints,
): Promise<{ text: string; complianceWarning?: string }> {
  const context = await requireContext();
  const org = await context.organisations.findById(organisationId);
  const orgName = org?.name || "the organisation";

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const ctx = extractAwoMembrainContext(membrain);
  const intent = classifyContentIntent(prompt, ctx, intentHints ?? {});
  const systemPrompt = buildCaptionSystemPrompt(orgName, platform, ctx, intent, prompt);

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
