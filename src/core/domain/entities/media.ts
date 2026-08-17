export interface MediaAssetVersion {
  id: string;
  assetId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  replacedBy: string | null; // Profile ID
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  organisationId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  uploadedBy: { id: string; fullName: string | null; email: string } | null;
  createdAt: string;
  
  // Sprint 3 fields
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
  updatedAt: string;

  // Relations
  versions?: MediaAssetVersion[];
}

/**
 * Everything the Media Library grid actually renders — deliberately excludes
 * description, usageRights, copyrightOwner, duration, expiresAt,
 * thumbnailPath, uploadedBy, updatedAt, brand, width, height, and version
 * history, none of which the grid displays. Returned by
 * MediaRepository.listAssetsPage instead of the full MediaAsset so a bounded
 * page of results stays bounded in payload size too.
 */
export interface MediaAssetListItem {
  id: string;
  organisationId: string;
  title: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  tags: string[];
  altText: string | null;
  isArchived: boolean;
  isAiGenerated: boolean;
  createdAt: string;
}

export interface PaginatedMediaAssets {
  items: MediaAssetListItem[];
  total: number;
  hasMore: boolean;
}

export interface MediaLibraryStats {
  totalAssets: number;
  imageCount: number;
  videoCount: number;
  totalStorageBytes: number;
}

export type MediaDeletionBlockCode =
  | "USED_BY_CONTENT"
  | "USED_BY_CAMPAIGN"
  | "USED_BY_COLLECTION"
  | "USED_BY_BRAND_KIT"
  | "PUBLISHING_DEPENDENCY"
  | "HISTORICAL_INTELLIGENCE_REFERENCE"
  | "HISTORICAL_USE"
  | "INSUFFICIENT_PERMISSION"
  | "INVALID_STORAGE_OWNERSHIP"
  | "INCOMPLETE_PATH_INVENTORY"
  | "UNKNOWN_DEPENDENCY";

export interface MediaDeletionBlockReason {
  code: MediaDeletionBlockCode;
  count: number;
}

export interface MediaDeletionStatus {
  eligibility: "ELIGIBLE" | "BLOCKED";
  reasons: MediaDeletionBlockReason[];
  fileName?: string;
  totalBytes?: number;
  objectCount?: number;
}

export interface MediaDeletionRequest {
  requestId: string;
  organisationId: string;
  formerAssetId: string;
  objectPaths: string[];
  cleanupState: "pending" | "complete";
  totalBytes: number;
}

export type MediaDeletionResult =
  | { outcome: "BLOCKED"; reasons: MediaDeletionBlockReason[] }
  | { outcome: "ACCEPTED"; requestId: string; cleanupState: "pending" | "complete"; totalBytes: number };

export interface MediaCollection {
  id: string;
  organisationId: string;
  name: string;
  description: string | null;
  createdBy: { id: string; fullName: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
  assets?: MediaAsset[]; // Could be partially loaded
}
