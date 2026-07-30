"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { errorState, successState, text, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.identity.updateOwnProfile({
      fullName: text(formData, "fullName") ?? null,
      jobTitle: text(formData, "jobTitle") ?? null,
    });

    revalidatePath(routes.settings);
    return successState("Profile saved.");
  } catch (error) {
    return errorState(error);
  }
}
