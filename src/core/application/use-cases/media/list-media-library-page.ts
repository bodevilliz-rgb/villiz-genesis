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
 * generated only for explicit thumbnail paths. Full-resolution originals are
 * intentionally never previewed by the grid. Shared by the Media Library
 * page's initial server render and the client-triggered search/load-more
 * server actions so both paths stay bounded the same way.
 */
export async function loadMediaLibraryPage(
  deps: { media: Pick<MediaRepository, "listAssetsPage">; storage: Pick<StoragePort, "getSignedUrl"> },
  organisationId: string,
  filters: MediaLibraryPageFilters,
): Promise<MediaLibraryPageResult> {
  const page = await deps.media.listAssetsPage(organisationId, filters);

  const signedUrls: Record<string, string> = {};
  for (const asset of page.items) {
    const previewPath = asset.thumbnailPath;
    if (asset.mimeType.startsWith("image/") && previewPath) {
      try {
        signedUrls[previewPath] = await deps.storage.getSignedUrl(previewPath);
      } catch {
        // A signing failure for one thumbnail must not fail the whole page.
      }
    }
  }

  return { items: page.items, signedUrls, hasMore: page.hasMore, total: page.total };
}
