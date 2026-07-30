"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import {
  assignOrganisationMember,
  createOrganisation,
  removeOrganisationMember,
  updateOrganisation,
  updateOrganisationLimits,
} from "@/core/application/use-cases/organisations";
import { errorState, successState, text, textOrEmpty, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

function organisationFormPayload(formData: FormData) {
  return {
    name: textOrEmpty(formData, "name"),
    legalName: textOrEmpty(formData, "legalName"),
    industry: textOrEmpty(formData, "industry"),
    websiteUrl: textOrEmpty(formData, "websiteUrl"),
    status: textOrEmpty(formData, "status") || "prospect",
    brandColour: textOrEmpty(formData, "brandColour"),
    primaryContactName: textOrEmpty(formData, "primaryContactName"),
    primaryContactEmail: textOrEmpty(formData, "primaryContactEmail"),
    notes: textOrEmpty(formData, "notes"),
  };
}

export async function createOrganisationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisation = await createOrganisation(
      { actor: context.actor, organisations: context.organisations },
      organisationFormPayload(formData),
    );

    revalidatePath(routes.organisations.index);
    revalidatePath(routes.dashboard);
    return successState(`${organisation.name} is now on Project Genesis.`, organisation.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateOrganisationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const context = await requireContext();
    const id = text(formData, "id");
    const organisation = await updateOrganisation(
      { actor: context.actor, organisations: context.organisations },
      { ...organisationFormPayload(formData), id },
    );

    revalidatePath(routes.organisations.index);
    revalidatePath(routes.organisations.detail(organisation.id));
    return successState("Client details saved.", organisation.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function assignMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId");

    await assignOrganisationMember(
      { actor: context.actor, organisations: context.organisations },
      {
        organisationId,
        profileId: text(formData, "profileId"),
        role: text(formData, "role"),
      },
    );

    if (organisationId) revalidatePath(routes.organisations.team(organisationId));
    return successState("Team updated.");
  } catch (error) {
    return errorState(error);
  }
}

export async function removeMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId");

    await removeOrganisationMember(
      { actor: context.actor, organisations: context.organisations },
      { organisationId, profileId: text(formData, "profileId") },
    );

    if (organisationId) revalidatePath(routes.organisations.team(organisationId));
    return successState("Removed from this account.");
  } catch (error) {
    return errorState(error);
  }
}

export async function updateLimitsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = text(formData, "organisationId");

    await updateOrganisationLimits(
      { actor: context.actor, usage: context.usage },
      {
        organisationId,
        maxSocialAccounts: textOrEmpty(formData, "maxSocialAccounts"),
        maxPostsPerWeek: textOrEmpty(formData, "maxPostsPerWeek"),
        maxStorageGb: textOrEmpty(formData, "maxStorageGb"),
        maxAiTokensPerMonth: textOrEmpty(formData, "maxAiTokensPerMonth"),
        maxMembrainEntries: textOrEmpty(formData, "maxMembrainEntries"),
      },
    );

    if (organisationId) {
      revalidatePath(routes.organisations.settings(organisationId));
      revalidatePath(routes.organisations.detail(organisationId));
    }
    return successState("Account limits saved.");
  } catch (error) {
    return errorState(error);
  }
}
