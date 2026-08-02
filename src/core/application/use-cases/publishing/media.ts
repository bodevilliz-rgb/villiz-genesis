import type { MediaRepository } from "@/core/application/ports/media-port";
import type { StoragePort } from "@/core/application/ports/storage-port";
import { filterAssetsForOrganisation, isPublishableMediaAsset, validateMediaUrl } from "@/core/domain/entities/publishing-media";

/**
 * Blotato publishes asynchronously and may not fetch the media immediately
 * — a signed URL must still be valid well after the worker has moved on to
 * other jobs. 6 hours comfortably outlives any realistic submission-to-fetch
 * delay while still expiring well within a day.
 */
export const BLOTATO_MEDIA_URL_EXPIRY_SECONDS = 6 * 60 * 60;

export interface ResolvedPublishMedia {
  mediaUrls: string[];
  mimeTypes: string[];
  skipped: {
    /** Assets linked to the draft but owned by a different organisation — never sent, regardless of RLS. */
    crossOrganisation: number;
    /** Linked assets whose mime type Blotato cannot publish (not image/* or video/*). */
    unsupportedType: number;
    /** A signed URL was generated but failed validateMediaUrl (not https, points at a local/private host). */
    unreachableUrl: number;
  };
}

/**
 * The one place that turns "assets linked to this draft" into the
 * platform-neutral `PublishInput.assetUrls` every PublisherPort
 * implementation already accepts. Called by the publishing worker before
 * every publish attempt — this function makes no assumption about which
 * provider will consume its output, keeping media resolution independent of
 * Blotato specifically (see PublisherPort's own "provider-neutral" note).
 */
export async function resolvePublishMediaUrls(
  deps: { media: MediaRepository; storage: StoragePort },
  input: { organisationId: string; draftId: string },
): Promise<ResolvedPublishMedia> {
  const linkedAssets = await deps.media.listAssetsForDraft(input.draftId);
  const { allowed: sameOrgAssets, rejected: crossOrgAssets } = filterAssetsForOrganisation(linkedAssets, input.organisationId);

  const publishableAssets = sameOrgAssets.filter(isPublishableMediaAsset);
  const unsupportedTypeCount = sameOrgAssets.length - publishableAssets.length;

  const mediaUrls: string[] = [];
  const mimeTypes: string[] = [];
  let unreachableUrlCount = 0;

  for (const asset of publishableAssets) {
    const signedUrl = await deps.storage.getSignedUrl(asset.storagePath, BLOTATO_MEDIA_URL_EXPIRY_SECONDS);
    const validation = validateMediaUrl(signedUrl);
    if (!validation.valid) {
      unreachableUrlCount += 1;
      continue;
    }
    mediaUrls.push(signedUrl);
    mimeTypes.push(asset.mimeType);
  }

  return {
    mediaUrls,
    mimeTypes,
    skipped: {
      crossOrganisation: crossOrgAssets.length,
      unsupportedType: unsupportedTypeCount,
      unreachableUrl: unreachableUrlCount,
    },
  };
}
