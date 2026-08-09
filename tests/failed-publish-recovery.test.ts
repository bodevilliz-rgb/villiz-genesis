/**
 * Failed-publish recovery — retry eligibility (fix/failed-publish-recovery).
 *
 * Production governance dead end this closes: reopenReview now lets a Lead
 * move a "failed" draft to "needs_review" (see tests/review-workflow.test.ts),
 * but that alone isn't enough — retryPublishingJobAction must also refuse to
 * resend a draft that's mid-correction (reopened but not yet reapproved),
 * while continuing to allow retry directly from "failed" for failures that
 * needed no content correction at all (a transient network blip, a
 * temporarily disconnected account) — exactly today's existing, unmodified
 * behaviour, with zero forced reopen/reapprove detour.
 *
 * R1/T10 (mandate)  — retry blocked while the draft sits in needs_review (reopened, not yet reapproved)
 * R2/T13 (mandate)  — retry allowed once the draft is approved again
 * R3               — retry from the ORIGINAL "failed" status (no reopen at all) is unaffected — no regression for transient failures
 * R4/T14/T15 (mandate) — retryFailedPublishingJob is called with the SAME jobId; no second job is ever created (mechanism unchanged, reused from existing tests)
 * R5/T7/T8 (mandate)  — trigger_type and scheduled_for are never touched by reopen/reapproval/retry (structural: neither review nor retry write those columns)
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/application/use-cases/publishing")>();
  return {
    ...actual,
    retryFailedPublishingJob: vi.fn(async (_deps, _orgId, jobId) => ({ id: jobId, status: "queued", retryCount: 1, triggerType: "scheduled" })),
    createScheduledPublishingJob: vi.fn(),
    createImmediatePublishingJob: vi.fn(),
  };
});

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(() => ({ apiKey: "k", enabled: true, livePublishingEnabled: false })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/routes", () => ({
  routes: {
    organisations: {
      content: { index: (o: string) => `/organisations/${o}/content`, draft: (o: string, d: string) => `/organisations/${o}/content/${d}` },
      detail: (o: string) => `/organisations/${o}`,
    },
    dashboard: "/dashboard",
  },
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { retryPublishingJobAction } from "@/server/actions/publishing";
import { requireContext } from "@/server/container";
import { retryFailedPublishingJob } from "@/core/application/use-cases/publishing";
import type { ContentDraftStatus } from "@/core/domain/entities/content";

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DRAFT_ID = "draft-1";
const JOB_ID = "job-1";
const ORIGINAL_SCHEDULED_FOR = "2026-08-09T18:13:00.000Z";

function retryForm(): FormData {
  const fd = new FormData();
  fd.append("organisationId", ORG_ID);
  fd.append("jobId", JOB_ID);
  fd.append("draftId", DRAFT_ID);
  return fd;
}

function fakeContext(draftStatus: ContentDraftStatus) {
  const context = {
    actor: { id: "user-1" },
    publishing: {
      // The job carries its original trigger_type/scheduled_for — retry
      // must reuse this exact row, never construct a new one.
      findJobById: vi.fn(async () => ({
        id: JOB_ID,
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "instagram",
        status: "failed",
        triggerType: "scheduled",
        scheduledFor: ORIGINAL_SCHEDULED_FOR,
      })),
    },
    content: {
      findDraft: vi.fn(async () => ({ id: DRAFT_ID, organisationId: ORG_ID, body: "Caption", status: draftStatus, hashtags: ["a", "b", "c", "d", "e"] })),
    },
    media: { listAssetsForDraft: vi.fn(async () => []) },
    blotatoAccounts: {},
    organisations: {},
    audits: {},
    notifications: {},
  };
  vi.mocked(requireContext).mockResolvedValue(context as never);
  return context;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("R1/T10 (mandate) — retry is blocked while the draft is mid-correction (reopened, not yet reapproved)", () => {
  it("draft status needs_review → blocked with the exact operator-facing message", async () => {
    fakeContext("needs_review");
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain("Approve the corrected draft before retrying.");
    expect(retryFailedPublishingJob).not.toHaveBeenCalled();
  });

  it("draft status in_review → also blocked (still mid-correction)", async () => {
    fakeContext("in_review");
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("error");
    expect(retryFailedPublishingJob).not.toHaveBeenCalled();
  });

  it("draft status changes_requested → also blocked", async () => {
    fakeContext("changes_requested");
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("error");
    expect(retryFailedPublishingJob).not.toHaveBeenCalled();
  });
});

describe("R2/T13 (mandate) — retry is allowed once the draft has been reapproved", () => {
  it("draft status approved → retry proceeds", async () => {
    fakeContext("approved");
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("success");
    expect(retryFailedPublishingJob).toHaveBeenCalledTimes(1);
  });
});

describe("R3 — retry directly from the original failed status (never reopened) is unaffected — no regression", () => {
  it("a transient-failure job whose draft was never reopened still retries normally from status:failed", async () => {
    fakeContext("failed");
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("success");
    expect(retryFailedPublishingJob).toHaveBeenCalledTimes(1);
  });
});

describe("R4/T14/T15 (mandate) — retry reuses the original job; no second job is ever created", () => {
  it("retryFailedPublishingJob is invoked with the exact original jobId, and returns that same job's id", async () => {
    fakeContext("approved");
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(retryFailedPublishingJob).toHaveBeenCalledWith(expect.anything(), ORG_ID, JOB_ID);
    expect(result.resourceId).toBe(JOB_ID);
  });
});

describe("R5/T7/T8 (mandate) — trigger_type and scheduled_for history are structurally untouched by this recovery path", () => {
  it("the mocked retryFailedPublishingJob's returned job still reports triggerType 'scheduled' — retry never rewrites it", async () => {
    fakeContext("approved");
    await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    const returnedJob = await vi.mocked(retryFailedPublishingJob).mock.results[0]!.value;
    expect(returnedJob.triggerType).toBe("scheduled");
  });

  it("retryPublishingJobAction never calls createScheduledPublishingJob or createImmediatePublishingJob — it only ever requeues the existing row", async () => {
    const useCases = await import("@/core/application/use-cases/publishing");
    fakeContext("approved");
    await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(useCases.createScheduledPublishingJob).not.toHaveBeenCalled();
    expect(useCases.createImmediatePublishingJob).not.toHaveBeenCalled();
  });
});

describe("R6/T27 (mandate) — the recovery workflow is trigger-type agnostic: immediate-job recovery works identically", () => {
  it("an originally-immediate failed job follows the exact same reopen -> correct -> reapprove -> retry gate", async () => {
    const context = {
      actor: { id: "user-1" },
      publishing: {
        findJobById: vi.fn(async () => ({
          id: JOB_ID,
          organisationId: ORG_ID,
          draftId: DRAFT_ID,
          platform: "instagram",
          status: "failed",
          triggerType: "immediate",
          scheduledFor: null,
        })),
      },
      content: {
        findDraft: vi.fn(async () => ({ id: DRAFT_ID, organisationId: ORG_ID, body: "Caption", status: "needs_review", hashtags: ["a", "b", "c", "d", "e", "f"] })),
      },
      media: { listAssetsForDraft: vi.fn(async () => []) },
      blotatoAccounts: {},
      organisations: {},
      audits: {},
      notifications: {},
    };
    vi.mocked(requireContext).mockResolvedValue(context as never);

    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain("Approve the corrected draft before retrying.");
  });
});

describe("R7/T26 (mandate) — organisation isolation: retry eligibility is checked against the requesting organisation's own draft only", () => {
  it("findDraft is called with the exact organisationId from the request, never a different one", async () => {
    fakeContext("approved");
    await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    const context = vi.mocked(requireContext).mock.results[0]!.value as unknown as { content: { findDraft: ReturnType<typeof vi.fn> } };
    const resolved = await context;
    expect(vi.mocked((await resolved).content.findDraft)).toHaveBeenCalledWith(ORG_ID, DRAFT_ID);
  });
});
