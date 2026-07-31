import type { MediaAsset } from "../../domain/entities/media";

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
  
  /** Creates a new version of an asset */
  replaceAssetVersion(assetId: string, storagePath: string, fileName: string, mimeType: string, sizeBytes: number, replacedBy: string): Promise<MediaAsset>;

  /** Marks an asset as archived */
  archiveAsset(organisationId: string, assetId: string): Promise<void>;
  
  /** Deletes an asset permanently, will fail if references exist */
  deleteAsset(organisationId: string, assetId: string): Promise<void>;

  /** Attaches an asset to a campaign */
  attachToCampaign(campaignId: string, assetId: string, attachedBy: string): Promise<void>;

  /** Attaches an asset to a content draft */
  attachToDraft(draftId: string, assetId: string, attachedBy: string): Promise<void>;
}
