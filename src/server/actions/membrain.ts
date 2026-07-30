"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import {
  archiveEntry,
  createEntry,
  restoreVersion,
  retrieveContext,
  updateEntry,
} from "@/core/application/use-cases/membrain";
import { errorState, list, successState, text, textOrEmpty, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

function entryFormPayload(formData: FormData) {
  return {
    organisationId: textOrEmpty(formData, "organisationId"),
    title: textOrEmpty(formData, "title"),
    summary: textOrEmpty(formData, "summary"),
    body: textOrEmpty(formData, "body"),
    categoryId: textOrEmpty(formData, "categoryId"),
    status: textOrEmpty(formData, "status") || "active",
    source: textOrEmpty(formData, "source") || "manual",
    sourceUrl: textOrEmpty(formData, "sourceUrl"),
    importance: textOrEmpty(formData, "importance") || "3",
    tags: list(formData, "tags"),
  };
}

function revalidateMembrain(organisationId: string, entryId?: string) {
  revalidatePath(routes.organisations.membrain.index(organisationId));
  revalidatePath(routes.organisations.detail(organisationId));
  if (entryId) revalidatePath(routes.organisations.membrain.entry(organisationId, entryId));
}

export async function createEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const entry = await createEntry(
      { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
      entryFormPayload(formData),
    );

    revalidateMembrain(entry.organisationId, entry.id);
    return successState("Knowledge added to MemBrain.", entry.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const entry = await updateEntry(
      { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
      {
        ...entryFormPayload(formData),
        id: textOrEmpty(formData, "id"),
        changeSummary: textOrEmpty(formData, "changeSummary"),
      },
    );

    revalidateMembrain(entry.organisationId, entry.id);
    revalidatePath(routes.organisations.membrain.history(entry.organisationId, entry.id));
    return successState(`Saved as version ${entry.version}.`, entry.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function archiveEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const entry = await archiveEntry(
      { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
      { organisationId: text(formData, "organisationId"), entryId: text(formData, "entryId") },
    );

    revalidateMembrain(entry.organisationId, entry.id);
    return successState("Entry archived. It is out of AI context but still in history.", entry.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function restoreVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const entry = await restoreVersion(
      { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
      {
        organisationId: text(formData, "organisationId"),
        entryId: text(formData, "entryId"),
        version: text(formData, "version"),
      },
    );

    revalidateMembrain(entry.organisationId, entry.id);
    revalidatePath(routes.organisations.membrain.history(entry.organisationId, entry.id));
    return successState(`Restored. This is now version ${entry.version}.`, entry.id);
  } catch (error) {
    return errorState(error);
  }
}

/**
 * Returns exactly what an AI feature would receive. Used by the context
 * inspector so a strategist can verify what the model will be told before any
 * content is generated in Sprint 2.
 */
export async function previewContextAction(
  _prev: ActionState & { prompt?: string; tokens?: number; entries?: number },
  formData: FormData,
): Promise<ActionState & { prompt?: string; tokens?: number; entries?: number }> {
  try {
    const context = await requireContext();
    const pack = await retrieveContext(
      { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
      {
        organisationId: textOrEmpty(formData, "organisationId"),
        query: textOrEmpty(formData, "query"),
        limit: 12,
        maxCharacters: 24000,
        recordUsage: false,
      },
    );

    return {
      ...successState(
        pack.truncated
          ? "Context assembled. Some lower-priority knowledge did not fit the budget."
          : "Context assembled.",
      ),
      prompt: pack.prompt,
      tokens: pack.estimatedTokens,
      entries: pack.items.length,
    };
  } catch (error) {
    return errorState(error);
  }
}
