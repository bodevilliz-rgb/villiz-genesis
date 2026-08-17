import type { MarketIntelligenceProfile, MarketIntelligenceSnapshot, MarketPattern, MarketReference } from "@/core/domain/entities/market-intelligence";

export interface MarketIntelligenceRepository {
  getProfile(organisationId: string): Promise<MarketIntelligenceProfile | null>;
  getSnapshot(organisationId: string): Promise<MarketIntelligenceSnapshot>;
  upsertProfile(profile: Omit<MarketIntelligenceProfile, "createdAt" | "updatedAt">): Promise<MarketIntelligenceProfile>;
  createReference(input: Omit<MarketReference, "id" | "createdAt" | "updatedAt">): Promise<MarketReference>;
  createPattern(input: Omit<MarketPattern, "id" | "createdAt" | "updatedAt">): Promise<MarketPattern>;
}
