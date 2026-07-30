import type { CampaignPlatform, CampaignStatus } from "./campaign";
import type { ContentDraftStatus, ContentDraftType } from "./content";

/**
 * Genesis's generation-readiness layer: everything a future AI provider
 * would need to know before generating anything, assembled and scored
 * deterministically. Nothing in this file or its companion use-cases
 * (core/application/use-cases/generation/) calls a model, calls an HTTP
 * endpoint, or produces generated text — see the Provider Abstraction port
 * for the one seam where that responsibility begins, deliberately left
 * unimplemented. Genesis prepares; Awo decides what to do with it.
 */

export interface OrganisationProfile {
  id: string;
  name: string;
  industry: string | null;
  websiteUrl: string | null;
}

export interface CampaignContext {
  id: string;
  name: string;
  objective: string | null;
  targetAudience: string | null;
  primaryCTA: string | null;
  platforms: CampaignPlatform[];
  startDate: string | null;
  endDate: string | null;
  status: CampaignStatus;
}

/**
 * One string per active MemBrain entry in the matching category, in the
 * repository's own recency order — never flattened into a single blob here,
 * so downstream consumers (the Prompt Composer, a future provider) decide
 * how to join or truncate them, not this layer.
 */
export interface BrandContext {
  brandDescription: string[];
  brandVoice: string[];
  targetAudience: string[];
  contentPillars: string[];
  productsAndServices: string[];
  restrictions: string[];
}

export interface DraftContext {
  id: string;
  contentType: ContentDraftType;
  status: ContentDraftStatus;
  title: string;
  body: string;
  summary: string | null;
  /** The MemBrain content pillar this draft is linked to, if any — the Draft Analyser's brand-alignment check reads this. */
  category: { id: string; key: string; label: string } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationContext {
  organisation: OrganisationProfile;
  /** Null when the draft has no campaign — campaign linkage is optional (Sprint 3.2). */
  campaign: CampaignContext | null;
  brand: BrandContext;
  draft: DraftContext;
  requestedBy: { id: string; fullName: string | null; email: string };
  assembledAt: string;
}

export type KnowledgeCoverageState = "complete" | "partial" | "missing";

export interface KnowledgeCoverageCategory {
  categoryKey: string;
  label: string;
  state: KnowledgeCoverageState;
  entryCount: number;
  requiredCount: number;
  suggestion: string | null;
}

export interface KnowledgeCoverage {
  coveragePercent: number;
  categories: KnowledgeCoverageCategory[];
  missingCategories: KnowledgeCoverageCategory[];
  suggestedImprovements: string[];
}

export interface CampaignReadinessCheck {
  key: string;
  label: string;
  met: boolean;
}

export interface CampaignReadiness {
  score: number;
  checks: CampaignReadinessCheck[];
  warnings: string[];
  recommendations: string[];
}

export type DraftAnalysisCheckKey =
  | "length"
  | "title"
  | "structure"
  | "callToAction"
  | "campaignAlignment"
  | "brandAlignment"
  | "completeness";

export interface DraftAnalysisCheck {
  key: DraftAnalysisCheckKey;
  label: string;
  passed: boolean;
  /** False marks a check as not applicable (e.g. campaign alignment with no campaign linked) — excluded from the score, never counted as a failure. */
  applicable: boolean;
}

export interface DraftAnalysis {
  readinessPercent: number;
  checks: DraftAnalysisCheck[];
  suggestions: string[];
  warnings: string[];
}

/** Input shape for the Draft Analyser (Phase 4) — a plain data type, not tied to any one repository's row shape. */
export interface DraftAnalyserInput {
  title: string;
  body: string;
  contentType: ContentDraftType;
  hasCategory: boolean;
  campaign: CampaignContext | null;
}

export interface OverallConfidence {
  score: number;
  reasoning: string[];
  strengths: string[];
  weaknesses: string[];
  missingInformation: string[];
}

export interface PromptSpecification {
  systemContext: { role: string; principles: string[] };
  businessContext: { organisationName: string; industry: string | null };
  campaignContext: CampaignContext | null;
  brandContext: BrandContext;
  draftContext: { contentType: ContentDraftType; title: string; currentBody: string; status: ContentDraftStatus };
  generationGoal: string;
  constraints: string[];
}

export type GenerationReadinessStatus = "ready_for_awo" | "needs_attention";

export interface GenerationReadiness {
  status: GenerationReadinessStatus;
  context: GenerationContext;
  knowledgeCoverage: KnowledgeCoverage;
  campaignReadiness: CampaignReadiness | null;
  draftAnalysis: DraftAnalysis;
  confidence: OverallConfidence;
  promptSpecification: PromptSpecification;
  promptReady: boolean;
  blockingReasons: string[];
}
