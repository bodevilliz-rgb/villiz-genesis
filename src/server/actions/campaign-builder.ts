"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { canWriteContent } from "@/core/domain/entities/identity";
import { createDraft, createGenerationRequest } from "@/core/application/use-cases/content";
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

type CampaignScheduleRow = {
  organisation_id: string;
  campaign_id: string;
  asset_id: string | undefined;
  week_number: number;
  platform: CampaignPlatform;
  scheduled_date: string;
  scheduled_time: string;
  timezone: string;
  status: "planned";
  created_by: string;
  updated_at: string;
};

type SavedScheduleSlot = CampaignScheduleRow & {
  id: string;
  draft_id: string | null;
};

type ScheduleTableWriter = {
  from: (relation: "campaign_schedule_slots") => {
    upsert: (
      rows: CampaignScheduleRow[],
      options: { onConflict: string },
    ) => {
      select: (columns: string) => PromiseLike<{ data: SavedScheduleSlot[] | null; error: { message: string } | null }>;
    };
    update: (values: { draft_id: string; status: "ready"; updated_at: string }) => {
      eq: (column: "id", value: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

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

    const rows: CampaignScheduleRow[] = [];
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

    // The migration in this branch introduces campaign_schedule_slots. The generated
    // database contract is refreshed after migration application; keep the escape hatch
    // narrow to this table so the rest of Genesis remains fully generated/type-checked.
    const scheduleWriter = createAdminClient() as unknown as ScheduleTableWriter;
    const { data: slots, error } = await scheduleWriter
      .from("campaign_schedule_slots")
      .upsert(rows, { onConflict: "campaign_id,week_number,platform" })
      .select("id,organisation_id,campaign_id,asset_id,week_number,platform,scheduled_date,scheduled_time,timezone,status,created_by,updated_at,draft_id");
    if (error) throw new Error(`Campaign schedule could not be saved: ${error.message}`);
    if (!slots) throw new Error("Campaign schedule was saved but could not be prepared for Awo.");

    const contentDeps = {
      actor: context.actor,
      content: context.content,
      membrain: context.membrain,
      organisations: context.organisations,
    };

    let preparedDrafts = 0;
    for (const slot of slots) {
      if (slot.draft_id) continue;

      const draft = await createDraft(contentDeps, {
        organisationId: input.organisationId,
        title: `${campaign.name} — Week ${slot.week_number} — ${slot.platform}`,
        contentType: "social_post",
        campaignId: input.campaignId,
        summary: `Campaign Builder slot for ${slot.platform}, week ${slot.week_number}, scheduled ${slot.scheduled_date} ${slot.scheduled_time} ${slot.timezone}.`,
        body: "",
        hashtags: [],
      });

      if (slot.asset_id) {
        await context.media.attachToDraft(draft.id, slot.asset_id, context.actor.id);
      }

      await createGenerationRequest(contentDeps, {
        organisationId: input.organisationId,
        draftId: draft.id,
        brief: [
          `Prepare Week ${slot.week_number} of the campaign “${campaign.name}” for ${slot.platform}.`,
          campaign.objective ? `Campaign objective: ${campaign.objective}.` : "",
          campaign.primaryCTA ? `Primary CTA: ${campaign.primaryCTA}.` : "",
          "Use the organisation MemBrain and current Market Intelligence evidence when Awo generates the platform-specific caption, hook, CTA and discovery strategy.",
          "The post must pass the Audience Distribution Gate before approval or scheduling.",
        ].filter(Boolean).join(" "),
        targetAudience: campaign.targetAudience ?? "",
        tone: "Use the approved brand voice and platform-appropriate delivery.",
        contentPillarCategoryId: "",
      });

      const updateResult = await scheduleWriter
        .from("campaign_schedule_slots")
        .update({ draft_id: draft.id, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", slot.id);
      if (updateResult.error) throw new Error(`Campaign slot could not be linked to its Awo draft: ${updateResult.error.message}`);
      preparedDrafts += 1;
    }

    revalidatePath(routes.organisations.campaigns.detail(input.organisationId, input.campaignId));
    revalidatePath(routes.organisations.content.index(input.organisationId));
    return successState(
      `${input.weeks}-week schedule created across ${input.platforms.length} platform${input.platforms.length === 1 ? "" : "s"}. ${preparedDrafts} platform-specific draft${preparedDrafts === 1 ? "" : "s"} prepared for Awo, Market Intelligence and Growth tracking.`,
    );
  } catch (error) {
    return errorState(error);
  }
}
