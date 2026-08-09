"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { errorState, successState, text, textOrEmpty, list, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";
import { canEditOrganisation } from "@/core/domain/entities/identity";
import { loadMediaLibraryPage, type MediaLibraryPageResult } from "@/core/application/use-cases/media/list-media-library-page";
import type { MediaLibraryPageFilters } from "@/core/application/ports/media-port";

function revalidateMedia(organisationId: string, assetId?: string) {
  revalidatePath(routes.organisations.media.index(organisationId));
  revalidatePath(routes.organisations.detail(organisationId));
  if (assetId) {
    revalidatePath(routes.organisations.media.detail(organisationId, assetId));
  }
}

export async function uploadMediaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const organisationId = textOrEmpty(formData, "organisationId");
    const file = formData.get("file") as File;
    if (!file || file.size === 0) {
      return { status: "error", message: "No file was selected for upload." };
    }

    const context = await requireContext();
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // 1. Upload file to Supabase storage bucket
    const storagePath = await context.storage.uploadMedia(organisationId, {
      fileName: file.name,
      mimeType: file.type,
      fileBuffer,
    });

    // 2. Create the asset record in the database
    const asset = await context.media.createAsset(
      organisationId,
      storagePath,
      file.name,
      file.type,
      file.size,
      context.actor.id
    );

    // 3. Update optional initial metadata if provided
    const title = text(formData, "title") || file.name;
    const category = text(formData, "category") || null;
    const description = text(formData, "description") || null;
    const tags = list(formData, "tags");
    const brand = text(formData, "brand") || null;
    const isAiGenerated = formData.get("isAiGenerated") === "true";

    await context.media.updateAssetMetadata(asset.id, {
      title,
      thumbnailPath: null,
      category,
      description,
      altText: text(formData, "altText") || null,
      tags,
      brand,
      duration: null,
      copyrightOwner: text(formData, "copyrightOwner") || null,
      usageRights: text(formData, "usageRights") || null,
      expiresAt: text(formData, "expiresAt") || null,
      isAiGenerated,
      isArchived: false,
    });

    revalidateMedia(organisationId, asset.id);
    return successState("Media asset uploaded successfully.", asset.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateMediaMetadataAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const assetId = textOrEmpty(formData, "assetId");
    const organisationId = textOrEmpty(formData, "organisationId");

    const context = await requireContext();
    const isAiGenerated = formData.get("isAiGenerated") === "true";
    const isArchived = formData.get("isArchived") === "true";

    await context.media.updateAssetMetadata(assetId, {
      title: text(formData, "title") || null,
      thumbnailPath: text(formData, "thumbnailPath") || null,
      category: text(formData, "category") || null,
      description: text(formData, "description") || null,
      altText: text(formData, "altText") || null,
      tags: list(formData, "tags"),
      brand: text(formData, "brand") || null,
      duration: text(formData, "duration") ? parseInt(text(formData, "duration")!) : null,
      copyrightOwner: text(formData, "copyrightOwner") || null,
      usageRights: text(formData, "usageRights") || null,
      expiresAt: text(formData, "expiresAt") || null,
      isAiGenerated,
      isArchived,
    });

    revalidateMedia(organisationId, assetId);
    return successState("Metadata updated successfully.", assetId);
  } catch (error) {
    return errorState(error);
  }
}

export async function replaceMediaVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const assetId = textOrEmpty(formData, "assetId");
    const organisationId = textOrEmpty(formData, "organisationId");
    const file = formData.get("file") as File;
    if (!file || file.size === 0) {
      return { status: "error", message: "No file was selected to replace the current version." };
    }

    const context = await requireContext();
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // 1. Upload new file version to storage
    const storagePath = await context.storage.uploadMedia(organisationId, {
      fileName: file.name,
      mimeType: file.type,
      fileBuffer,
    });

    // 2. Perform version replacement in database
    await context.media.replaceAssetVersion(
      assetId,
      storagePath,
      file.name,
      file.type,
      file.size,
      context.actor.id
    );

    revalidateMedia(organisationId, assetId);
    return successState("New file version uploaded and replaced successfully.", assetId);
  } catch (error) {
    return errorState(error);
  }
}

export async function archiveMediaAction(organisationId: string, assetId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.archiveAsset(organisationId, assetId);
    revalidateMedia(organisationId, assetId);
    return successState("Asset archived successfully.");
  } catch (error) {
    return errorState(error);
  }
}

