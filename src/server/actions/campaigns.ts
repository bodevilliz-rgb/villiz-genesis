"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { archiveCampaign, createCampaign, updateCampaign } from "@/core/application/use-cases/campaigns";
import { errorState, getAll, successState, text, textOrEmpty, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

function campaignDeps(context: Awaited<ReturnType<typeof requireContext>>) {
  return {
    actor: context.actor,
    campaigns: context.campaigns,
    content: context.content,
    organisations: context.organisations,
  };
}

function campaignFormPayload(formData: FormData) {
  const tagsRaw = textOrEmpty(formData, "tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

  return {
    organisationId: textOrEmpty(formData, "organisationId"),
    name: textOrEmpty(formData, "name"),
    description: textOrEmpty(formData, "description"),
    objective: textOrEmpty(formData, "objective"),
    targetAudience: textOrEmpty(formData, "targetAudience"),
    primaryCTA: textOrEmpty(formData, "primaryCTA"),
    startDate: textOrEmpty(formData, "startDate"),
    endDate: textOrEmpty(formData, "endDate"),
    status: textOrEmpty(formData, "status") || "planning",
    platforms: getAll(formData, "platforms"),
    successMetric: textOrEmpty(formData, "successMetric"),

    // Sprint 2 campaign fields
    client: textOrEmpty(formData, "client"),
    brand: textOrEmpty(formData, "brand"),
    campaignType: textOrEmpty(formData, "campaignType"),
    ownerId: textOrEmpty(formData, "ownerId"),
    teamMembers: [], // default to empty list or parse if present
    colorLabel: textOrEmpty(formData, "colorLabel"),
    tags,
    priority: textOrEmpty(formData, "priority"),
    notes: textOrEmpty(formData, "notes"),
    assets: [],
  };
}

function revalidateCampaigns(organisationId: string, campaignId?: string) {
  revalidatePath(routes.organisations.campaigns.index(organisationId));
  revalidatePath(routes.organisations.detail(organisationId));
  if (campaignId) revalidatePath(routes.organisations.campaigns.detail(organisationId, campaignId));
}

export async function createCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const campaign = await createCampaign(campaignDeps(context), campaignFormPayload(formData));

    revalidateCampaigns(campaign.organisationId, campaign.id);
    return successState("Campaign created.", campaign.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const campaign = await updateCampaign(campaignDeps(context), {
      ...campaignFormPayload(formData),
      id: textOrEmpty(formData, "id"),
    });

    revalidateCampaigns(campaign.organisationId, campaign.id);
    return successState("Campaign saved.", campaign.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function archiveCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const campaign = await archiveCampaign(campaignDeps(context), {
      organisationId: text(formData, "organisationId"),
      campaignId: text(formData, "campaignId"),
    });

    revalidateCampaigns(campaign.organisationId, campaign.id);
    return successState("Campaign archived.", campaign.id);
  } catch (error) {
    return errorState(error);
  }
}
