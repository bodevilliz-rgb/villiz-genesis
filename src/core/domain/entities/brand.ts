import type { MediaAsset } from "./media";

export interface BrandKitAsset {
  brandKitId: string;
  assetId: string;
  role: string | null;
  asset?: MediaAsset;
  createdAt: string;
}

export interface BrandKit {
  id: string;
  organisationId: string;
  name: string;
  colors: Record<string, string>[]; // e.g. [{ name: "Primary", hex: "#FF0000" }]
  typography: Record<string, string>[]; // e.g. [{ name: "Heading", font: "Inter" }]
  toneNotes: string | null;
  usageGuidance: string | null;
  createdBy: { id: string; fullName: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
  
  // Relations
  assets?: BrandKitAsset[];
}
