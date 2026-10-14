import type { MediaAsset, MediaCollection, MediaAssetVersion, PaginatedMediaAssets, MediaLibraryStats, MediaDeletionRequest, MediaDeletionResult, MediaDeletionStatus } from "../../domain/entities/media";
import type { BrandKit } from "../../domain/entities/brand";

export interface MediaLibraryPageFilters {
  limit: number;
  offset: number;
  search?: string;
  /** Mirrors the grid's mime-type quick filters; "document" matches pdf/document mime types, same semantics the client-side filter used before. */
  mimeFilter?: "image" | "video" | "audio" | "document";
  isArchived?: boolean;
}

export interface MediaAssetWriteModel {
  title: string | null;
  thumbnailPath: string | null;
  category: string | null;
  description: string | null;
  altText: string | null;
  tags: string[];
  brand: string | null;
  duration: number | null;
  copyrightOwner: string | null;
  usageRights: string | null;
  expiresAt: string | null;
  isAiGenerated: boolean;
  isArchived: boolean;
}

export interface MediaRepository {
  /** Creates a new asset record in the database */
  createAsset(organisationId: string, storagePath: string, fileName: string, mimeType: string, sizeBytes: number, uploadedBy: string): Promise<MediaAsset>;
  
  /** Updates the metadata of an existing asset */
  updateAssetMetadata(assetId: string, input: MediaAssetWriteModel): Promise<MediaAsset>;
  
  /** Retrieves a single asset */
  getAsset(organisationId: string, assetId: string): Promise<MediaAsset | null>;
  
  /** Lists assets matching filters for an organisation */
  listAssets(organisationId: string, options?: { category?: string; isArchived?: boolean; typePrefix?: string }): Promise<MediaAsset[]>;

  /**
   * Server-side paginated, lightweight listing for the Media Library grid.
   * Pagination (range), search (file name / title), and the mime-type quick
   * filter all happen in Postgres — never fetches the whole organisation's
   * library to filter/paginate in application code.
   */
  listAssetsPage(organisationId: string, filters: MediaLibraryPageFilters): Promise<PaginatedMediaAssets>;

  /** Cheap aggregate counts/sum for the Media Library stats board — never returns full asset rows. */
  getLibraryStats(organisationId: string): Promise<MediaLibraryStats>;

  /** Creates a new version of an asset */
  replaceAssetVersion(assetId: string, storagePath: string, fileName: string, mimeType: string, sizeBytes: number, replacedBy: string): Promise<MediaAsset>;

  /** Marks an asset as archived */
  archiveAsset(organisationId: string, assetId: string): Promise<void>;
  
  /** Read-only advisory status. Permanent deletion always rechecks inside the transaction. */
  getDeletionStatus(organisationId: string, assetId: string): Promise<MediaDeletionStatus>;

  /** The sole permanent-delete path: atomically rechecks safety, records cleanup, and deletes the row. */
  requestSafeDeletion(organisationId: string, assetId: string, idempotencyId: string): Promise<MediaDeletionResult>;

  /** Returns only server-recorded paths for an authorised cleanup request. */
  getDeletionRequest(organisationId: string, requestId: string): Promise<MediaDeletionRequest | null>;

  /** Records a post-commit Storage attempt; failed attempts remain pending. */
  recordCleanupResult(organisationId: string, requestId: string, succeeded: boolean, error?: string): Promise<void>;

  /** Attaches an asset to a campaign */
  attachToCampaign(campaignId: string, assetId: string, attachedBy: string): Promise<void>;

  /** Attaches an asset to a content draft */
  attachToDraft(draftId: string, assetId: string, attachedBy: string): Promise<void>;

  /** Retrieve all versions of a media asset */
  getAssetVersions(assetId: string): Promise<MediaAssetVersion[]>;

  // Collections Management
  listCollections(organisationId: string): Promise<MediaCollection[]>;
  createCollection(organisationId: string, name: string, description: string | null, createdBy: string): Promise<MediaCollection>;
  updateCollection(collectionId: string, name: string, description: string | null): Promise<MediaCollection>;
  deleteCollection(organisationId: string, collectionId: string): Promise<void>;
  attachAssetToCollection(collectionId: string, assetId: string, position?: number): Promise<void>;
  detachAssetFromCollection(collectionId: string, assetId: string): Promise<void>;
  listAssetsForCollection(collectionId: string): Promise<MediaAsset[]>;

  // Brand Kits Management
  listBrandKits(organisationId: string): Promise<BrandKit[]>;
  createBrandKit(organisationId: string, name: string, colors: Record<string, string>[], typography: Record<string, string>[], toneNotes: string | null, usageGuidance: string | null, createdBy: string): Promise<BrandKit>;
  updateBrandKit(brandKitId: string, name: string, colors: Record<string, string>[], typography: Record<string, string>[], toneNotes: string | null, usageGuidance: string | null): Promise<BrandKit>;
  deleteBrandKit(organisationId: string, brandKitId: string): Promise<void>;
  attachAssetToBrandKit(brandKitId: string, assetId: string, role: string | null): Promise<void>;
  detachAssetFromBrandKit(brandKitId: string, assetId: string): Promise<void>;

  // Asset Linking queries
  listAssetsForDraft(draftId: string): Promise<MediaAsset[]>;
  detachFromDraft(draftId: string, assetId: string): Promise<void>;
  listAssetsForCampaign(campaignId: string): Promise<MediaAsset[]>;
  detachFromCampaign(campaignId: string, assetId: string): Promise<void>;

  /** Returns drafts that reference this asset via content_draft_assets (ON DELETE RESTRICT). */
  listDraftsReferencingAsset(assetId: string): Promise<Array<{ id: string; title: string }>>;
  /** Returns campaigns that reference this asset via campaign_assets (ON DELETE RESTRICT). */
  listCampaignsReferencingAsset(assetId: string): Promise<Array<{ id: string; name: string }>>;
}
