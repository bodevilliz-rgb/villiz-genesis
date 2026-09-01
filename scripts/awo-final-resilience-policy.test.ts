import assert from "node:assert/strict";
import test from "node:test";
import { providerRetryDelayMs } from "./awo-campaign-worker-core";

test("provider pressure backoff is long enough and bounded", () => {
  assert.equal(providerRetryDelayMs(1, 4000), 4000);
  assert.equal(providerRetryDelayMs(2, 4000), 8000);
  assert.equal(providerRetryDelayMs(3, 4000), 16000);
  assert.equal(providerRetryDelayMs(4, 4000), 30000);
  assert.equal(providerRetryDelayMs(6, 4000), 30000);
});
