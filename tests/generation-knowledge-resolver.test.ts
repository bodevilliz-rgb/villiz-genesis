import { describe, expect, it } from "vitest";
import { resolveKnowledgeCoverage } from "@/core/application/use-cases/generation/knowledge-resolver";
import { computeMembrainReadiness } from "@/core/application/use-cases/membrain/readiness";

const FULL_READINESS = computeMembrainReadiness([
  { categoryKey: "brand_description", status: "active" },
  { categoryKey: "audience", status: "active" },
  { categoryKey: "brand_voice", status: "active" },
  { categoryKey: "content_pillars", status: "active" },
  { categoryKey: "content_pillars", status: "active" },
  { categoryKey: "content_pillars", status: "active" },
  { categoryKey: "offering", status: "active" },
  { categoryKey: "guidelines", status: "active" },
]);

const EMPTY_READINESS = computeMembrainReadiness([]);

describe("resolveKnowledgeCoverage", () => {
  it("carries the coverage percentage through from computeMembrainReadiness unchanged", () => {
    expect(resolveKnowledgeCoverage(FULL_READINESS).coveragePercent).toBe(100);
    expect(resolveKnowledgeCoverage(EMPTY_READINESS).coveragePercent).toBe(0);
  });

  it("classifies a fully-met category as complete with no suggestion", () => {
    const coverage = resolveKnowledgeCoverage(FULL_READINESS);
    const brandDescription = coverage.categories.find((c) => c.categoryKey === "brand_description");

    expect(brandDescription?.state).toBe("complete");
    expect(brandDescription?.suggestion).toBeNull();
  });

  it("classifies zero entries as missing, with a suggestion", () => {
    const coverage = resolveKnowledgeCoverage(EMPTY_READINESS);
    const brandVoice = coverage.categories.find((c) => c.categoryKey === "brand_voice");

    expect(brandVoice?.state).toBe("missing");
    expect(brandVoice?.suggestion).toBeTruthy();
  });

  it("classifies a partially-met category (some entries, not enough) as partial", () => {
    const partial = computeMembrainReadiness([
      { categoryKey: "content_pillars", status: "active" },
      { categoryKey: "content_pillars", status: "active" },
    ]);
    const coverage = resolveKnowledgeCoverage(partial);
    const pillars = coverage.categories.find((c) => c.categoryKey === "content_pillars");

    expect(pillars?.state).toBe("partial");
    expect(pillars?.entryCount).toBe(2);
    expect(pillars?.requiredCount).toBe(3);
  });

  it("lists every non-complete category under missingCategories", () => {
    const coverage = resolveKnowledgeCoverage(EMPTY_READINESS);
    expect(coverage.missingCategories).toHaveLength(6);
    expect(coverage.suggestedImprovements).toHaveLength(6);
  });

  it("has no missing categories or suggestions when fully covered", () => {
    const coverage = resolveKnowledgeCoverage(FULL_READINESS);
    expect(coverage.missingCategories).toHaveLength(0);
    expect(coverage.suggestedImprovements).toHaveLength(0);
  });
});