export async function deleteMediaAction(organisationId: string, assetId: string): Promise<ActionState> {
  try {
    const context = await requireContext();

    // 1. Verify asset exists and belongs to this organisation.
    //    getAsset scopes by org_id so a forged assetId from another org returns null here.
    const asset = await context.media.getAsset(organisationId, assetId);
    if (!asset) {
      return { status: "error", message: "Asset not found or does not belong to this organisation." };
    }

    // 2. Check for blocking references.
    //    campaign_assets and content_draft_assets use ON DELETE RESTRICT — a raw DB
    //    delete would silently fail with an opaque FK violation error.  Checking first
    //    lets us return a user-readable message instead.
    const [draftRefs, campaignRefs, versions] = await Promise.all([
      context.media.listDraftsReferencingAsset(assetId),
      context.media.listCampaignsReferencingAsset(assetId),
      context.media.getAssetVersions(assetId),
    ]);

    if (draftRefs.length > 0 || campaignRefs.length > 0) {
      const parts: string[] = [];
      if (draftRefs.length > 0)
        parts.push(`${draftRefs.length} content draft${draftRefs.length > 1 ? "s" : ""}`);
      if (campaignRefs.length > 0)
        parts.push(`${campaignRefs.length} campaign${campaignRefs.length > 1 ? "s" : ""}`);
      return {
        status: "error",
        message: `Cannot delete: this asset is referenced by ${parts.join(" and ")}. Remove it from those first, then delete.`,
      };
    }

    // 3. Collect every storage path that must be cleaned up:
    //    - the active storagePath on the asset record
    //    - all historical version paths stored in media_asset_versions
    const allStoragePaths = [
      asset.storagePath,
      ...versions.map((v) => v.storagePath),
    ];

    // 4. Delete the database record.  The CASCADE on media_asset_versions,
    //    media_collection_assets, and brand_kit_assets removes child rows automatically.
    await context.media.deleteAsset(organisationId, assetId);

    // 5. Delete all storage objects (active + all historical versions).
    //    This happens after the DB delete so the asset is always removed from the
    //    catalogue even if storage cleanup partially fails.
    let storageCleanupFailed = false;
    try {
      await context.storage.deleteMediaFiles(allStoragePaths);
    } catch {
      storageCleanupFailed = true;
    }

    revalidateMedia(organisationId);

    if (storageCleanupFailed) {
      return successState(
        "Asset removed from library. Storage cleanup encountered an error — the file(s) may remain in the bucket and will need manual removal.",
      );
    }
    return successState("Asset deleted permanently.");
  } catch (error) {
    return errorState(error);
  }
}

// Collections Actions
export async function createCollectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const organisationId = textOrEmpty(formData, "organisationId");
    const name = textOrEmpty(formData, "name");
    const description = text(formData, "description") || null;

    const context = await requireContext();
    const collection = await context.media.createCollection(
      organisationId,
      name,
      description,
      context.actor.id
    );

    revalidateMedia(organisationId);
    return successState("Collection created successfully.", collection.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateCollectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const collectionId = textOrEmpty(formData, "collectionId");
    const organisationId = textOrEmpty(formData, "organisationId");
    const name = textOrEmpty(formData, "name");
    const description = text(formData, "description") || null;

    const context = await requireContext();
    await context.media.updateCollection(collectionId, name, description);

    revalidateMedia(organisationId);
    return successState("Collection updated successfully.", collectionId);
  } catch (error) {
    return errorState(error);
  }
}

export async function deleteCollectionAction(organisationId: string, collectionId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.deleteCollection(organisationId, collectionId);
    revalidateMedia(organisationId);
    return successState("Collection deleted successfully.");
  } catch (error) {
    return errorState(error);
  }
}

export async function attachAssetToCollectionAction(collectionId: string, assetId: string, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.attachAssetToCollection(collectionId, assetId);
    revalidateMedia(organisationId);
    return successState("Asset added to collection.");
  } catch (error) {
    return errorState(error);
  }
}

export async function detachAssetFromCollectionAction(collectionId: string, assetId: string, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.detachAssetFromCollection(collectionId, assetId);
    revalidateMedia(organisationId);
    return successState("Asset removed from collection.");
  } catch (error) {
    return errorState(error);
  }
}

// Brand Kit Actions
export async function saveBrandKitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const brandKitId = text(formData, "brandKitId");
    const organisationId = textOrEmpty(formData, "organisationId");
    const name = textOrEmpty(formData, "name");
    
    // Parse color fields posted in JSON or structured inputs
    const colorsRaw = textOrEmpty(formData, "colors");
    const colors = colorsRaw ? JSON.parse(colorsRaw) : [];

    const typographyRaw = textOrEmpty(formData, "typography");
    const typography = typographyRaw ? JSON.parse(typographyRaw) : [];

    const toneNotes = text(formData, "toneNotes") || null;
    const usageGuidance = text(formData, "usageGuidance") || null;

    const context = await requireContext();
    
    if (brandKitId) {
      await context.media.updateBrandKit(brandKitId, name, colors, typography, toneNotes, usageGuidance);
      revalidateMedia(organisationId);
      return successState("Brand kit saved successfully.", brandKitId);
    } else {
      const bk = await context.media.createBrandKit(organisationId, name, colors, typography, toneNotes, usageGuidance, context.actor.id);
      revalidateMedia(organisationId);
      return successState("Brand kit created successfully.", bk.id);
    }
  } catch (error) {
    return errorState(error);
  }
}

