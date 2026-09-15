import { describe, it, expect } from "vitest";
import { isResumeEligibleDraft } from "./awo-campaign-worker-core";
import type { ContentDraftStatus } from "../src/core/domain/entities/content";

const draft = (status: ContentDraftStatus, body = "", hashtags: string[] = []) => ({
  status,
  body,
  hashtags,
});

describe("isResumeEligibleDraft", () => {
  it("resume processes editable unfinished drafts", () => {
    expect(isResumeEligibleDraft(draft("draft"))).toEqual(true);
    expect(isResumeEligibleDraft(draft("needs_review"))).toEqual(true);
    expect(isResumeEligibleDraft(draft("changes_requested"))).toEqual(true);
  });

  it("resume recovers unfinished Awo failed drafts", () => {
    expect(isResumeEligibleDraft(draft("failed"))).toEqual(true);
  });

  it("resume skips already completed drafts", () => {
    expect(isResumeEligibleDraft(draft("needs_review", "Ready caption", ["#brand", "#hair"]))).toEqual(false);
    expect(isResumeEligibleDraft(draft("failed", "Recovered caption", ["#brand", "#hair"]))).toEqual(false);
  });

  it("resume never sends protected terminal approval states back to Awo", () => {
    for (const status of ["approved", "rejected", "scheduled", "published", "archived", "awaiting_client"] as ContentDraftStatus[]) {
      expect(isResumeEligibleDraft(draft(status))).toEqual(false);
    }
  });

  it("missing drafts are not sent into Awo resume processing", () => {
    expect(isResumeEligibleDraft(null)).toEqual(false);
    expect(isResumeEligibleDraft(undefined)).toEqual(false);
  });
});
