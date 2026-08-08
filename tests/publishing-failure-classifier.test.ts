import { describe, expect, it } from "vitest";
import { classifyPublishingFailure } from "@/lib/publishing-failure-classifier";

describe("classifyPublishingFailure — known Blotato error codes", () => {
  it("classifies blotato_no_connected_account", () => {
    const result = classifyPublishingFailure("blotato_no_connected_account");
    expect(result.category).toBe("no_account");
    expect(result.severity).toBe("high");
    expect(result.label).toBeTruthy();
    expect(result.recommendedAction).toBeTruthy();
  });

  it("classifies blotato_status_timeout", () => {
    const result = classifyPublishingFailure("blotato_status_timeout");
    expect(result.category).toBe("timeout");
    expect(result.severity).toBe("medium");
  });

  it("classifies blotato_publish_failed", () => {
    const result = classifyPublishingFailure("blotato_publish_failed");
    expect(result.category).toBe("platform_rejection");
    expect(result.severity).toBe("high");
  });

  it("classifies mock_simulated_failure", () => {
    const result = classifyPublishingFailure("mock_simulated_failure");
    expect(result.category).toBe("simulation");
    expect(result.severity).toBe("low");
  });
});

describe("classifyPublishingFailure — pattern-matched error codes", () => {
  it("classifies rate limit codes", () => {
    expect(classifyPublishingFailure("rate_limit_exceeded").category).toBe("rate_limit");
    expect(classifyPublishingFailure("429").category).toBe("rate_limit");
  });

  it("classifies auth error codes", () => {
    expect(classifyPublishingFailure("auth_expired").category).toBe("auth_error");
    expect(classifyPublishingFailure("401_unauthorized").category).toBe("auth_error");
    expect(classifyPublishingFailure("403_forbidden").category).toBe("auth_error");
  });

  it("classifies network error codes", () => {
    expect(classifyPublishingFailure("network_error").category).toBe("network_error");
    expect(classifyPublishingFailure("ECONNRESET").category).toBe("network_error");
    expect(classifyPublishingFailure("fetch_failed").category).toBe("network_error");
  });
});

describe("classifyPublishingFailure — null and unknown codes", () => {
  it("classifies null errorCode as unknown", () => {
    const result = classifyPublishingFailure(null);
    expect(result.category).toBe("unknown");
    expect(result.severity).toBe("medium");
  });

  it("classifies empty string as unknown", () => {
    expect(classifyPublishingFailure("").category).toBe("unknown");
  });

  it("classifies unrecognised codes as unknown", () => {
    expect(classifyPublishingFailure("some_random_error_code").category).toBe("unknown");
    expect(classifyPublishingFailure("infrastructure_exploded").category).toBe("unknown");
  });
});

describe("classifyPublishingFailure — classification shape", () => {
  it("always returns all required fields", () => {
    const result = classifyPublishingFailure("blotato_no_connected_account");
    expect(result).toHaveProperty("category");
    expect(result).toHaveProperty("label");
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("recommendedAction");
    expect(result).toHaveProperty("severity");
  });

  it("severity is always low, medium, or high", () => {
    const codes = [
      "blotato_no_connected_account",
      "blotato_status_timeout",
      "blotato_publish_failed",
      "mock_simulated_failure",
      null,
      "unknown_code",
    ];
    for (const code of codes) {
      const { severity } = classifyPublishingFailure(code);
      expect(["low", "medium", "high"]).toContain(severity);
    }
  });
});
