import type { StoragePort } from "@/core/application/ports/storage-port";

/** Display capabilities keyed by asset ID; missing thumbnails use the UI placeholder. */
export async function signCampaignPreviews(
  storage: Pick<StoragePort, "getSignedUrl">,
  assets: ReadonlyArray<{ id: string; mimeType: string; thumbnailPath?: string | null }>,
): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  await Promise.all(assets.map(async asset => {
    if (!asset.mimeType.startsWith("image/") || !asset.thumbnailPath) return;
    try { urls[asset.id] = await storage.getSignedUrl(asset.thumbnailPath); } catch { /* Display placeholder. */ }
  }));
  return urls;
}
