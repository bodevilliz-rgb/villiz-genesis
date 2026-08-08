"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import {
  assignChannelToOrganisation,
  removeChannelFromOrganisation,
  listOrganisationChannels,
  listAvailableAccountsForAssignment,
} from "@/core/application/use-cases/organisation-social-accounts";
import { errorState, successState, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";

export async function assignChannelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = formData.get("organisationId") as string;
    const blotatoAccountId = formData.get("blotatoAccountId") as string;

    await assignChannelToOrganisation(
      { actor: context.actor, blotatoAccounts: context.blotatoAccounts, usage: context.usage },
      { organisationId, blotatoAccountId },
    );

    revalidatePath(routes.organisations.settings(organisationId));
    return successState("Channel connected.");
  } catch (error) {
    return errorState(error);
  }
}

export async function removeChannelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = formData.get("organisationId") as string;
    const blotatoAccountId = formData.get("blotatoAccountId") as string;

    await removeChannelFromOrganisation(
      { actor: context.actor, blotatoAccounts: context.blotatoAccounts },
      { blotatoAccountId },
    );

    revalidatePath(routes.organisations.settings(organisationId));
    return successState("Channel removed.");
  } catch (error) {
    return errorState(error);
  }
}

export async function getOrganisationChannels(organisationId: string): Promise<BlotatoAccount[]> {
  const context = await requireContext();
  return listOrganisationChannels({ blotatoAccounts: context.blotatoAccounts }, organisationId);
}

export async function getAvailableAccounts(): Promise<BlotatoAccount[]> {
  const context = await requireContext();
  return listAvailableAccountsForAssignment({ actor: context.actor, blotatoAccounts: context.blotatoAccounts });
}
