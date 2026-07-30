import { describe, expect, it } from "vitest";
import {
  computeMembrainReadiness,
  type MembrainReadinessEntry,
} from "@/core/application/use-cases/membrain/readiness";

function entry(overrides: Partial<MembrainReadinessEntry> = {}): MembrainReadinessEntry {
  return { categoryKey: "brand_description", status: "active", ...overrides };
}

const ALL_SIX: MembrainReadinessEntry[] = [
  entry({ categoryKey: "brand_description" }),
  entry({ categoryKey: "audience" }),
  entry({ categoryKey: "brand_voice" }),
  entry({ categoryKey: "content_pillars" }),
  entry({ categoryKey: "content_pillars" }),
  entry({ categoryKey: "content_pillars" }),
  entry({ categoryKey: "offering" }),
  entry({ categoryKey: "guidelines" }),
];

describe("computeMembrainReadiness", () => {
  it("is 0% with no entries at all", () => {
    const readiness = computeMembrainReadiness([]);

    expect(readiness.percentage).toBe(0);
    expect(readiness.metCount).toBe(0);
    expect(readiness.totalSignals).toBe(6);
    expect(readiness.missingAreas).toHaveLength(6);
  });

  it("is 100% once every fundamental has enough active entries", () => {
    const readiness = computeMembrainReadiness(ALL_SIX);

    expect(readiness.percentage).toBe(100);
    expect(readiness.metCount).toBe(6);
    expect(readiness.missingAreas).toHaveLength(0);
  });

  it("requires three content pillars, not just one", () => {
    const entries = ALL_SIX.filter((e) => e.categoryKey !== "content_pillars").concat(
      entry({ categoryKey: "content_pillars" }),
    );

    const readiness = computeMembrainReadiness(entries);
    const pillars = readiness.signals.find((s) => s.categoryKey === "content_pillars");

    expect(pillars?.met).toBe(false);
    expect(pillars?.entryCount).toBe(1);
    expect(pillars?.requiredCount).toBe(3);
    expect(readiness.missingAreas.map((s) => s.categoryKey)).toContain("content_pillars");
  });

  it("does not count draft or archived entries as evidence", () => {
    const readiness = computeMembrainReadiness([
      entry({ categoryKey: "brand_description", status: "draft" }),
      entry({ categoryKey: "audience", status: "archived" }),
    ]);

    expect(readiness.metCount).toBe(0);
    expect(readiness.signals.find((s) => s.categoryKey === "brand_description")?.met).toBe(false);
    expect(readiness.signals.find((s) => s.categoryKey === "audience")?.met).toBe(false);
  });

  it("ignores entries with no category", () => {
    const readiness = computeMembrainReadiness([entry({ categoryKey: null })]);

    expect(readiness.metCount).toBe(0);
  });

  it("ignores categories that are not part of the readiness model", () => {
    const readiness = computeMembrainReadiness([
      entry({ categoryKey: "competitors" }),
      entry({ categoryKey: "operations" }),
    ]);

    expect(readiness.metCount).toBe(0);
    expect(readiness.signals).toHaveLength(6);
  });

  it("rounds the percentage rather than truncating", () => {
    // 1 of 6 met = 16.67%, should round to 17.
    const readiness = computeMembrainReadiness([entry({ categoryKey: "brand_description" })]);

    expect(readiness.percentage).toBe(17);
  });
});
