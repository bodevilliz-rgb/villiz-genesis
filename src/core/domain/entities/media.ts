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
