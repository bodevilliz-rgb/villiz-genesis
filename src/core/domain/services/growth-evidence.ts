export type GrowthEvidenceLevel =
  | "hypothesis"
  | "directional"
  | "client_supported"
  | "controlled";

export interface GrowthEvidenceInput {
  comparableObservations: number;
  completedCheckpoints: number;
  hasCommercialOutcome: boolean;
  controlledAllocation?: boolean;
}

/**
 * Evidence strength is deliberately separate from launch readiness.
 *
 * A 100/100 distribution gate means a plan is grounded and safe to launch; it
 * does not mean it will perform. This classifier only advances when comparable
 * measured outcomes accumulate, and reserves "controlled" for a genuinely
 * randomized allocation.
 */
export function classifyGrowthEvidence(input: GrowthEvidenceInput): GrowthEvidenceLevel {
  if (input.controlledAllocation && input.comparableObservations >= 2 && input.completedCheckpoints >= 2) {
    return "controlled";
  }

  if (
    input.comparableObservations >= 4 &&
    input.completedCheckpoints >= 3 &&
    input.hasCommercialOutcome
  ) {
    return "client_supported";
  }

  if (input.comparableObservations >= 2 && input.completedCheckpoints >= 1) {
    return "directional";
  }

  return "hypothesis";
}

export const GROWTH_EVIDENCE_LABELS: Record<GrowthEvidenceLevel, string> = {
  hypothesis: "Foundation hypothesis",
  directional: "Directional evidence",
  client_supported: "Client-supported pattern",
  controlled: "Controlled evidence",
};
