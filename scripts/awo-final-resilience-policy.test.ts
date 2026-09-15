import { describe, it, expect } from "vitest";
import { providerRetryDelayMs } from "./awo-campaign-worker-core";

describe("provider pressure backoff is long enough and bounded", () => {
  it("providerRetryDelayMs(1, 4000) = 4000", () => {
    expect(providerRetryDelayMs(1, 4000)).toEqual(4000);
  });
  it("providerRetryDelayMs(2, 4000) = 8000", () => {
    expect(providerRetryDelayMs(2, 4000)).toEqual(8000);
  });
  it("providerRetryDelayMs(3, 4000) = 16000", () => {
    expect(providerRetryDelayMs(3, 4000)).toEqual(16000);
  });
  it("providerRetryDelayMs(4, 4000) = 30000 (capped)", () => {
    expect(providerRetryDelayMs(4, 4000)).toEqual(30000);
  });
  it("providerRetryDelayMs(6, 4000) = 30000 (capped)", () => {
    expect(providerRetryDelayMs(6, 4000)).toEqual(30000);
  });
});
