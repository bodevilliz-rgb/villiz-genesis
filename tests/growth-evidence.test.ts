import { describe, expect, it } from "vitest";
import { classifyGrowthEvidence } from "@/core/domain/services/growth-evidence";

describe("growth evidence classification", () => {
  it("does not confuse launch readiness with performance evidence", () => {
    expect(classifyGrowthEvidence({
      comparableObservations: 0,
      completedCheckpoints: 0,
      hasCommercialOutcome: false,
    })).toBe("hypothesis");
  });

  it("requires repeated comparable observations for directional evidence", () => {
    expect(classifyGrowthEvidence({
      comparableObservations: 2,
      completedCheckpoints: 1,
      hasCommercialOutcome: false,
    })).toBe("directional");
  });

  it("requires commercial confirmation before promoting a client pattern", () => {
    expect(classifyGrowthEvidence({
      comparableObservations: 4,
      completedCheckpoints: 3,
      hasCommercialOutcome: false,
    })).toBe("directional");

    expect(classifyGrowthEvidence({
      comparableObservations: 4,
      completedCheckpoints: 3,
      hasCommercialOutcome: true,
    })).toBe("client_supported");
  });

  it("never calls observational activity controlled without randomized allocation", () => {
    expect(classifyGrowthEvidence({
      comparableObservations: 8,
      completedCheckpoints: 4,
      hasCommercialOutcome: true,
      controlledAllocation: false,
    })).toBe("client_supported");

    expect(classifyGrowthEvidence({
      comparableObservations: 2,
      completedCheckpoints: 2,
      hasCommercialOutcome: false,
      controlledAllocation: true,
    })).toBe("controlled");
  });
});
