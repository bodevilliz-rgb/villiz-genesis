import type { KnowledgeCoverage, KnowledgeCoverageCategory, KnowledgeCoverageState } from "@/core/domain/entities/generation";
import type { MembrainReadiness } from "@/core/application/use-cases/membrain/readiness";

/**
 * Deterministic per-category suggestion text, keyed by the same MemBrain
 * category keys readiness.ts already scores. Pure lookup — no logic beyond
 * "which category is this".
 */
const SUGGESTIONS: Record<string, string> = {
  brand_description: "Add an entry describing what this business is, what it does, and why it exists.",
  audience: "Add an entry describing who this client speaks to — their language, motivations and objections.",
  brand_voice: "Add an entry recording tone, vocabulary and phrasing rules — and anything to never say.",
  content_pillars: "Add at least three content pillar entries so generation has recurring themes to draw from.",
  offering: "Add an entry describing what this client sells and how it's positioned.",
  guidelines: "Add an entry recording legal, regulatory or client-mandated restrictions.",
};

function stateFor(entryCount: number, requiredCount: number): KnowledgeCoverageState {
  if (entryCount >= requiredCount) return "complete";
  if (entryCount > 0) return "partial";
  return "missing";
}

/**
 * Phase 2 — Knowledge Resolver. Wraps computeMembrainReadiness (the existing,
 * already-tested MemBrain readiness calculation) rather than re-deriving
 * coverage math a second time; this layer only adds the Complete/Partial/
 * Missing classification and suggestion text the generation-readiness UI
 * needs on top of it. Pure, deterministic, no AI.
 */
export function resolveKnowledgeCoverage(readiness: MembrainReadiness): KnowledgeCoverage {
  const categories: KnowledgeCoverageCategory[] = readiness.signals.map((signal) => {
    const state = stateFor(signal.entryCount, signal.requiredCount);
    return {
      categoryKey: signal.categoryKey,
      label: signal.label,
      state,
      entryCount: signal.entryCount,
      requiredCount: signal.requiredCount,
      suggestion: state === "complete" ? null : (SUGGESTIONS[signal.categoryKey] ?? `Add knowledge for ${signal.label}.`),
    };
  });

  const missingCategories = categories.filter((category) => category.state !== "complete");

  return {
    coveragePercent: readiness.percentage,
    categories,
    missingCategories,
    suggestedImprovements: missingCategories
      .map((category) => category.suggestion)
      .filter((suggestion): suggestion is string => suggestion !== null),
  };
}
