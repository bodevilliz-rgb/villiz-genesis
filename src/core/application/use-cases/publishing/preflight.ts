import type { ContentRepository } from "@/core/application/ports/content-port";
import type { MediaRepository } from "@/core/application/ports/media-port";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";
import {
  evaluatePlatformPreflight,
  type PlatformPreflightResult,
  type CommercialDisclosure,
} from "@/core/domain/entities/publishing-preflight";
import {
  filterAssetsForOrganisation,
  isPublishableMediaAsset,
} from "@/core/domain/entities/publishing-media";

/**
 * Fetches the draft body and org-isolated media count for a given draft, then
 * delegates to evaluatePlatformPreflight (pure, no IO) for the verdict.
 *
 * Called at two points:
 *   1. Job creation — server actions enforce preflight when livePublishingEnabled.
 *   2. UI preflight panel — getPlatformPreflightAction exposes this to the dialog
 *      so the operator sees a deterministic pass/fail before submitting.
 */
export async function checkPublishingPreflight(
  deps: { content: ContentRepository; media: MediaRepository },
  input: {
    organisationId: string;
    draftId: string;
    platform: PublishingPlatform;
    /**
     * The operator's AI-generated-content declaration for this publish —
     * from the form at job creation, or from the persisted job row on
     * retry. Omitting it is fail-closed for platforms that require the
     * declaration (see evaluatePlatformPreflight).
     */
    aiGeneratedDisclosure?: boolean | null;
    /**
     * The operator's commercial-content declarations for this publish —
     * from the form at job creation, or from the persisted job row on
     * retry. Omitting it (or leaving either field null) is fail-closed for
     * platforms that require the disclosure (see evaluatePlatformPreflight).
     */
    commercialDisclosure?: CommercialDisclosure | null;
  },
): Promise<PlatformPreflightResult> {
  const [draft, allAssets] = await Promise.all([
    deps.content.findDraft(input.organisationId, input.draftId),
    deps.media.listAssetsForDraft(input.draftId),
  ]);

  const body = draft?.body ?? "";
  const { allowed } = filterAssetsForOrganisation(allAssets, input.organisationId);
  const publishableCount = allowed.filter(isPublishableMediaAsset).length;

  return evaluatePlatformPreflight(
    input.platform,
    body,
    publishableCount,
    draft?.hashtags ?? [],
    input.aiGeneratedDisclosure,
    input.commercialDisclosure,
  );
}
