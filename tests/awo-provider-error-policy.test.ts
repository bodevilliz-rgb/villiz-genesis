import { describe, expect, it } from "vitest";
import { isRetryableProviderError } from "@/infrastructure/ai/provider-error-policy";

describe("isRetryableProviderError", () => {
  it("does not retry depleted Gemini prepayment credits", () => {
    expect(isRetryableProviderError(new Error(
      "AI_APICallError: Your prepayment credits are depleted. Please manage project billing.",
    ))).toBe(false);
  });

  it("does not retry invalid provider credentials", () => {
    expect(isRetryableProviderError(new Error(
      "AI_APICallError: Incorrect API key provided.",
    ))).toBe(false);
  });

  it("retries temporary provider pressure", () => {
    expect(isRetryableProviderError(new Error(
      "AI_APICallError: This model is currently experiencing high demand. Please try again later.",
    ))).toBe(true);
  });

  it("retries structured-output failures", () => {
    expect(isRetryableProviderError(new Error(
      "No object generated: response did not match schema.",
    ))).toBe(true);
  });

  it("does not retry deterministic application failures", () => {
    expect(isRetryableProviderError(new Error(
      "No Awo generation request exists for this draft.",
    ))).toBe(false);
  });
});
