import type { MediaRepository, MediaLibraryPageFilters } from "@/core/application/ports/media-port";
import type { StoragePort } from "@/core/application/ports/storage-port";
import type { MediaAssetListItem } from "@/core/domain/entities/media";

export interface MediaLibraryPageResult {
  items: MediaAssetListItem[];
  signedUrls: Record<string, string>;
  hasMore: boolean;
  total: number;
}

/**
 * The one place that turns "one page of an organisation's media library"
 * into grid-ready data — a bounded repository query plus signed URLs
 * generated for exactly those items, never the whole library. Shared by the
 * Media Library page's initial server render and the client-triggered
 * search/load-more server actions so both paths stay bounded the same way.
 */
export async function loadMediaLibraryPage(
  deps: { media: Pick<MediaRepository, "listAssetsPage">; storage: Pick<StoragePort, "getSignedUrl"> },
  organisationId: string,
  filters: MediaLibraryPageFilters,
): Promise<MediaLibraryPageResult> {
  const page = await deps.media.listAssetsPage(organisationId, filters);

  const signedUrls: Record<string, string> = {};
  for (const asset of page.items) {
    if (asset.mimeType.startsWith("image/")) {
      try {
        signedUrls[asset.storagePath] = await deps.storage.getSignedUrl(asset.storagePath);
      } catch {
        // Matches the previous page.tsx behaviour: a signing failure for one
        // asset must not fail the whole page — it just renders without a preview.
      }
    }
  }

  return { items: page.items, signedUrls, hasMore: page.hasMore, total: page.total };
}
