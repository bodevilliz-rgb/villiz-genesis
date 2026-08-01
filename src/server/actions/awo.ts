"use server";

import { z } from "zod";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import { requireContext } from "../container";

export async function generateCaption(
  organisationId: string,
  prompt: string,
  platform: string
): Promise<{ text: string }> {
  const context = await requireContext();
  const org = await context.organisations.findById(organisationId);
  const orgName = org?.name || "the organisation";

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const brandVoiceGroup = membrain.groups.find(g => g.category.label === "Brand Voice & Positioning");
  const brandVoiceCtx = brandVoiceGroup?.entries.map(e => `${e.title}: ${e.body}`).join("\n") || "Professional, engaging, and clear.";

  const audienceGroup = membrain.groups.find(g => g.category.label === "Target Audience");
  const audienceCtx = audienceGroup?.entries.map(e => `${e.title}: ${e.body}`).join("\n") || "General audience.";

  const ai = getAIProvider();
  const systemPrompt = `You are AWO, the AI Work Optimiser for ${orgName}.
You write high-quality social media content.
Platform: ${platform}
Target Audience:
${audienceCtx}
Brand Voice & Tone Context:
${brandVoiceCtx}

Respond ONLY with the generated caption.`;

  const text = await ai.generateText(prompt, { systemPrompt });
  return { text };
}

export async function rewriteContent(
  organisationId: string,
  content: string,
  instruction: "expand" | "shorten" | "professional" | "casual" | "punchy"
): Promise<{ text: string }> {
  const context = await requireContext();
  const org = await context.organisations.findById(organisationId);
  const orgName = org?.name || "the organisation";

  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const brandVoiceGroup = membrain.groups.find(g => g.category.label === "Brand Voice & Positioning");
  const brandVoiceCtx = brandVoiceGroup?.entries.map(e => `${e.title}: ${e.body}`).join("\n") || "Professional, engaging, and clear.";

  const ai = getAIProvider();
  
  let modifier = "";
  if (instruction === "expand") modifier = "Expand this content, adding more detail and depth.";
  if (instruction === "shorten") modifier = "Shorten this content, making it concise and to the point.";
  if (instruction === "professional") modifier = "Rewrite this to be highly professional and formal.";
  if (instruction === "casual") modifier = "Rewrite this to be casual and friendly.";
  if (instruction === "punchy") modifier = "Rewrite this to be punchy, energetic, and high-impact.";

  const systemPrompt = `You are AWO, the AI Work Optimiser for ${orgName}.
Your task is to edit content.
Instruction: ${modifier}
Brand Voice Context:
${brandVoiceCtx}
Respond ONLY with the rewritten content. Do not include any explanations.`;

  const text = await ai.generateText(content, { systemPrompt });
  return { text };
}

export async function generateHashtags(
  organisationId: string,
  content: string,
  count: number = 5
): Promise<{ hashtags: string[] }> {
  const context = await requireContext();
  
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const { getMembrainOverview } = await import("@/core/application/use-cases/membrain");
  const membrain = await getMembrainOverview(membrainDeps, organisationId);

  const brandVoiceGroup = membrain.groups.find(g => g.category.label === "Brand Voice & Positioning");
  const brandVoiceCtx = brandVoiceGroup?.entries.map(e => `${e.title}: ${e.body}`).join("\n") || "Professional.";

  const ai = getAIProvider();
  const systemPrompt = `You are an expert social media manager. Suggest exactly ${count} highly relevant hashtags for the provided content. Ensure they align with the Brand Voice: ${brandVoiceCtx}`;

  const schema = z.object({
    hashtags: z.array(z.string()).describe("The suggested hashtags, including the # symbol"),
  });

  const result = await ai.generateObject(content, schema, { systemPrompt });
  return result;
}
