"use server";

import { requireContext } from "../container";
import { analyzeDraftForPublishing, type PrePublishReport } from "@/core/application/use-cases/generation/pre-publish-review";
import type { ContentDraft } from "@/core/domain/entities/content";

export async function runPrePublishReviewAction(
  organisationId: string,
  draft: ContentDraft
): Promise<PrePublishReport> {
  await requireContext();
  const brandVoice = ""; // simplify for now

  return analyzeDraftForPublishing(draft, brandVoice);
}
