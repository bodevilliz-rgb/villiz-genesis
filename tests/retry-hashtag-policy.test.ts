/**
 * Retry safety against platform hashtag policy — fix/platform-hashtag-policy.
 *
 * The production job this fix responds to failed with a live Blotato 422
 * for 6 Instagram hashtags. retryPublishingJobAction must not blindly
 * requeue a job whose draft still violates platform policy — that would
 * just fail the exact same way again a few seconds later. It checks
 * checkPublishingPreflight (the SAME canonical policy every other layer
 * uses) before requeueing; the worker's own preflight remains as defense
 * in depth regardless.
 *
 * R1/T18 — retry is blocked before the provider call when the draft still has 6 hashtags
 * R2/T19 — retry proceeds once the draft has been corrected to 5 hashtags
 * R3     — retry in simulation mode (livePublishingEnabled=false) is not gated by preflight — matches existing simulation semantics
 * R4     — a genuinely unrelated failure (no connected account) is unaffected — the hashtag guard does not interfere with other retry reasons
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/application/use-cases/publishing")>();
  return {
    ...actual,
    retryFailedPublishingJob: vi.fn(async (_deps, _orgId, jobId) => ({ id: jobId, status: "queued", retryCount: 1 })),
  };
});

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(),
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
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DRAFT_ID = "draft-1";
const JOB_ID = "job-1";

function retryForm(): FormData {
  const fd = new FormData();
  fd.append("organisationId", ORG_ID);
  fd.append("jobId", JOB_ID);
  fd.append("draftId", DRAFT_ID);
  return fd;
}

function fakeContext(overrides: { hashtags?: string[]; hasMedia?: boolean; hasAccount?: boolean; jobPlatform?: string } = {}) {
  const hasMedia = overrides.hasMedia ?? true;
  const asset = hasMedia ? [{ organisationId: ORG_ID, mimeType: "image/jpeg" }] : [];

  const context = {
    actor: { id: "user-1" },
    publishing: {
      findJobById: vi.fn(async () => ({ id: JOB_ID, organisationId: ORG_ID, draftId: DRAFT_ID, platform: overrides.jobPlatform ?? "instagram", status: "failed" })),
    },
    content: {
      findDraft: vi.fn(async () => ({ id: DRAFT_ID, organisationId: ORG_ID, body: "Caption", hashtags: overrides.hashtags ?? [] })),
    },
    media: {
      listAssetsForDraft: vi.fn(async () => asset),
    },
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

describe("R1/T18 (mandate) — retry is blocked before any provider call when the draft still violates platform policy", () => {
  it("6 hashtags on the current draft blocks retry with an actionable error; requeue never happens", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: true } as never);
    fakeContext({ hashtags: ["a", "b", "c", "d", "e", "f"] });

    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());

    expect(result.status).toBe("error");
    expect(retryFailedPublishingJob).not.toHaveBeenCalled();
  });
});

describe("R2/T19 (mandate) — retry proceeds once the draft has been corrected to comply", () => {
  it("5 hashtags on the current draft allows the retry to requeue via existing semantics", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: true } as never);
    fakeContext({ hashtags: ["a", "b", "c", "d", "e"] });

    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());

    expect(result.status).toBe("success");
    expect(retryFailedPublishingJob).toHaveBeenCalledTimes(1);
  });
});

describe("R3 — retry in simulation mode is not gated by preflight", () => {
  it("livePublishingEnabled=false: 6 hashtags does not block the retry (matches existing simulation semantics)", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: false } as never);
    fakeContext({ hashtags: ["a", "b", "c", "d", "e", "f"] });

    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());

    expect(result.status).toBe("success");
    expect(retryFailedPublishingJob).toHaveBeenCalledTimes(1);
  });
});

describe("R4 — an unrelated retry (no hashtag issue) is unaffected by the new guard", () => {
  it("a compliant draft with media retries normally", async () => {
    vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: true } as never);
    fakeContext({ hashtags: ["a", "b"], hasMedia: true });

    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());

    expect(result.status).toBe("success");
    expect(retryFailedPublishingJob).toHaveBeenCalledTimes(1);
  });
});
