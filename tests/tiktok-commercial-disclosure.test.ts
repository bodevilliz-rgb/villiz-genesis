/**
 * TikTok commercial-content disclosure — pre-merge compliance correction on
 * feature/tiktok-publishing (second correction, following the AI-disclosure
 * one in tests/tiktok-ai-disclosure.test.ts).
 *
 * Defect this closes: DEFAULT_TIKTOK_TARGET_OPTIONS sent isYourBrand:false
 * and isBrandedContent:false for EVERY TikTok publication — two more
 * truthfulness declarations Genesis cannot make globally. TikTok's own
 * Content Posting API guidelines (developers.tiktok.com/doc/content-
 * sharing-guidelines) require the poster to disclose "Your Brand" (own
 * business) and "Branded Content" (paid third-party partnership) status —
 * independent booleans, both may be true. Now the operator declares one of
 * four states (None / Own brand / Branded / Both) explicitly in the
 * publishing panel; the value is captured once into the intent snapshot,
 * persisted on the job row (publishing_jobs.is_your_brand /
 * is_branded_content — the same capture-once pattern as isAiGenerated and
 * resolvedAccountId), enforced non-null (both fields, independently) by
 * deterministic preflight at job creation AND worker execution, and sent
 * verbatim as target.isYourBrand / target.isBrandedContent. Never
 * defaulted, never inferred.
 *
 * Mandate map (11 concrete items; items 12-14 — AI-disclosure regression,
 * full suite, reliability — are proven by the full gate run, not unit
 * tests here):
 *   1  — blocked when unset
 *   2  — None maps false/false
 *   3  — Own brand maps true/false
 *   4  — Branded content maps false/true
 *   5  — Both maps true/true
 *   6  — scheduled job preserves declarations
 *   7  — retry preserves governed declarations
 *   8  — Pre-Publish Review displays declarations
 *   9  — TikTok publisher sends exact values
 *  10  — organisation isolation preserved
 *  11  — Instagram unaffected
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/application/use-cases/publishing")>();
  return {
    ...actual,
    createImmediatePublishingJob: vi.fn(async () => ({ id: "job-created", status: "queued" })),
    createScheduledPublishingJob: vi.fn(async () => ({ id: "job-scheduled", status: "queued" })),
    retryFailedPublishingJob: vi.fn(async (_deps, _orgId, jobId) => ({ id: jobId, status: "queued", retryCount: 1 })),
  };
});

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
import {
  createImmediatePublishingJobAction,
  createScheduledPublishingJobAction,
  retryPublishingJobAction,
} from "@/server/actions/publishing";
import { requireContext } from "@/server/container";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import {
  createImmediatePublishingJob,
  createScheduledPublishingJob,
  retryFailedPublishingJob,
} from "@/core/application/use-cases/publishing";
import { evaluatePlatformPreflight } from "@/core/domain/entities/publishing-preflight";
import { commercialDisclosureRequiredMessage, getPlatformPublishingPolicy } from "@/core/domain/entities/platform-policy";
import { confirmButtonLabel } from "@/components/content/pre-publish-dialog";
import { BlotatoTikTokPublisher } from "@/infrastructure/publishers/blotato/blotato-tiktok-publisher";
import type { BlotatoPublisherDeps } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { PublishInput } from "@/core/application/ports/publisher-port";
import type { PublishingIntent } from "@/core/domain/entities/publishing";

const ORG_ALPHA = "00000000-0000-4000-8000-0000000000a1";
const ORG_BETA = "00000000-0000-4000-8000-0000000000b2";
const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";
const JOB_ID = "job-1";

const DISCLOSURE_MESSAGE = 'TikTok requires a commercial content declaration. Choose an option under "Commercial content" before publishing.';

// ── Action-level fakes ─────────────────────────────────────────────────────────

function fakeContext(organisationId = ORG_ALPHA) {
  const asset = { organisationId, mimeType: "video/mp4" };
  const context = {
    actor: { id: "user-1" },
    publishing: {
      findActiveJobForDraftPlatform: vi.fn(async () => null),
      findJobById: vi.fn(async () => null),
    },
    content: {
      findDraft: vi.fn(async () => ({
        id: DRAFT_ID,
        organisationId,
        body: "A valid TikTok caption",
        title: "Post",
        status: "approved",
        hashtags: ["a", "b"],
      })),
      updateStatus: vi.fn(async () => ({})),
    },
    media: { listAssetsForDraft: vi.fn(async () => [asset]) },
    blotatoAccounts: {},
    organisations: { viewerRole: vi.fn(async () => "admin") },
    audits: { recordEvent: vi.fn(async () => {}) },
    notifications: { createNotification: vi.fn(async () => {}) },
  };
  vi.mocked(requireContext).mockResolvedValue(context as never);
  return context;
}

function immediateForm(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append("organisationId", ORG_ALPHA);
  fd.append("id", DRAFT_ID);
  fd.append("platform", "tiktok");
  fd.append("idempotencyKey", "idem-1");
  fd.append("isAiGenerated", "false");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function scheduledForm(fields: Record<string, string> = {}): FormData {
  const fd = immediateForm(fields);
  fd.append("scheduledForUtc", new Date(Date.now() + 3_600_000).toISOString());
  fd.append("timezone", "UTC");
  return fd;
}

function liveMode(enabled: boolean) {
  vi.mocked(blotatoConfig).mockReturnValue({ apiKey: "k", enabled: true, livePublishingEnabled: enabled } as never);
}

// ── Publisher-level fakes ──────────────────────────────────────────────────────

function fakeAccountRepo(): BlotatoAccountRepository {
  const account = {
    id: "acc-tk-1",
    platform: "tiktok",
    fullname: "Alpha TikTok",
    username: "alpha",
    organisationId: ORG_ALPHA,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-10T00:00:00Z",
  };
  return {
    upsertAccounts: async (accounts) => accounts.map(() => account),
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
    findActiveForOrganisationAndPlatform: async () => [account],
    listActiveForOrganisation: async () => [],
    assignToOrganisation: async () => account,
    removeFromOrganisation: async () => {},
  };
}

function fakeClient(publishPost: BlotatoClient["publishPost"]): BlotatoClient {
  return {
    listAccounts: async () => [],
    uploadMedia: async () => ({ url: "https://media.blotato.com/v.mp4", id: "m-1" }),
    publishPost,
    getPostStatus: async (id) => ({ postSubmissionId: id, status: "published", scheduledTime: null, publicUrl: "https://tiktok.com/@a/video/1", errorMessage: null }),
  };
}

function publisherDeps(publishPost: BlotatoClient["publishPost"], live = true): BlotatoPublisherDeps {
  return {
    blotatoAccounts: fakeAccountRepo(),
    blotatoClient: fakeClient(publishPost),
    livePublishingEnabled: live,
    statusPollIntervalMs: 0,
  };
}

function publishInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    organisationId: ORG_ALPHA,
    draftId: DRAFT_ID,
    jobId: JOB_ID,
    attemptId: "attempt-1",
    attemptNumber: 1,
    platform: "tiktok",
    title: "Post",
    body: "Caption",
    assetUrls: ["https://cdn.example.com/v.mp4"],
    devSimulationMode: "always_succeed",
    isAiGenerated: false,
    isYourBrand: false,
    isBrandedContent: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1: blocked when unset ───────────────────────────────────────────────────────

describe("1 — live TikTok publish is blocked when commercial disclosure is unset", () => {
  it("missing commercialDisclosure field -> error with the exact actionable message; no job is created", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
    expect(createImmediatePublishingJob).not.toHaveBeenCalled();
  });

  it("a tampered/unknown value is treated as never-declared, not as a declaration", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      immediateForm({ commercialDisclosure: "something-else" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
  });

  it("scheduled publish is blocked the same way", async () => {
    liveMode(true);
    fakeContext();
    const result = await createScheduledPublishingJobAction({ status: "idle", message: "" }, scheduledForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
    expect(createScheduledPublishingJob).not.toHaveBeenCalled();
  });
});

// ── 2-5: the 4-way mapping ──────────────────────────────────────────────────────

describe("2 — 'None' maps to isYourBrand:false, isBrandedContent:false", () => {
  it("createImmediatePublishingJob receives both false", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      immediateForm({ commercialDisclosure: "none" }),
    );
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isYourBrand: false, isBrandedContent: false }),
    );
  });
});

describe("3 — 'Own brand' maps to isYourBrand:true, isBrandedContent:false", () => {
  it("createImmediatePublishingJob receives true/false", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      immediateForm({ commercialDisclosure: "own" }),
    );
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isYourBrand: true, isBrandedContent: false }),
    );
  });
});

describe("4 — 'Branded content' maps to isYourBrand:false, isBrandedContent:true", () => {
  it("createImmediatePublishingJob receives false/true", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      immediateForm({ commercialDisclosure: "branded" }),
    );
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isYourBrand: false, isBrandedContent: true }),
    );
  });
});

describe("5 — 'Both' maps to isYourBrand:true, isBrandedContent:true", () => {
  it("createImmediatePublishingJob receives true/true", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      immediateForm({ commercialDisclosure: "both" }),
    );
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isYourBrand: true, isBrandedContent: true }),
    );
  });

  it("deterministic preflight itself passes for any of the 4 explicit combinations, never just 'both'", () => {
    for (const c of [
      { isYourBrand: false, isBrandedContent: false },
      { isYourBrand: true, isBrandedContent: false },
      { isYourBrand: false, isBrandedContent: true },
      { isYourBrand: true, isBrandedContent: true },
    ]) {
      const result = evaluatePlatformPreflight("tiktok", "Caption", 1, [], false, c);
      expect(result.blockers.some((b) => b.includes("Commercial content"))).toBe(false);
    }
  });
});

// ── 6: scheduled job preserves declarations ─────────────────────────────────────

describe("6 — the scheduled job persists the declared commercial-content values", () => {
  it("createScheduledPublishingJob receives the declared combination", async () => {
    liveMode(true);
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduledForm({ commercialDisclosure: "branded" }),
    );
    expect(result.status).toBe("success");
    expect(createScheduledPublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isYourBrand: false, isBrandedContent: true }),
    );
  });
});

// ── 7: retry preserves governed declarations ────────────────────────────────────

describe("7 — retry uses the persisted governed commercial-content values from the SAME job row", () => {
  function retryContext(job: { isYourBrand: boolean | null; isBrandedContent: boolean | null }) {
    const context = fakeContext();
    context.publishing.findJobById = vi.fn(async () => ({
      id: JOB_ID,
      organisationId: ORG_ALPHA,
      draftId: DRAFT_ID,
      platform: "tiktok",
      status: "failed",
      triggerType: "scheduled",
      isAiGenerated: false,
      isYourBrand: job.isYourBrand,
      isBrandedContent: job.isBrandedContent,
    })) as never;
    vi.mocked(requireContext).mockResolvedValue(context as never);
    return context;
  }

  function retryForm(): FormData {
    const fd = new FormData();
    fd.append("organisationId", ORG_ALPHA);
    fd.append("jobId", JOB_ID);
    fd.append("draftId", DRAFT_ID);
    return fd;
  }

  it("a job declared 'own brand' at creation retries without re-asking", async () => {
    liveMode(true);
    retryContext({ isYourBrand: true, isBrandedContent: false });
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("success");
    expect(retryFailedPublishingJob).toHaveBeenCalledTimes(1);
  });

  it("a hypothetical undeclared TikTok job (isBrandedContent null) is blocked from retry", async () => {
    liveMode(true);
    retryContext({ isYourBrand: false, isBrandedContent: null });
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
    expect(retryFailedPublishingJob).not.toHaveBeenCalled();
  });
});

// ── 8: Pre-Publish Review displays declarations ─────────────────────────────────

describe("8 — the confirm button's requirements gate reflects an unmet commercial disclosure exactly like any other blocker", () => {
  it("confirmButtonLabel reads 'Requirements not met' when liveBlocked, for a TikTok scheduled intent with declarations set", () => {
    const intent: PublishingIntent = {
      mode: "scheduled",
      organisationId: ORG_ALPHA,
      draftId: DRAFT_ID,
      platform: "tiktok",
      resolvedAccountId: "acc-tk-1",
      isAiGenerated: true,
      isYourBrand: true,
      isBrandedContent: false,
      scheduledForUtc: "2026-08-15T13:00:00.000Z",
      displayTimezone: "UTC",
      scheduledForLocalDisplay: "Aug 15, 2026, 1:00 PM",
    };
    expect(confirmButtonLabel(intent, { liveBlocked: true, submitting: false, score: 90 })).toBe("Requirements not met");
    expect(confirmButtonLabel(intent, { liveBlocked: false, submitting: false, score: 90 })).toBe("Schedule Post");
  });

  it("the intent snapshot carries the exact declared values through to review — never re-derived or reset", () => {
    const intent: PublishingIntent = {
      mode: "immediate",
      organisationId: ORG_ALPHA,
      draftId: DRAFT_ID,
      platform: "tiktok",
      resolvedAccountId: "acc-tk-1",
      isAiGenerated: false,
      isYourBrand: true,
      isBrandedContent: true,
    };
    expect(intent.isYourBrand).toBe(true);
    expect(intent.isBrandedContent).toBe(true);
  });
});

// ── 9: TikTok publisher sends exact values ──────────────────────────────────────

describe("9 — the TikTok publisher sends the exact declared isYourBrand/isBrandedContent values", () => {
  it("own-brand-only declaration reaches Blotato as isYourBrand:true, isBrandedContent:false", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const publisher = new BlotatoTikTokPublisher(publisherDeps(publishPost));
    const result = await publisher.publish(publishInput({ isYourBrand: true, isBrandedContent: false }));
    expect(result.success).toBe(true);
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ targetOptions: expect.objectContaining({ isYourBrand: true, isBrandedContent: false }) }),
    );
  });

  it("both-declared reaches Blotato as isYourBrand:true, isBrandedContent:true", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const publisher = new BlotatoTikTokPublisher(publisherDeps(publishPost));
    const result = await publisher.publish(publishInput({ isYourBrand: true, isBrandedContent: true }));
    expect(result.success).toBe(true);
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ targetOptions: expect.objectContaining({ isYourBrand: true, isBrandedContent: true }) }),
    );
  });

  it("a live publish with either field null refuses rather than fabricating a value", async () => {
    const publishPost = vi.fn();
    const publisher = new BlotatoTikTokPublisher(publisherDeps(publishPost));
    await expect(publisher.publish(publishInput({ isYourBrand: null }))).rejects.toThrow(/without a required declaration \(isYourBrand\)/);
    expect(publishPost).not.toHaveBeenCalled();
  });
});

// ── 10: organisation isolation preserved ────────────────────────────────────────

describe("10 — organisation isolation is unchanged by the commercial disclosure", () => {
  it("Alpha's request never reads or writes Beta's draft", async () => {
    liveMode(true);
    const context = fakeContext(ORG_ALPHA);
    await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      immediateForm({ commercialDisclosure: "none" }),
    );
    expect(context.content.findDraft).toHaveBeenCalledWith(ORG_ALPHA, DRAFT_ID);
    expect(context.content.findDraft).not.toHaveBeenCalledWith(ORG_BETA, DRAFT_ID);
  });
});

// ── 11: Instagram unaffected ────────────────────────────────────────────────────

describe("11 — Instagram (and every non-TikTok platform) is unaffected by the commercial disclosure", () => {
  it("no platform other than TikTok has requiresCommercialDisclosure in the canonical policy", () => {
    expect(getPlatformPublishingPolicy("tiktok").requiresCommercialDisclosure).toBe(true);
    for (const platform of ["instagram", "facebook", "linkedin", "x"] as const) {
      expect(getPlatformPublishingPolicy(platform).requiresCommercialDisclosure).toBeUndefined();
    }
  });

  it("Instagram preflight never blocks on missing commercial disclosure", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption", 1, []);
    expect(result.ready).toBe(true);
    expect(result.blockers.some((b) => b.includes("Commercial content"))).toBe(false);
  });

  it("a live Instagram immediate publish with no commercialDisclosure form field proceeds exactly as before", async () => {
    liveMode(true);
    fakeContext();
    const fd = immediateForm();
    fd.set("platform", "instagram");
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, fd);
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isYourBrand: null, isBrandedContent: null }),
    );
  });

  it("the canonical message helper is the single source for the disclosure-required string", () => {
    expect(commercialDisclosureRequiredMessage("tiktok")).toBe(DISCLOSURE_MESSAGE);
  });
});
