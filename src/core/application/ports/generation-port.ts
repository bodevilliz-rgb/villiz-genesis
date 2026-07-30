import type {
  CampaignContext,
  CampaignReadiness,
  DraftAnalyserInput,
  DraftAnalysis,
  GenerationContext,
  KnowledgeCoverage,
  PromptSpecification,
} from "@/core/domain/entities/generation";
import type { MembrainOverview } from "@/core/application/use-cases/membrain";
import type { MembrainReadiness } from "@/core/application/use-cases/membrain/readiness";

/**
 * Phase 7 — Provider Abstraction.
 *
 * Interfaces only. Nothing in this file makes an HTTP call, holds an API
 * key, or imports a provider SDK — and nothing in this codebase implements
 * GenerationProvider. That is deliberate: this sprint prepares the contract
 * a future provider integration would satisfy; it does not build one.
 *
 * The first five interfaces below are already satisfied today — not by a
 * class, but by the plain exported functions in
 * core/application/use-cases/generation/*.ts (buildGenerationContext,
 * resolveKnowledgeCoverage, resolveCampaignReadiness, analyseDraft,
 * composePromptSpecification). This matches the rest of this codebase's
 * established convention (see ARCHITECTURE.md: "use cases are plain async
 * functions... equally testable... removes a layer of ceremony") — the
 * interfaces exist so the *contract* is explicit and documented, not to
 * force those functions into classes they don't need.
 */

export interface ContextResolver {
  buildGenerationContext(
    organisationId: string,
    draftId: string,
    membrainOverview: MembrainOverview,
  ): Promise<GenerationContext>;
}

/** Synchronous by design — it classifies an already-computed MembrainReadiness, it doesn't fetch one. */
export interface KnowledgeResolver {
  resolveKnowledgeCoverage(readiness: MembrainReadiness): KnowledgeCoverage;
}

export interface CampaignResolver {
  resolveCampaignReadiness(campaign: CampaignContext | null): CampaignReadiness | null;
}

export interface DraftAnalyserPort {
  analyseDraft(input: DraftAnalyserInput): DraftAnalysis;
}

export interface PromptComposerPort {
  composePromptSpecification(context: GenerationContext): PromptSpecification;
}

/**
 * What a provider call would return, whenever one is built. `tokensUsed` is
 * nullable because not every provider reports it identically.
 */
export interface ProviderResult {
  content: string;
  finishReason: "complete" | "truncated" | "error";
  providerName: string;
  tokensUsed: number | null;
}

/**
 * The one seam a future OpenAI/Anthropic/Gemini/Azure OpenAI/Ollama/
 * OpenRouter integration would implement. Takes only a PromptSpecification —
 * a provider implementation never reaches back into a repository or a
 * use-case, keeping the provider layer fully isolated from Genesis's
 * business logic (see the extensibility note in the Sprint 3.5 report).
 */
export interface GenerationProvider {
  readonly name: string;
  generate(spec: PromptSpecification): Promise<ProviderResult>;
}
