import { describe, expect, it } from "vitest";
import { shouldInvalidateReoptimisationOutput } from "./awo-campaign-worker-core";

describe("fresh campaign re-optimisation", () => {
  it("invalidates previously generated copy before a forced re-optimisation", () => {
    expect(shouldInvalidateReoptimisationOutput(
      true,
      "Welcome to Hairsential Monday — your authoritative source truth.",
      ["hairsentialmonday", "sourcetruth", "authoritativebeauty"],
    )).toBe(true);
  });

  it("does not invalidate completed content during an ordinary unfinished-post run", () => {
    expect(shouldInvalidateReoptimisationOutput(
      false,
      "Healthy hair starts with understanding what your hair needs.",
      ["HairsentialMonday", "NaturalHairCareUK"],
    )).toBe(false);
  });

  it("does not create a redundant invalidation when a forced slot is already blank", () => {
    expect(shouldInvalidateReoptimisationOutput(true, "", [])).toBe(false);
  });
});
