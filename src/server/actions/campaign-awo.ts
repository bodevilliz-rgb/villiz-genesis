"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { errorState, successState, type ActionState } from "../action-result";
import { getCampaignSchedule } from "@/server/queries/campaign-schedule";
import { getLatestCampaignAwoJob, type CampaignAwoJobView } from "@/server/queries/campaign-awo-job";
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

export async function getCampaignAwoJobStatusAction(
  organisationId: string,
  campaignId: string,
): Promise<CampaignAwoJobView | null> {
  const context = await requireContext();
  const campaign = await context.campaigns.findCampaign(organisationId, campaignId);
  if (!campaign) return null;
  return getLatestCampaignAwoJob(campaignId);
}

async function queueCampaignAwoJob(
  organisationId: string,
  campaignId: string,
  mode: "unfinished" | "distribution_reoptimise",
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

    if (mode === "unfinished" && alreadyOptimised >= slots.length) {
      return successState(`All ${slots.length} campaign posts are already optimised and ready for review.`);
    }

    const db = context.client as unknown as JobWriter;
    const { error } = await db.from("awo_campaign_jobs").insert({
      organisation_id: organisationId,
      campaign_id: campaignId,
      requested_by: context.actor.id,
      status: "queued",
      mode,
      total_posts: slots.length,
      completed_posts: mode === "distribution_reoptimise" ? 0 : alreadyOptimised,
      failed_posts: 0,
    }).select("id").single();

    if (error) {
      if (error.code === "23505") {
        return successState("Awo is already working on this campaign. Progress will update automatically.");
      }
      if (error.code === "42P01" || (/awo_campaign_jobs/i.test(error.message) && /does not exist|schema cache/i.test(error.message))) {
        throw new Error("The Awo background queue is not activated in production yet. Engineering must apply the Awo campaign jobs migration.");
      }
      if (/mode/i.test(error.message) && /column|schema cache|does not exist/i.test(error.message)) {
        throw new Error("Distribution re-optimisation is not activated in production yet. Engineering must apply the Awo distribution mode migration.");
      }
      throw new Error(`Could not queue Awo optimisation: ${error.message}`);
    }

    revalidatePath(routes.organisations.campaigns.detail(organisationId, campaignId));
    if (mode === "distribution_reoptimise") {
      return successState(`Awo queued all ${slots.length} posts for Distribution Intelligence v2. Artwork and schedule stay unchanged; regenerated copy returns to review.`);
    }
    return successState(`Awo queued ${slots.length - alreadyOptimised} unfinished posts. You can leave this page; progress will update in the background.`);
  } catch (error) {
    return errorState(error);
  }
}

export async function optimiseCampaignWithAwoAction(
  organisationId: string,
  campaignId: string,
): Promise<ActionState> {
  return queueCampaignAwoJob(organisationId, campaignId, "unfinished");
}

export async function reoptimiseCampaignDistributionWithAwoAction(
  organisationId: string,
  campaignId: string,
): Promise<ActionState> {
  return queueCampaignAwoJob(organisationId, campaignId, "distribution_reoptimise");
}
