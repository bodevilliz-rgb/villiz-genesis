/**
 * createScheduledPublishingJobAction — timezone-correct scheduling
 * (fix/scheduled-publishing-integrity, revised after a P0 regression).
 *
 * Contract: the action reads a PRE-CONVERTED `scheduledForUtc` ISO instant
 * from a hidden, always-enabled form field — it no longer re-derives the
 * instant from raw `scheduledAt`/`timezone` fields server-side. That
 * conversion (Europe/London, America/New_York DST correctness etc.) is
 * proven once in tests/scheduling-timezone.test.ts and applied client-side
 * at the moment the operator clicks Schedule (publishing-panel.tsx).
 *
 * Why the contract changed: the visible scheduledAt/timezone controls
 * disable themselves the instant Pre-Publish Review opens (so nothing can
 * drift from what's under review), but confirmAction() submits the form
 * WHILE the dialog is still open. A native `disabled` form control is
 * EXCLUDED from FormData entirely on submission — so the old contract
 * (reading `scheduledAt`/`timezone` directly) reached this action empty on
 * every real confirm, throwing "Choose a date and time to publish." with
 * no job ever created. Proven against a real production UAT: confirmed at
 * 2026-08-09T18:07:25Z, zero publishing_jobs row, zero audit event, and the
 * exact "Choose a date and time to publish." error in Vercel logs.
 *
 * A1 — a valid pre-converted scheduledForUtc flows through to the use-case unchanged
 * A2 — scheduledForUtc survives byte-for-byte (no re-parsing/re-derivation)
 * A3 — createScheduledPublishingJob is the only use-case invoked (never immediate)
 * A4 — createImmediatePublishingJobAction never calls the scheduled use-case
 * A5 — an empty scheduledForUtc is rejected — THE EXACT PRODUCTION FAILURE MODE
 * A6 — a malformed/unparseable scheduledForUtc is rejected
 * A7 — resolvedAccountId and platform survive unchanged (destination-locking preserved)
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

describe("A1/A2 — a pre-converted scheduledForUtc flows through unchanged", () => {
  it("A1: a valid UTC instant reaches createScheduledPublishingJob verbatim", async () => {
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledForUtc: "2026-07-15T13:00:00.000Z",
        timezone: "Europe/London",
        idempotencyKey: "key-1",
        resolvedAccountId: "acc-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(createScheduledPublishingJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scheduledFor: "2026-07-15T13:00:00.000Z", timezone: "Europe/London" }),
    );
  });

  it("A2: a second instant (different zone) also survives byte-for-byte", async () => {
    fakeContext();
    await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledForUtc: "2026-01-15T14:00:00.000Z",
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
        scheduledForUtc: "2026-07-15T14:00:00.000Z",
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

describe("A5/A6 — malformed input is rejected server-side", () => {
  it("A5: an empty scheduledForUtc is rejected — the exact production failure mode (a disabled field silently excluded from FormData)", async () => {
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledForUtc: "",
        timezone: "Europe/London",
        idempotencyKey: "key-5",
        resolvedAccountId: "acc-1",
      }),
    );
    expect(result.status).toBe("error");
    expect(createScheduledPublishingJob).not.toHaveBeenCalled();
  });

  it("A6: a malformed scheduledForUtc is rejected and no job is created", async () => {
    fakeContext();
    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      scheduleForm({
        organisationId: ORG_ID,
        id: DRAFT_ID,
        platform: "instagram",
        scheduledForUtc: "not-a-date",
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
        scheduledForUtc: "2026-07-15T14:00:00.000Z",
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
