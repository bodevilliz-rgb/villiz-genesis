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
