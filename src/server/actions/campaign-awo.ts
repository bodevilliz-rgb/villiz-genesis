"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "../container";
import { errorState, successState, type ActionState } from "../action-result";
import { getCampaignSchedule } from "@/server/queries/campaign-schedule";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import { getDraft, getLatestGenerationRequest, updateDraft } from "@/core/application/use-cases/content";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

const generatedSocialPostSchema = z.object({
  caption: z.string().min(20).max(2200),
  hashtags: z.array(z.string().min(2).max(80)).max(30),
  hook: z.string().min(4).max(240),
  cta: z.string().min(2).max(240),
});

export async function optimiseCampaignWithAwoAction(
  organisationId: string,
  campaignId: string,
): Promise<ActionState> {
  try {
    const context = await requireContext();
    const role = await context.organisations.viewerRole(organisationId);
    if (!canWriteContent(context.actor, role)) throw new Error("You do not have permission to optimise this campaign.");

    const campaign = await context.campaigns.findCampaign(organisationId, campaignId);
    if (!campaign) throw new Error("Campaign not found.");

    const schedule = await getCampaignSchedule(campaignId);
    const slots = schedule.filter((slot) => slot.draftId);
    if (!slots.length) throw new Error("Build the campaign schedule before asking Awo to optimise it.");

    const ai = getAIProvider();
    const contentDeps = {
      actor: context.actor,
      content: context.content,
      membrain: context.membrain,
      organisations: context.organisations,
    };

    let optimised = 0;
    const failures: string[] = [];

    for (const slot of slots) {
      try {
        const draft = await getDraft(contentDeps, organisationId, slot.draftId!);
        if (draft.body.trim() && draft.hashtags.length) {
          optimised += 1;
          continue;
        }

        const request = await getLatestGenerationRequest(contentDeps, organisationId, draft.id);
        if (!request) throw new Error("No Awo generation request exists for this draft.");

        const platformInstruction = slot.platform === "tiktok"
          ? "Write for TikTok: conversational, fast hook, searchable natural-language keywords, concise CTA."
          : slot.platform === "instagram"
            ? "Write for Instagram: strong opening line, skimmable caption, relevant discovery hashtags, concise CTA."
            : `Write specifically for ${slot.platform}.`;

        const prompt = [
          `You are Awo, the campaign intelligence writer for ${campaign.name}.`,
          `Week ${slot.weekNumber}. Platform: ${slot.platform}.`,
          platformInstruction,
          request.brief,
          request.targetAudience ? `Target audience: ${request.targetAudience}.` : "",
          request.tone ? `Tone: ${request.tone}.` : "",
          `Brand and MemBrain context:\n${request.memBrainContextPrompt}`,
          "Return a platform-ready caption, hashtags without duplicates, a hook and CTA. Avoid fabricated claims. Keep hashtags genuinely relevant rather than generic stuffing.",
        ].filter(Boolean).join("\n\n");

        const generated = await ai.generateObject(prompt, generatedSocialPostSchema, {
          systemPrompt: "Create evidence-grounded social content. Follow supplied brand context and campaign objective. Do not invent offers, prices, locations, testimonials, credentials or facts.",
          temperature: 0.55,
        });

        const hashtags = [...new Set(generated.hashtags.map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean))];
        const body = `${generated.hook}\n\n${generated.caption}\n\n${generated.cta}`.trim();

        await updateDraft(contentDeps, {
          organisationId,
          id: draft.id,
          title: draft.title,
          contentType: draft.contentType,
          categoryId: draft.category?.id ?? "",
          campaignId,
          summary: draft.summary ?? "",
          body,
          dueAt: draft.dueAt ?? "",
          reviewerIds: draft.reviewerIds,
          priority: draft.priority,
          reviewDeadline: draft.reviewDeadline ?? "",
          hashtags,
          changeSummary: `Awo optimised Week ${slot.weekNumber} for ${slot.platform}.`,
        });

        await context.content.updateStatus(organisationId, draft.id, "needs_review", context.actor.id);
        optimised += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown optimisation error";
        failures.push(`Week ${slot.weekNumber} ${slot.platform}: ${message}`);
      }
    }

    revalidatePath(routes.organisations.campaigns.detail(organisationId, campaignId));
    revalidatePath(routes.organisations.content.index(organisationId));

    if (failures.length) {
      return {
        status: "error",
        message: `Awo optimised ${optimised}/${slots.length} posts. ${failures.slice(0, 3).join(" | ")}${failures.length > 3 ? ` | +${failures.length - 3} more` : ""}`,
      };
    }

    return successState(`Awo optimised all ${optimised} campaign posts. They are ready for review and the quality gate.`);
  } catch (error) {
    return errorState(error);
  }
}
