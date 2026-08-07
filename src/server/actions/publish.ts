"use server";

import { requireContext } from "../container";
import { analyzeDraftForPublishing, type PrePublishReport } from "@/core/application/use-cases/generation/pre-publish-review";
import type { ContentDraft } from "@/core/domain/entities/content";

/**
 * Runs the AI pre-publish review for the given draft.
 *
 * Brand voice is loaded from the organisation's ACTIVE MemBrain entries in the
 * "brand_voice" category and concatenated into the context string passed to
 * analyzeDraftForPublishing. If no active brand voice entries exist the
 * existing graceful fallback in analyzeDraftForPublishing applies (the AI
 * uses a generic "Professional and engaging" default, and any AI provider
 * failure degrades to an unavailable report rather than blocking the publish).
 */
export async function runPrePublishReviewAction(
  organisationId: string,
  draft: ContentDraft,
): Promise<PrePublishReport> {
  const context = await requireContext();

  const entries = await context.membrain.listRecent(organisationId, 500);
  const brandVoiceEntries = entries.filter(
    (e) => e.category?.key === "brand_voice" && e.status === "active",
  );
  const brandVoiceCtx = brandVoiceEntries.map((e) => e.body).join("\n\n");

  return analyzeDraftForPublishing(draft, brandVoiceCtx);
}
