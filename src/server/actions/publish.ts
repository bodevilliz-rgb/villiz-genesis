"use server";

import { requireContext } from "../container";
import { analyzeDraftForPublishing, type PrePublishReport } from "@/core/application/use-cases/generation/pre-publish-review";
import { checkPublishingPreflight } from "@/core/application/use-cases/publishing/preflight";
import {
  filterAssetsForOrganisation,
  isPublishableMediaAsset,
} from "@/core/domain/entities/publishing-media";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";
import type { PlatformPreflightResult } from "@/core/domain/entities/publishing-preflight";

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
  /** The selected destination platform, when known — enables the canonical hashtag-limit check (see platform-policy.ts). Omit when no destination is selected yet. */
  platform?: PublishingPlatform | null,
): Promise<PrePublishReport> {
  const context = await requireContext();

  const [entries, allAssets] = await Promise.all([
    context.membrain.listRecent(organisationId, 500),
    context.media.listAssetsForDraft(draft.id),
  ]);

  const brandVoiceEntries = entries.filter(
    (e) => e.category?.key === "brand_voice" && e.status === "active",
  );
  const brandVoiceCtx = brandVoiceEntries.map((e) => e.body).join("\n\n");

  // Apply the same org-isolation and type-filter rules used by the deterministic
  // preflight so the AI review's media signal is always consistent with it.
  const { allowed } = filterAssetsForOrganisation(allAssets, organisationId);
  const publishableMediaCount = allowed.filter(isPublishableMediaAsset).length;

  return analyzeDraftForPublishing(draft, brandVoiceCtx, undefined, publishableMediaCount, platform);
}

/**
 * Deterministic platform preflight check — no AI, no randomness.
 *
 * Returns the same verdict the worker would compute before a live publish.
 * The dialog uses this to display a hard-blocker section separately from the
 * AI review score so the operator can never confuse "good AI score" with
 * "platform requirements met."
 */
export async function getPlatformPreflightAction(
  organisationId: string,
  draftId: string,
  platform: PublishingPlatform,
): Promise<PlatformPreflightResult> {
  const context = await requireContext();
  return checkPublishingPreflight(
    { content: context.content, media: context.media },
    { organisationId, draftId, platform },
  );
}
