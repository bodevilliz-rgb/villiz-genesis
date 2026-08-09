/**
 * createScheduledPublishingJobAction — timezone-correct scheduling, wired
 * end-to-end from the raw form fields through to the use-case call
 * (fix/scheduled-publishing-integrity).
 *
 * Complements tests/scheduling-timezone.test.ts (the pure conversion
 * function) by proving the SERVER ACTION actually applies it — this is
 * exactly the code that used to do `new Date(scheduledAt).toISOString()`
 * and silently ignore the operator's selected timezone.
 *
 * A1 — a DST-affected timezone (Europe/London, summer) produces the exact expected UTC instant
 * A2 — a second DST case (America/New_York, winter) produces the exact expected UTC instant
 * A3 — createScheduledPublishingJob is called with triggerType-determining scheduled semantics only (never the immediate use-case)
 * A4 — createImmediatePublishingJobAction never calls the scheduled use-case
 * A5 — an invalid timezone reaching the server directly is rejected (defense in depth beyond the browser check)
 * A6 — a malformed datetime reaching the server directly is rejected
 * A7 — the resolvedAccountId and platform the operator selected survive unchanged into the use-case call (destination-locking preserved)
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing", () => ({
  createImmediatePublishingJob: vi.fn(async () => ({ id: "job-immediate-1" })),
  createScheduledPublishingJob: vi.fn(async () => ({ id: "job-scheduled-1" })),
  generateIdempotencyKey: vi.fn(() => "key"),
  retryFailedPublishingJob: vi.fn(),
  cancelPublishingJob: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing/preflight", () => ({
  checkPublishingPreflight: vi.fn(async () => ({ ready: true, blockers: [] })),
}));

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
import { createScheduledPublishingJobAction, createImmediatePublishingJobAction } from "@/server/actions/publishing";
import { requireContext } from "@/server/container";
import { createScheduledPublishingJob, createImmediatePublishingJob } from "@/core/application/use-cases/publishing";

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DRAFT_ID = "draft-1";

function fakeContext() {
  const context = { actor: { id: "user-1" }, publishing: {}, blotatoAccounts: {}, content: {}, organisations: {}, audits: {}, notifications: {}, media: {} };
  vi.mocked(requireContext).mockResolvedValue(context as never);
  return context;
}

function scheduleForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("A1/A2 — the action applies the DST-aware conversion, not a naive Date() parse", () => {
  it("A1: Europe/London summer time converts to the correct UTC instant before reaching the use-case", async () => {
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledAt: "2026-07-15T14:00",
        timezone: "Europe/London",
        idempotencyKey: "key-1",
        resolvedAccountId: "acc-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(createScheduledPublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scheduledFor: "2026-07-15T13:00:00.000Z" }),
    );
  });

  it("A2: America/New_York winter time converts to the correct UTC instant", async () => {
    fakeContext();
    await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledAt: "2026-01-15T09:00",
        timezone: "America/New_York",
        idempotencyKey: "key-2",
        resolvedAccountId: "acc-1",
      }),
    );

    expect(createScheduledPublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scheduledFor: "2026-01-15T14:00:00.000Z" }),
    );
  });
});

describe("A3/A4 — exactly one use-case is ever invoked per action", () => {
  it("A3: the scheduled action calls createScheduledPublishingJob and never createImmediatePublishingJob", async () => {
    fakeContext();
    await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledAt: "2026-07-15T14:00",
        timezone: "UTC",
        idempotencyKey: "key-3",
        resolvedAccountId: "acc-1",
      }),
    );
    expect(createScheduledPublishingJob).toHaveBeenCalledTimes(1);
    expect(createImmediatePublishingJob).not.toHaveBeenCalled();
  });

  it("A4: the immediate action calls createImmediatePublishingJob and never createScheduledPublishingJob", async () => {
    fakeContext();
    await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        idempotencyKey: "key-4",
        resolvedAccountId: "acc-1",
        devSimulationMode: "",
      }),
    );
    expect(createImmediatePublishingJob).toHaveBeenCalledTimes(1);
    expect(createScheduledPublishingJob).not.toHaveBeenCalled();
  });
});

describe("A5/A6 — server-side rejection is authoritative, independent of any browser check", () => {
  it("A5: an invalid timezone is rejected and no job is created", async () => {
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledAt: "2026-07-15T14:00",
        timezone: "Not/AZone",
        idempotencyKey: "key-5",
        resolvedAccountId: "acc-1",
      }),
    );
    expect(result.status).toBe("error");
    expect(createScheduledPublishingJob).not.toHaveBeenCalled();
  });

  it("A6: a malformed datetime is rejected and no job is created", async () => {
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledAt: "not-a-date",
        timezone: "UTC",
        idempotencyKey: "key-6",
        resolvedAccountId: "acc-1",
      }),
    );
    expect(result.status).toBe("error");
    expect(createScheduledPublishingJob).not.toHaveBeenCalled();
  });
});

describe("A7 — destination-locking: the selected account and platform survive unchanged into the use-case call", () => {
  it("resolvedAccountId and platform match exactly what was submitted", async () => {
    fakeContext();
    await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "linkedin",
        scheduledAt: "2026-07-15T14:00",
        timezone: "UTC",
        idempotencyKey: "key-7",
        resolvedAccountId: "acc-locked-42",
      }),
    );
    expect(createScheduledPublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ platform: "linkedin", resolvedAccountId: "acc-locked-42", organisationId: ORG_ID, draftId: DRAFT_ID }),
    );
  });
});
