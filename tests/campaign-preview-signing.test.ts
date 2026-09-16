import { expect, it, vi } from "vitest";
import { signCampaignPreviews } from "@/core/application/use-cases/media/sign-campaign-previews";
import { resolvePublishMediaUrls } from "@/core/application/use-cases/publishing/media";
it("uses thumbnails for campaign display, no original fallback, and originals for publishing", async () => {
  const assets = [
    { id: "a", organisationId: "org", storagePath: "original/a", thumbnailPath: "thumb/a", mimeType: "image/jpeg" },
    { id: "b", organisationId: "org", storagePath: "original/b", thumbnailPath: null, mimeType: "image/jpeg" },
  ];
  const getSignedUrl = vi.fn(async (path: string) => `https://project.supabase.co/storage/v1/object/sign/${path}?token=test`);
  const storage = { getSignedUrl };
  expect(await signCampaignPreviews(storage, assets)).toEqual({ a: expect.stringContaining("thumb/a") });
  expect(getSignedUrl).toHaveBeenCalledOnce();
  getSignedUrl.mockClear();
  await resolvePublishMediaUrls({ storage, media: { listAssetsForDraft: async () => assets } } as never, { organisationId: "org", draftId: "draft" });
  expect(getSignedUrl.mock.calls).toEqual([["original/a", 21600], ["original/b", 21600]]);
  expect(assets[0]!.storagePath).toBe("original/a");
});
