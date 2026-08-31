"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { canWriteContent } from "@/core/domain/entities/identity";
import { errorState, successState, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";

const SUPPORTED_PLATFORMS = new Set<CampaignPlatform>([
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "pinterest",
  "threads",
]);

export interface CampaignBuilderInput {
  organisationId: string;
  campaignId: string;
  assetIds: string[];
  platforms: CampaignPlatform[];
  weeks: number;
  firstDate: string;
  time: string;
  timezone: string;
}

function addDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Choose a valid first publishing date.");
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validateInput(input: CampaignBuilderInput) {
  if (!input.organisationId || !input.campaignId) throw new Error("Campaign could not be identified.");
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > 52) throw new Error("Campaign length must be between 1 and 52 weeks.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.firstDate)) throw new Error("Choose a valid first publishing date.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error("Choose a valid publishing time.");
  if (!input.timezone.trim() || input.timezone.length > 100) throw new Error("Choose a valid timezone.");
  if (input.assetIds.length !== input.weeks) throw new Error(`Attach exactly ${input.weeks} campaign images before building the schedule.`);
  if (new Set(input.assetIds).size !== input.assetIds.length) throw new Error("Each campaign week must use a distinct asset.");
  if (input.platforms.length === 0) throw new Error("Select at least one publishing platform.");
  if (input.platforms.some((platform) => !SUPPORTED_PLATFORMS.has(platform))) throw new Error("One or more selected platforms are not supported.");
}

export async function buildCampaignScheduleAction(input: CampaignBuilderInput): Promise<ActionState> {
  try {
    validateInput(input);
    const context = await requireContext();
    const role = await context.organisations.viewerRole(input.organisationId);
    if (!canWriteContent(context.actor, role)) throw new Error("You do not have permission to build this campaign schedule.");

    const campaign = await context.campaigns.findCampaign(input.organisationId, input.campaignId);
    if (!campaign) throw new Error("Campaign not found.");

    const allowedPlatforms = new Set(campaign.platforms);
    if (input.platforms.some((platform) => !allowedPlatforms.has(platform))) {
      throw new Error("Save the selected platforms on the campaign before building its schedule.");
    }

    const availableAssets = await context.media.listAssetsForCampaign(input.campaignId);
    const availableAssetIds = new Set(availableAssets.map((asset) => asset.id));
    if (input.assetIds.some((id) => !availableAssetIds.has(id))) {
      throw new Error("Every scheduled image must already be linked to this campaign.");
    }

    const rows = [];
    for (let week = 1; week <= input.weeks; week += 1) {
      const assetId = input.assetIds[week - 1];
      const scheduledDate = addDays(input.firstDate, (week - 1) * 7);
      for (const platform of input.platforms) {
        rows.push({
          organisation_id: input.organisationId,
          campaign_id: input.campaignId,
          asset_id: assetId,
          week_number: week,
          platform,
          scheduled_date: scheduledDate,
          scheduled_time: `${input.time}:00`,
          timezone: input.timezone,
          status: "planned",
          created_by: context.actor.id,
          updated_at: new Date().toISOString(),
        });
      }
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("campaign_schedule_slots")
      .upsert(rows, { onConflict: "campaign_id,week_number,platform" });
    if (error) throw new Error(`Campaign schedule could not be saved: ${error.message}`);

    revalidatePath(routes.organisations.campaigns.detail(input.organisationId, input.campaignId));
    return successState(`${input.weeks}-week schedule created across ${input.platforms.length} platform${input.platforms.length === 1 ? "" : "s"}.`);
  } catch (error) {
    return errorState(error);
  }
}
