/**
 * TikTok AI-generated-content disclosure — pre-merge compliance correction
 * on feature/tiktok-publishing.
 *
 * Defect this closes: DEFAULT_TIKTOK_TARGET_OPTIONS sent isAiGenerated:false
 * for EVERY TikTok publication — a truthfulness declaration Genesis cannot
 * make globally, because the value is content-specific. Now the operator
 * declares Yes/No explicitly in the publishing panel; the value is captured
 * once into the intent snapshot, persisted on the job row
 * (publishing_jobs.is_ai_generated — the same capture-once pattern as
 * resolvedAccountId), enforced non-null by deterministic preflight at job
 * creation AND worker execution (live mode), and sent verbatim as
 * target.isAiGenerated. Never defaulted, never inferred.
 *
 * Mandate map (12 items):
 *   D1  — live immediate publish blocked when unset
 *   D2  — live scheduled publish blocked when unset
 *   D3  — explicit false reaches Blotato as false
 *   D4  — explicit true reaches Blotato as true
 *   D5  — scheduled job persists the selected value (action -> job input; row -> domain)
 *   D6  — retry uses the job's persisted governed value
 *   D7  — organisation isolation unchanged
 *   D8  — Instagram (and other platforms) unaffected
 *   D9  — simulation behaviour explicit (no block, no provider call)
 *   D10 — existing TikTok tests remain green (tests/tiktok-publishing.test.ts, run in the same suite)
 *   D11/D12 — full suite + reliability gates (run at phase end)
 * Plus: publisher defense-in-depth — a live publish that somehow reaches the
 * provider layer undeclared refuses loudly rather than fabricating a value.
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
import { aiDisclosureRequiredMessage, getPlatformPublishingPolicy } from "@/core/domain/entities/platform-policy";
import { toPublishingJob, type PublishingJobRowWithRelations } from "@/infrastructure/mappers/publishing-mapper";
import { BlotatoTikTokPublisher } from "@/infrastructure/publishers/blotato/blotato-tiktok-publisher";
import type { BlotatoPublisherDeps } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { PublishInput } from "@/core/application/ports/publisher-port";

const ORG_ALPHA = "00000000-0000-4000-8000-0000000000a1";
const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";
const JOB_ID = "job-1";

const DISCLOSURE_MESSAGE = 'TikTok requires an AI-generated content declaration. Choose Yes or No under "AI-generated content?" before publishing.';

// ── Action-level fakes ─────────────────────────────────────────────────────────

function fakeContext(input: { draftStatus?: string; hashtags?: string[] } = {}) {
  const asset = { organisationId: ORG_ALPHA, mimeType: "video/mp4" };
  const context = {
    actor: { id: "user-1" },
    publishing: {
      findActiveJobForDraftPlatform: vi.fn(async () => null),
      findJobById: vi.fn(async () => null),
    },
    content: {
      findDraft: vi.fn(async () => ({
        id: DRAFT_ID,
        organisationId: ORG_ALPHA,
        body: "A valid TikTok caption",
        title: "Post",
        status: input.draftStatus ?? "approved",
        hashtags: input.hashtags ?? ["a", "b"],
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
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  // P0 fix: this whole file exercises live-mode preflight enforcement —
  // execution mode must be explicitly "live" for that enforcement to run
  // at all (see resolveEffectiveLivePublishing). set(), not append(), so a
  // caller passing executionMode via `fields` above still wins.
  if (!fd.has("executionMode")) fd.set("executionMode", "live");
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

function publishInput(isAiGenerated: boolean | null | undefined): PublishInput {
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
    isAiGenerated,
    // This file exercises only the AI-disclosure axis; commercial disclosure
    // is a separate, independently-governed pair of fields (see
    // tests/tiktok-commercial-disclosure.test.ts) and is fixed to an explicit
    // "no commercial content" declaration here so it never blocks these tests.
    isYourBrand: false,
    isBrandedContent: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── D1/D2: live publish/schedule blocked when unset ───────────────────────────

describe("D1 — live immediate TikTok publish is blocked when the AI declaration is unset", () => {
  it("missing isAiGenerated field -> error with the exact actionable message; no job is created", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
    expect(createImmediatePublishingJob).not.toHaveBeenCalled();
  });

  it("a tampered/non-boolean value ('maybe') is treated as never-declared, not as a declaration", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm({ isAiGenerated: "maybe" }));
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
    expect(createImmediatePublishingJob).not.toHaveBeenCalled();
  });
});

describe("D2 — live scheduled TikTok publish is blocked when the AI declaration is unset", () => {
  it("missing isAiGenerated field -> error with the exact actionable message; no job is created", async () => {
    liveMode(true);
    fakeContext();
    const result = await createScheduledPublishingJobAction({ status: "idle", message: "" }, scheduledForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
    expect(createScheduledPublishingJob).not.toHaveBeenCalled();
  });
});

// ── D3/D4: the explicit value reaches Blotato verbatim ────────────────────────

describe("D3 — an explicit 'No' (false) reaches Blotato as isAiGenerated: false", () => {
  it("live publish sends target isAiGenerated false alongside the product defaults", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const publisher = new BlotatoTikTokPublisher(publisherDeps(publishPost));
    const result = await publisher.publish(publishInput(false));
    expect(result.success).toBe(true);
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ targetOptions: expect.objectContaining({ isAiGenerated: false }) }),
    );
  });
});

describe("D4 — an explicit 'Yes' (true) reaches Blotato as isAiGenerated: true", () => {
  it("live publish sends target isAiGenerated true — the value is never rewritten", async () => {
    const publishPost = vi.fn(async () => ({ postSubmissionId: "sub-1" }));
    const publisher = new BlotatoTikTokPublisher(publisherDeps(publishPost));
    const result = await publisher.publish(publishInput(true));
    expect(result.success).toBe(true);
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ targetOptions: expect.objectContaining({ isAiGenerated: true }) }),
    );
  });
});

describe("defense in depth — a live publish that reaches the provider layer undeclared refuses loudly", () => {
  it("null isAiGenerated on the live path throws instead of fabricating a value; publishPost is never called", async () => {
    const publishPost = vi.fn();
    const publisher = new BlotatoTikTokPublisher(publisherDeps(publishPost));
    await expect(publisher.publish(publishInput(null))).rejects.toThrow(/without a required declaration \(isAiGenerated\)/);
    expect(publishPost).not.toHaveBeenCalled();
  });
});

// ── D5: the selected value is persisted with the job ──────────────────────────

describe("D5 — the selected value is persisted on the job and survives to execution", () => {
  it("the scheduled action passes the declared value through to createScheduledPublishingJob", async () => {
    liveMode(true);
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduledForm({ isAiGenerated: "true", commercialDisclosure: "none" }),
    );
    expect(result.status).toBe("success");
    expect(createScheduledPublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isAiGenerated: true }));
  });

  it("the immediate action passes the declared value through to createImmediatePublishingJob", async () => {
    liveMode(true);
    fakeContext();
    const result = await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      immediateForm({ isAiGenerated: "false", commercialDisclosure: "none" }),
    );
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isAiGenerated: false }));
  });

  it("a persisted is_ai_generated row value maps onto PublishingJob.isAiGenerated (and a legacy row without it maps to null)", () => {
    const baseRow = {
      id: JOB_ID,
      organisation_id: ORG_ALPHA,
      draft_id: DRAFT_ID,
      platform: "tiktok",
      trigger_type: "scheduled",
      scheduled_for: "2026-08-10T12:00:00Z",
      status: "queued",
      idempotency_key: "idem-1",
      requested_by: "user-1",
      created_at: "2026-08-10T00:00:00Z",
      updated_at: "2026-08-10T00:00:00Z",
      next_attempt_at: null,
      retry_count: 0,
      max_retries: 3,
      completed_at: null,
      cancelled_at: null,
      claimed_by: null,
      claimed_at: null,
      dev_simulation_mode: null,
      resolved_account_id: null,
    };
    expect(toPublishingJob({ ...baseRow, is_ai_generated: true } as unknown as PublishingJobRowWithRelations).isAiGenerated).toBe(true);
    expect(toPublishingJob({ ...baseRow, is_ai_generated: false } as unknown as PublishingJobRowWithRelations).isAiGenerated).toBe(false);
    expect(toPublishingJob(baseRow as unknown as PublishingJobRowWithRelations).isAiGenerated).toBeNull();
  });
});

// ── D6: retry uses the job's persisted governed value ─────────────────────────

describe("D6 — retry uses the persisted governed value from the SAME job row", () => {
  function retryContext(jobIsAiGenerated: boolean | null) {
    const context = fakeContext({ draftStatus: "approved" });
    context.publishing.findJobById = vi.fn(async () => ({
      id: JOB_ID,
      organisationId: ORG_ALPHA,
      draftId: DRAFT_ID,
      platform: "tiktok",
      status: "failed",
      triggerType: "scheduled",
      isAiGenerated: jobIsAiGenerated,
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

  it("a job declared at creation (true) retries without re-asking — the persisted value satisfies preflight", async () => {
    liveMode(true);
    retryContext(true);
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("success");
    expect(retryFailedPublishingJob).toHaveBeenCalledTimes(1);
  });

  it("a hypothetical undeclared TikTok job (null) is blocked from retry with the actionable message", async () => {
    liveMode(true);
    retryContext(null);
    const result = await retryPublishingJobAction({ status: "idle", message: "" }, retryForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain(DISCLOSURE_MESSAGE);
    expect(retryFailedPublishingJob).not.toHaveBeenCalled();
  });
});

// ── D7: organisation isolation unchanged ──────────────────────────────────────

describe("D7 — organisation isolation is unchanged by the disclosure", () => {
  it("the immediate action resolves the draft and preflight against the requesting organisation only", async () => {
    liveMode(true);
    const context = fakeContext();
    await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm({ isAiGenerated: "false" }));
    expect(context.content.findDraft).toHaveBeenCalledWith(ORG_ALPHA, DRAFT_ID);
  });
});

// ── D8: Instagram and other platforms unaffected ──────────────────────────────

describe("D8 — Instagram (and every non-TikTok platform) is unaffected", () => {
  it("no platform other than TikTok has requiresAiDisclosure in the canonical policy", () => {
    expect(getPlatformPublishingPolicy("tiktok").requiresAiDisclosure).toBe(true);
    for (const platform of ["instagram", "facebook", "linkedin", "x"] as const) {
      expect(getPlatformPublishingPolicy(platform).requiresAiDisclosure).toBeUndefined();
    }
  });

  it("Instagram preflight never blocks on an unprovided disclosure", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption", 1, []);
    expect(result.ready).toBe(true);
    expect(result.blockers.some((b) => b.includes("AI-generated"))).toBe(false);
  });

  it("a live Instagram immediate publish with no isAiGenerated form field proceeds exactly as before", async () => {
    liveMode(true);
    fakeContext();
    const fd = immediateForm();
    fd.set("platform", "instagram");
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, fd);
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isAiGenerated: null }));
  });
});

// ── D9: simulation behaviour explicit ─────────────────────────────────────────

describe("D9 — simulation behaviour is explicit: no block, no provider call", () => {
  it("with live publishing OFF, an undeclared TikTok publish is not blocked at the action (matching every other preflight rule's simulation semantics)", async () => {
    liveMode(false);
    fakeContext();
    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, immediateForm());
    expect(result.status).toBe("success");
    expect(createImmediatePublishingJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isAiGenerated: null }));
  });

  it("a simulated TikTok publish with an undeclared value never reaches the provider — no publishPost, no throw", async () => {
    const publishPost = vi.fn();
    const publisher = new BlotatoTikTokPublisher(publisherDeps(publishPost, false));
    const result = await publisher.publish(publishInput(null));
    expect(result.success).toBe(true);
    if (result.success) expect(result.externalPostId).toMatch(/^mock-tiktok-\d+$/);
    expect(publishPost).not.toHaveBeenCalled();
  });
});

// ── Preflight message helper stays consistent everywhere ──────────────────────

describe("the operator-facing message is a single canonical string", () => {
  it("aiDisclosureRequiredMessage('tiktok') matches the message asserted throughout this file", () => {
    expect(aiDisclosureRequiredMessage("tiktok")).toBe(DISCLOSURE_MESSAGE);
  });
});
