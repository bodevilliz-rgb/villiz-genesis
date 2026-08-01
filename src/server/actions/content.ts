"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import {
  createDraft,
  createGenerationRequest,
  updateDraft,
  scheduleDraft,
  publishDraft,
  archiveDraft,
  duplicateDraft,
} from "@/core/application/use-cases/content";
import { errorState, successState, textOrEmpty, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

function contentDeps(context: Awaited<ReturnType<typeof requireContext>>) {
  return {
    actor: context.actor,
    content: context.content,
    membrain: context.membrain,
    organisations: context.organisations,
  };
}

function draftFormPayload(formData: FormData) {
  return {
    organisationId: textOrEmpty(formData, "organisationId"),
    title: textOrEmpty(formData, "title"),
    contentType: textOrEmpty(formData, "contentType") || "social_post",
    categoryId: textOrEmpty(formData, "categoryId"),
    campaignId: textOrEmpty(formData, "campaignId"),
    summary: textOrEmpty(formData, "summary"),
    body: textOrEmpty(formData, "body"),
  };
}

function revalidateContent(organisationId: string, draftId?: string) {
  revalidatePath(routes.organisations.content.index(organisationId));
  revalidatePath(routes.organisations.detail(organisationId));
  revalidatePath(routes.dashboard);
  revalidatePath(routes.review);
  revalidatePath(routes.organisations.campaigns.index(organisationId));
  if (draftId) {
    revalidatePath(routes.organisations.content.draft(organisationId, draftId));
    revalidatePath(routes.reviewWorkspace(draftId));
  }
}

export async function createDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const draft = await createDraft(contentDeps(context), draftFormPayload(formData));

    revalidateContent(draft.organisationId, draft.id);
    return successState("Draft created.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const draft = await updateDraft(contentDeps(context), {
      ...draftFormPayload(formData),
      id: textOrEmpty(formData, "id"),
      changeSummary: textOrEmpty(formData, "changeSummary"),
    });

    revalidateContent(draft.organisationId, draft.id);
    revalidatePath(routes.organisations.content.history(draft.organisationId, draft.id));
    return successState(`Saved as version ${draft.version}.`, draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function createGenerationRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const context = await requireContext();
    const request = await createGenerationRequest(contentDeps(context), {
      organisationId: textOrEmpty(formData, "organisationId"),
      draftId: textOrEmpty(formData, "draftId"),
      brief: textOrEmpty(formData, "brief"),
      targetAudience: textOrEmpty(formData, "targetAudience"),
      tone: textOrEmpty(formData, "tone"),
      contentPillarCategoryId: textOrEmpty(formData, "contentPillarCategoryId"),
    });

    revalidateContent(request.organisationId, request.draftId);
    return successState("Generation request sent to Awo. This draft is now ready for Awo.", request.draftId);
  } catch (error) {
    return errorState(error);
  }
}

export async function scheduleDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");
    const scheduledAt = textOrEmpty(formData, "scheduledAt");
    const platform = textOrEmpty(formData, "platform");
    const timezone = textOrEmpty(formData, "timezone");

    if (!scheduledAt || !platform || !timezone) {
      throw new Error("Missing scheduling details.");
    }

    const draft = await scheduleDraft(contentDeps(context), organisationId, draftId, {
      scheduledAt,
      platform,
      timezone,
    });

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content scheduled successfully.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function publishDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");

    const draft = await publishDraft(contentDeps(context), organisationId, draftId);

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content marked as published.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function archiveDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");

    const draft = await archiveDraft(contentDeps(context), organisationId, draftId);

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content archived.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function duplicateDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const organisationId = textOrEmpty(formData, "organisationId");
    const draftId = textOrEmpty(formData, "id");

    const draft = await duplicateDraft(contentDeps(context), organisationId, draftId);

    revalidateContent(draft.organisationId, draft.id);
    return successState("Content duplicated.", draft.id);
  } catch (error) {
    return errorState(error);
  }
}
