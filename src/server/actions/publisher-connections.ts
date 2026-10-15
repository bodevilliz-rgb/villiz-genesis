"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { disconnectPublisherConnection } from "@/core/application/use-cases/publisher-connections";
import { resolvePublisherHubClient } from "@/infrastructure/publisher-hub/http-publisher-hub-client";
import { errorState, successState, text, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

/**
 * Disconnects a hub-connected publisher account. The hub keeps the tombstone
 * (history + receipts), publishes through that account stop immediately, and
 * the operator can reconnect any time with the Connect account button.
 */
export async function disconnectPublisherConnectionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const context = await requireContext();
    if (!context.actor.isPlatformAdmin) {
      return {
        status: "error",
        message: "Only platform administrators can disconnect publisher accounts.",
      };
    }
    const accountId = text(formData, "accountId");
    if (!accountId) {
      return { status: "error", message: "Account is required." };
    }
    const client = resolvePublisherHubClient();
    if (!client) {
      return {
        status: "error",
        message:
          "The publishing hub is not configured. Ask an administrator to set HUB_BASE_URL and HUB_API_KEY.",
      };
    }
    await disconnectPublisherConnection({ client }, { accountId });
    revalidatePath(routes.settingsConnections);
    return successState("Account disconnected from the publishing hub. Receipts are preserved.");
  } catch (error) {
    return errorState(error);
  }
}