export async function deleteBrandKitAction(organisationId: string, brandKitId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.deleteBrandKit(organisationId, brandKitId);
    revalidateMedia(organisationId);
    return successState("Brand kit deleted successfully.");
  } catch (error) {
    return errorState(error);
  }
}

export async function attachAssetToBrandKitAction(brandKitId: string, assetId: string, role: string | null, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.attachAssetToBrandKit(brandKitId, assetId, role);
    revalidateMedia(organisationId);
    return successState("Asset attached to brand kit.");
  } catch (error) {
    return errorState(error);
  }
}

export async function detachAssetFromBrandKitAction(brandKitId: string, assetId: string, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.detachAssetFromBrandKit(brandKitId, assetId);
    revalidateMedia(organisationId);
    return successState("Asset detached from brand kit.");
  } catch (error) {
    return errorState(error);
  }
}

// Link attachments Actions
export async function attachAssetToCampaignAction(campaignId: string, assetId: string, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.attachToCampaign(campaignId, assetId, context.actor.id);
    revalidateMedia(organisationId);
    revalidatePath(routes.organisations.campaigns.detail(organisationId, campaignId));
    return successState("Asset attached to campaign.");
  } catch (error) {
    return errorState(error);
  }
}

export async function detachAssetFromCampaignAction(campaignId: string, assetId: string, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.detachFromCampaign(campaignId, assetId);
    revalidateMedia(organisationId);
    revalidatePath(routes.organisations.campaigns.detail(organisationId, campaignId));
    return successState("Asset detached from campaign.");
  } catch (error) {
    return errorState(error);
  }
}

export async function attachAssetToDraftAction(draftId: string, assetId: string, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.attachToDraft(draftId, assetId, context.actor.id);
    revalidateMedia(organisationId);
    revalidatePath(routes.organisations.content.draft(organisationId, draftId));
    return successState("Asset attached to content draft.");
  } catch (error) {
    return errorState(error);
  }
}

export async function detachAssetFromDraftAction(draftId: string, assetId: string, organisationId: string): Promise<ActionState> {
  try {
    const context = await requireContext();
    await context.media.detachFromDraft(draftId, assetId);
    revalidateMedia(organisationId);
    revalidatePath(routes.organisations.content.draft(organisationId, draftId));
    return successState("Asset detached from content draft.");
  } catch (error) {
    return errorState(error);
  }
}

export async function detachAssetFromPublishedDraftAction(
  organisationId: string,
  draftId: string,
  assetId: string,
): Promise<ActionState> {
  try {
    const context = await requireContext();

    // 1. Require Lead or platform-admin role — contributors cannot modify published records.
    const role = await context.organisations.viewerRole(organisationId);
    if (!canEditOrganisation(context.actor, role)) {
      return { status: "error", message: "Only a Lead or administrator can detach media from a published draft." };
    }

    // 2. Verify the draft exists, belongs to this org, and is in the published state.
    const draft = await context.content.findDraft(organisationId, draftId);
    if (!draft) {
      return { status: "error", message: "Draft not found or does not belong to this organisation." };
    }
    if (draft.status !== "published") {
      return { status: "error", message: "This action is only available for published drafts." };
    }

    // 3. Verify the asset belongs to this org (cross-org protection).
    const asset = await context.media.getAsset(organisationId, assetId);
    if (!asset) {
      return { status: "error", message: "Asset not found or does not belong to this organisation." };
    }

    // 4. Remove the content_draft_assets row only — draft status, publishing history,
    //    destination, and provider metadata are untouched.
    await context.media.detachFromDraft(draftId, assetId);

    revalidateMedia(organisationId, assetId);
    revalidatePath(routes.organisations.content.draft(organisationId, draftId));
    return successState(
      "Asset detached from draft. The post already published on the social platform is not affected.",
    );
  } catch (error) {
    return errorState(error);
  }
}

/**
 * Client-triggered pagination/search for the Media Library grid — the same
 * bounded loadMediaLibraryPage the initial server render uses, so "Load
 * more" and typing in the search box never fetch more than one page of
 * results, and never generate signed URLs beyond that page. Read-only: the
 * RLS-scoped client this runs under naturally confines results to
 * organisationId, matching how the page's own initial fetch is scoped.
 */
export async function fetchMediaLibraryPageAction(
  organisationId: string,
  filters: MediaLibraryPageFilters,
): Promise<MediaLibraryPageResult> {
  const context = await requireContext();
  return loadMediaLibraryPage(context, organisationId, filters);
}
