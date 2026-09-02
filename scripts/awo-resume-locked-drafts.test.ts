import assert from "node:assert/strict";
import test from "node:test";
import { isResumeEligibleDraft } from "./awo-campaign-worker-core";

const draft = (status: any, body = "", hashtags: string[] = []) => ({ status, body, hashtags });

test("resume processes editable unfinished drafts", () => {
  assert.equal(isResumeEligibleDraft(draft("draft")), true);
  assert.equal(isResumeEligibleDraft(draft("needs_review")), true);
  assert.equal(isResumeEligibleDraft(draft("changes_requested")), true);
});

test("resume recovers unfinished Awo failed drafts", () => {
  assert.equal(isResumeEligibleDraft(draft("failed")), true);
});

test("resume skips already completed drafts", () => {
  assert.equal(isResumeEligibleDraft(draft("needs_review", "Ready caption", ["#brand", "#hair"])), false);
  assert.equal(isResumeEligibleDraft(draft("failed", "Recovered caption", ["#brand", "#hair"])), false);
});

test("resume never sends protected terminal approval states back to Awo", () => {
  for (const status of ["approved", "rejected", "scheduled", "published", "archived", "awaiting_client"]) {
    assert.equal(isResumeEligibleDraft(draft(status)), false, status);
  }
});

test("missing drafts are not sent into Awo resume processing", () => {
  assert.equal(isResumeEligibleDraft(null), false);
  assert.equal(isResumeEligibleDraft(undefined), false);
});
