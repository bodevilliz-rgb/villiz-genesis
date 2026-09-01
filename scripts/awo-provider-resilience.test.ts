import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableProviderError, providerRetryDelayMs } from "./awo-campaign-worker-core";

test("classifies temporary Gemini high-demand errors as retryable", () => {
  assert.equal(isRetryableProviderError(new Error("AI_APICallError: This model is currently experiencing high demand. Please try again later.")), true);
});

test("classifies structured-output/schema failures as retryable", () => {
  assert.equal(isRetryableProviderError(new Error("No object generated: response did not match schema.")), true);
});

test("does not retry deterministic application failures", () => {
  assert.equal(isRetryableProviderError(new Error("No Awo generation request exists for this draft.")), false);
});

test("uses bounded exponential backoff", () => {
  assert.equal(providerRetryDelayMs(1, 1000), 1000);
  assert.equal(providerRetryDelayMs(2, 1000), 2000);
  assert.equal(providerRetryDelayMs(3, 1000), 4000);
  assert.equal(providerRetryDelayMs(8, 1000), 30000);
});
