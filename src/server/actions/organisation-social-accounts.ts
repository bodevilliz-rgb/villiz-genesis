"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import {
  assignChannelToOrganisation,
  removeChannelFromOrganisation,
  listOrganisationChannels,
  listAvailableAccountsForAssignment,
} from "@/core/application/use-cases/organisation-social-accounts";
import { testBlotatoConnection } from "@/core/application/use-cases/blotato";
import { errorState, successState, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";

export interface RefreshAvailableChannelsState extends ActionState {
  accounts: BlotatoAccount[];
}

/**
 * Refreshes Blotato and returns the currently assignable accounts directly to
 * the organisation modal. This keeps account discovery inside the workflow
 * that needs it instead of requiring an unrelated Test Connection detour.
 */
export async function refreshAvailableChannelsAction(
  _prev: RefreshAvailableChannelsState,
  formData: FormData,
): Promise<RefreshAvailableChannelsState> {
  try {
    const context = await requireContext();
    const organisationId = formData.get("organisationId");
    if (typeof organisationId !== "string" || organisationId.length === 0) {
      return { status: "error", message: "Organisation is required.", accounts: [] };
    }

    const result = await testBlotatoConnection({
      actor: context.actor,
      blotatoClient: context.blotatoClient,
      blotatoAccounts: context.blotatoAccounts,
    });

    if (!result.reachable) {
      return {
        status: "error",
        message: "Could not refresh Blotato accounts. Check the connection and try again.",
        accounts: [],
      };
    }

    const accounts = await listAvailableAccountsForAssignment({
      actor: context.actor,
      blotatoAccounts: context.blotatoAccounts,
    });

    revalidatePath(routes.settingsPublishing);
    revalidatePath(routes.organisations.settings(organisationId));

    return {
      status: "success",
      message: accounts.length > 0
        ? `Found ${accounts.length} available ${accounts.length === 1 ? "account" : "accounts"}.`
        : "Blotato is connected, but every current account is already assigned or unavailable.",
      accounts,
    };
  } catch (error) {
    return { ...errorState(error), accounts: [] };
  }
}

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
