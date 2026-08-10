"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { testBlotatoConnection } from "@/core/application/use-cases/blotato";
import { PUBLISHING_PLATFORM_LABELS } from "@/core/domain/entities/publishing";
import { errorState, successState, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

/**
 * Requirement 6 ("Test Connection" reports reachability, accounts, and
 * supported platforms) is split across two things this action drives: the
 * returned message is the transient one-line summary a toast shows, and
 * revalidating the settings page means the persistent accounts table below
 * the button re-renders from the freshly-stored rows testBlotatoConnection()
 * just upserted (requirement 7) — the full report, not just the toast.
 */
export async function testBlotatoConnectionAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const result = await testBlotatoConnection({
      actor: context.actor,
      blotatoClient: context.blotatoClient,
      blotatoAccounts: context.blotatoAccounts,
    });

    revalidatePath(routes.settingsPublishing);

    if (!result.reachable) {
      return errorState(new Error(result.error ?? "Could not reach Blotato."));
    }

    const supportedLabel = result.supportedPlatforms.length > 0
      ? result.supportedPlatforms.map((p) => PUBLISHING_PLATFORM_LABELS[p]).join(", ")
      : "none of this app's 5 platforms yet";

    return successState(
      `Blotato is reachable. Found ${result.accounts.length} connected ${result.accounts.length === 1 ? "account" : "accounts"} — supported for publishing: ${supportedLabel}.`,
    );
  } catch (error) {
    return errorState(error);
  }
}
