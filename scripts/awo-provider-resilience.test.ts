import { describe, it, expect } from "vitest";
import { isRetryableProviderError, providerRetryDelayMs } from "./awo-campaign-worker-core";

describe("isRetryableProviderError", () => {
  it("classifies temporary Gemini high-demand errors as retryable", () => {
    expect(
      isRetryableProviderError(new Error("AI_APICallError: This model is currently experiencing high demand. Please try again later."))
    ).toEqual(true);
  });

  it("classifies structured-output/schema failures as retryable", () => {
    expect(isRetryableProviderError(new Error("No object generated: response did not match schema."))).toEqual(true);
  });

  it("does not retry deterministic application failures", () => {
    expect(isRetryableProviderError(new Error("No Awo generation request exists for this draft."))).toEqual(false);
  });
});

describe("providerRetryDelayMs", () => {
  it("uses bounded exponential backoff", () => {
    expect(providerRetryDelayMs(1, 1000)).toEqual(1000);
    expect(providerRetryDelayMs(2, 1000)).toEqual(2000);
    expect(providerRetryDelayMs(3, 1000)).toEqual(4000);
    expect(providerRetryDelayMs(8, 1000)).toEqual(30000);
  });
});
