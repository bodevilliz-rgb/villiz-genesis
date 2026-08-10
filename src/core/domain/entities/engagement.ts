import type { CampaignPlatform } from "./campaign";

export type EngagementDataBasis = "brand_only" | "performance_informed";

export interface EngagementEvidence {
  sourceType: "membrain_entry";
  sourceId: string;
  title: string;
  categoryKey: string | null;
  version: number;
}

export interface EngagementHashtagGroups {
  brand: string[];
  local: string[];
  service: string[];
  audience: string[];
}

/**
 * An immutable, evidence-linked recommendation. It is advice for a human
 * operator, never an instruction to publish and never a promise of reach.
 */
export interface EngagementRecommendation {
  id: string;
  organisationId: string;
  draftId: string;
  draftVersion: number;
  platform: CampaignPlatform;
  objective: string | null;
  dataBasis: EngagementDataBasis;
  recommendedCaption: string;
  alternativeCaptions: string[];
  hook: string;
  cta: string;
  hashtags: EngagementHashtagGroups;
  rationale: string;
  predictedStrengths: string[];
  limitations: string[];
  confidence: number;
  evidence: EngagementEvidence[];
  createdBy: string | null;
  createdAt: string;
}

export interface EngagementRecommendationWriteModel {
  organisationId: string;
  draftId: string;
  draftVersion: number;
  platform: CampaignPlatform;
  objective: string | null;
  dataBasis: EngagementDataBasis;
  recommendedCaption: string;
  alternativeCaptions: string[];
  hook: string;
  cta: string;
  hashtags: EngagementHashtagGroups;
  rationale: string;
  predictedStrengths: string[];
  limitations: string[];
  confidence: number;
  evidence: EngagementEvidence[];
  createdBy: string;
}
