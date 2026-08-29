import type { CampaignPlatform } from "./campaign";

export const BUSINESS_OBJECTIVES = ["visibility", "awareness", "enquiries", "bookings", "sales", "authority", "community_growth", "attendance", "lead_generation", "other"] as const;
export type MarketBusinessObjective = (typeof BUSINESS_OBJECTIVES)[number];
export const COMMERCIAL_INTENTS = ["convert", "engage", "build_trust"] as const;
export type CommercialIntent = (typeof COMMERCIAL_INTENTS)[number];
export const CULTURAL_VOICE_LEVELS = ["neutral", "conversational", "light_naija"] as const;
export type CulturalVoiceLevel = (typeof CULTURAL_VOICE_LEVELS)[number];
export const HASHTAG_ROLES = ["local", "service", "audience_cultural", "occasion_topic", "campaign", "brand"] as const;
export type MarketHashtagRole = (typeof HASHTAG_ROLES)[number];
export const PATTERN_CATEGORIES = ["hook", "format", "emotional_angle", "educational_angle", "transformation", "proof", "offer_positioning", "cta", "audience_question", "discovery_language", "local_language", "occasion_language", "caption_length"] as const;
export type MarketPatternCategory = (typeof PATTERN_CATEGORIES)[number];

export interface MarketIntelligenceProfile {
  organisationId: string;
  businessObjectives: MarketBusinessObjective[];
  targetGeographies: string[];
  serviceAreas: string[];
  audienceContext: string | null;
  culturalContext: string | null;
  promotionalFocus: string | null;
  culturalVoiceLevel: CulturalVoiceLevel;
  conversionActions: string[];
  platformStrategy: Partial<Record<CampaignPlatform, string>>;
  hashtagStrategy: Partial<Record<MarketHashtagRole, string>>;
  createdAt: string;
  updatedAt: string;
}

export interface MarketReference {
  id: string; organisationId: string; identifier: string; platform: string;
  market: string | null; vertical: string | null; relevanceNote: string;
  sourceUrl: string | null; isActive: boolean; reviewedAt: string | null;
  createdAt: string; updatedAt: string;
}

export interface MarketPattern {
  id: string; organisationId: string; observation: string; category: MarketPatternCategory;
  platform: string | null; market: string | null; vertical: string | null;
  provenance: string; sourceUrl: string | null; confidence: number;
  observedAt: string | null; reviewedAt: string | null; isActive: boolean;
  createdAt: string; updatedAt: string;
}

export interface MarketIntelligenceSnapshot {
  profile: MarketIntelligenceProfile | null;
  references: MarketReference[];
  patterns: MarketPattern[];
}

/** Version-controlled v1 template: deliberately cannot contain client references, patterns, MemBrain or learning. */
export type MarketProfileTemplate = Pick<MarketIntelligenceProfile, "businessObjectives" | "culturalVoiceLevel" | "platformStrategy" | "hashtagStrategy">;
export function profileFromTemplate(organisationId: string, template: MarketProfileTemplate): Omit<MarketIntelligenceProfile, "createdAt" | "updatedAt"> {
  return { organisationId, businessObjectives: [...template.businessObjectives], culturalVoiceLevel: template.culturalVoiceLevel, platformStrategy: { ...template.platformStrategy }, hashtagStrategy: { ...template.hashtagStrategy }, targetGeographies: [], serviceAreas: [], audienceContext: null, culturalContext: null, promotionalFocus: null, conversionActions: [] };
}

export function marketProfileReadiness(profile: MarketIntelligenceProfile | null): { complete: number; total: number; percentage: number } {
  const checks = profile ? [
    profile.businessObjectives.length > 0,
    profile.targetGeographies.length > 0 || profile.serviceAreas.length > 0,
    Boolean(profile.audienceContext?.trim()),
    Boolean(profile.promotionalFocus?.trim()),
    profile.conversionActions.length > 0,
    Boolean(profile.hashtagStrategy.local?.trim()) && Boolean(profile.hashtagStrategy.service?.trim()),
  ] : [false, false, false, false, false, false];
  const complete = checks.filter(Boolean).length;
  return { complete, total: checks.length, percentage: Math.round((complete / checks.length) * 100) };
}
