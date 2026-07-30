import type { MembrainStatus } from "@/core/domain/entities/membrain";

/**
 * MemBrain readiness — a deterministic measure of whether an organisation's
 * knowledge base covers the fundamentals every AI feature depends on.
 *
 * Deliberately a pure function, not a repository concern, for the same
 * reason context-pack.ts is one: this is a product rule that will be tuned,
 * and it must be testable without a database.
 *
 * Only `active` entries count. A `draft` entry is not yet trusted knowledge
 * (it never reaches AI context — see retrieveContext), and an `archived`
 * entry has been deliberately withdrawn, so neither should count as evidence
 * the account is "ready".
 */
export interface MembrainReadinessEntry {
  categoryKey: string | null;
  status: MembrainStatus;
}

export interface MembrainReadinessSignal {
  categoryKey: string;
  label: string;
  requiredCount: number;
  entryCount: number;
  met: boolean;
}

export interface MembrainReadiness {
  /** 0-100, rounded. */
  percentage: number;
  metCount: number;
  totalSignals: number;
  signals: MembrainReadinessSignal[];
  missingAreas: MembrainReadinessSignal[];
}

/**
 * One row per readiness signal, in the order they should be presented.
 * `categoryKey` matches the system category key seeded by
 * `provision_membrain_taxonomy()` — see migration 20260730100000.
 */
const READINESS_REQUIREMENTS: ReadonlyArray<{ categoryKey: string; label: string; requiredCount: number }> = [
  { categoryKey: "brand_description", label: "Business/brand description", requiredCount: 1 },
  { categoryKey: "audience", label: "Target audience", requiredCount: 1 },
  { categoryKey: "brand_voice", label: "Brand voice", requiredCount: 1 },
  { categoryKey: "content_pillars", label: "At least three content pillars", requiredCount: 3 },
  { categoryKey: "offering", label: "Products or services", requiredCount: 1 },
  { categoryKey: "guidelines", label: "Restrictions", requiredCount: 1 },
];

export function computeMembrainReadiness(entries: MembrainReadinessEntry[]): MembrainReadiness {
  const activeCountByCategory = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status !== "active" || !entry.categoryKey) continue;
    activeCountByCategory.set(entry.categoryKey, (activeCountByCategory.get(entry.categoryKey) ?? 0) + 1);
  }

  const signals: MembrainReadinessSignal[] = READINESS_REQUIREMENTS.map((requirement) => {
    const entryCount = activeCountByCategory.get(requirement.categoryKey) ?? 0;
    return {
      categoryKey: requirement.categoryKey,
      label: requirement.label,
      requiredCount: requirement.requiredCount,
      entryCount,
      met: entryCount >= requirement.requiredCount,
    };
  });

  const metCount = signals.filter((signal) => signal.met).length;

  return {
    percentage: Math.round((metCount / signals.length) * 100),
    metCount,
    totalSignals: signals.length,
    signals,
    missingAreas: signals.filter((signal) => !signal.met),
  };
}
