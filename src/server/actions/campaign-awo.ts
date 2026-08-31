"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { errorState, successState, type ActionState } from "../action-result";
import { getCampaignSchedule } from "@/server/queries/campaign-schedule";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

type InsertResult = { data: { id: string } | null; error: { code?: string; message: string } | null };
type JobWriter = {
  from: (table: "awo_campaign_jobs") => {
    insert: (values: Record<string, unknown>) => {
      select: (columns: "id") => { single: () => PromiseLike<InsertResult> };
    };
  };
};

export async function optimiseCampaignWithAwoAction(
  organisationId: string,
  campaignId: string,
): Promise<ActionState> {
  try {
    const context = await requireContext();
    const role = await context.organisations.viewerRole(organisationId);
    if (!canWriteContent(context.actor, role)) {
      throw new Error("You do not have permission to optimise this campaign.");
    }

    const campaign = await context.campaigns.findCampaign(organisationId, campaignId);
    if (!campaign) throw new Error("Campaign not found.");

    const schedule = await getCampaignSchedule(campaignId);
    const slots = schedule.filter((slot) => slot.draftId);
    if (!slots.length) throw new Error("Build the campaign schedule before asking Awo to optimise it.");

    const drafts = await Promise.all(slots.map((slot) => context.content.findDraft(organisationId, slot.draftId!)));
    const alreadyOptimised = drafts.filter((draft) => draft && draft.body.trim() && draft.hashtags.length).length;
    if (alreadyOptimised >= slots.length) {
      return successState(`All ${slots.length} campaign posts are already optimised and ready for review.`);
    }

    const db = context.client as unknown as JobWriter;
    const { error } = await db.from("awo_campaign_jobs").insert({
      organisation_id: organisationId,
      campaign_id: campaignId,
      requested_by: context.actor.id,
      status: "queued",
      total_posts: slots.length,
      completed_posts: alreadyOptimised,
      failed_posts: 0,
    }).select("id").single();

    if (error) {
      if (error.code === "23505") {
        return successState(`Awo is already working on this campaign. Progress will update automatically.`);
      }
      if (error.code === "42P01" || /awo_campaign_jobs/i.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
        throw new Error("The Awo background queue is not activated in production yet. Engineering must apply the Awo campaign jobs migration.");
      }
      throw new Error(`Could not queue Awo optimisation: ${error.message}`);
    }

    revalidatePath(routes.organisations.campaigns.detail(organisationId, campaignId));
    return successState(`Awo queued ${slots.length - alreadyOptimised} unfinished posts. You can leave this page; progress will update in the background.`);
  } catch (error) {
    return errorState(error);
  }
}
