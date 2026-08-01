import { describe, expect, it } from "vitest";
import {
  isTerminalPublishingJobStatus,
  isValidPublishingJobTransition,
  PUBLISHING_JOB_TRANSITIONS,
} from "@/core/domain/entities/publishing";

describe("isValidPublishingJobTransition", () => {
  it("allows every transition the mission's state machine requires", () => {
    expect(isValidPublishingJobTransition("queued", "processing")).toBe(true);
    expect(isValidPublishingJobTransition("processing", "published")).toBe(true);
    expect(isValidPublishingJobTransition("processing", "failed")).toBe(true);
    expect(isValidPublishingJobTransition("failed", "queued")).toBe(true); // retry
    expect(isValidPublishingJobTransition("queued", "cancelled")).toBe(true);
  });

  it("rejects transitions that would let manual UI action bypass the state machine", () => {
    expect(isValidPublishingJobTransition("queued", "published")).toBe(false); // skip processing
    expect(isValidPublishingJobTransition("published", "queued")).toBe(false); // republish without a new job
    expect(isValidPublishingJobTransition("processing", "cancelled")).toBe(false); // cannot cancel mid-publish
    expect(isValidPublishingJobTransition("cancelled", "queued")).toBe(false); // a cancelled job is final
    expect(isValidPublishingJobTransition("published", "failed")).toBe(false);
  });

  it("the transition table has no duplicate (from, to) pairs", () => {
    const seen = new Set<string>();
    for (const t of PUBLISHING_JOB_TRANSITIONS) {
      const key = `${t.from}->${t.to}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("isTerminalPublishingJobStatus", () => {
  it("published, failed, and cancelled are terminal", () => {
    expect(isTerminalPublishingJobStatus("published")).toBe(true);
    expect(isTerminalPublishingJobStatus("failed")).toBe(true);
    expect(isTerminalPublishingJobStatus("cancelled")).toBe(true);
  });

  it("queued and processing are not terminal", () => {
    expect(isTerminalPublishingJobStatus("queued")).toBe(false);
    expect(isTerminalPublishingJobStatus("processing")).toBe(false);
  });
});
