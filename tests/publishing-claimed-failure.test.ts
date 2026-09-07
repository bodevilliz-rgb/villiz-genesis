import { beforeEach, expect, it, vi } from "vitest";
import { createPublishingPoller } from "../scripts/publishing-worker-core";
const publish = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/publishers/publisher-factory", () => ({ resolvePublisher: () => ({ publish }) }));
beforeEach(() => { publish.mockReset(); });
function harness() {
  const job = { id: "job", organisationId: "org", draftId: "draft", platform: "facebook", executionMode: "live", requestedBy: null };
  const attempt = { id: "attempt", attemptNumber: 1, status: "started" };
  const publishing = { recoverStaleJobs: vi.fn().mockResolvedValue([]), beginSubmission: vi.fn(), settleFailedClaim: vi.fn().mockResolvedValue(true), claimNextJob: vi.fn().mockResolvedValue(job), async findLatestAttemptForJob(organisationId: string, jobId: string) { return (await this.listAttemptsForJob(organisationId, jobId)).at(-1) ?? null; }, listAttemptsForJob: vi.fn().mockResolvedValue([]), createAttempt: vi.fn().mockResolvedValue(attempt), startAttempt: vi.fn().mockResolvedValue(attempt), failAttempt: vi.fn(), markJobFailed: vi.fn(), markJobAwaitingConfirmation: vi.fn(), recordConfirmationCheck: vi.fn(), awaitAttemptConfirmation: vi.fn(), completeAttempt: vi.fn(), markJobPublished: vi.fn() };
  const deps = { publishing, content: { findDraft: vi.fn().mockResolvedValue({ body: "hello", hashtags: [] }), updateStatus: vi.fn() }, media: { listAssetsForDraft: vi.fn().mockResolvedValue([]) }, storage: {}, audits: { recordEvent: vi.fn() }, notifications: {}, blotatoLivePublishingEnabled: true };
  let now = 0;
  return { deps, publishing, poll: createPublishingPoller(deps as never, () => now), advance: () => { now += 900_000; } };
}
it.each([{ code: "exceed_egress_quota" }, { status: 429 }, { status: 503 }])("settles an already claimed infrastructure failure and never tightly reacquires: %j", async error => {
  const h = harness(); h.deps.media.listAssetsForDraft.mockRejectedValue(error);
  await h.poll();
  expect(h.publishing.settleFailedClaim).toHaveBeenCalledWith("job", expect.any(String), expect.objectContaining({ errorCode: error.code ? "infrastructure_blocked" : "infrastructure_transient" }));
  expect(h.publishing.failAttempt).not.toHaveBeenCalled();
  expect(h.deps.content.updateStatus).not.toHaveBeenCalledWith("org", "draft", "failed", expect.anything());
  for (let i = 0; i < 20; i++) await h.poll();
  expect(h.publishing.claimNextJob).toHaveBeenCalledOnce(); expect(publish).not.toHaveBeenCalled();
});
it("holds at most one failed settlement while writes are unavailable; probes settlement before new claims", async () => {
  const h = harness(); h.deps.media.listAssetsForDraft.mockRejectedValue({ status: 503 });
  h.publishing.settleFailedClaim.mockRejectedValueOnce({ status: 503 }).mockResolvedValue(true);
  await h.poll(); h.advance(); await h.poll();
  expect(h.publishing.claimNextJob).toHaveBeenCalledOnce();
  expect(h.publishing.settleFailedClaim).toHaveBeenCalledTimes(2);
});
it("one cycle releases job media before another claim and never drains a backlog", async () => {
  const h = harness(); publish.mockResolvedValue({ success: true, externalPostId: "post", externalUrl: "https://example.test/post" });
  await h.poll(); expect(h.publishing.claimNextJob).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledOnce();
});
it("persists a non-retryable barrier before submission; an uncertain/accepted outcome never becomes failed", async () => {
  const h = harness();
  publish.mockImplementation(async (input) => { await input.onBeforeSubmission(); expect(h.publishing.beginSubmission).toHaveBeenCalledWith("job", "attempt", expect.any(String)); throw new Error("fetch failed"); });
  await h.poll();
  expect(h.publishing.beginSubmission).toHaveBeenCalledOnce();
  expect(h.publishing.markJobFailed).not.toHaveBeenCalled(); expect(h.publishing.failAttempt).not.toHaveBeenCalled();
  await h.poll(); expect(publish).toHaveBeenCalledOnce();
});
it("records returned provider infrastructure failures as blocked attempts", async () => {
  const h = harness();
  publish.mockResolvedValue({ success: false, errorCode: "media_resolution_failed", errorMessage: "upload unavailable", metadata: { infrastructureError: { code: "exceed_egress_quota" } } });
  await h.poll();
  expect(h.publishing.failAttempt.mock.calls[0]?.[1]).toMatchObject({ errorCode: "infrastructure_blocked" });
  expect(h.publishing.markJobFailed).toHaveBeenCalledOnce();
});
it("keeps an accepted ID in recovery logs when outcome persistence fails, without failing or resubmitting", async () => {
  const h = harness(); const logs = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    h.publishing.awaitAttemptConfirmation.mockRejectedValue({ status: 503 });
    publish.mockImplementation(async input => { await input.onBeforeSubmission(); return { success: "pending", providerSubmissionId: "accepted-post", metadata: { postSubmissionId: "accepted-post" } }; });
    await h.poll(); await h.poll();
    expect(h.publishing.markJobFailed).not.toHaveBeenCalled(); expect(publish).toHaveBeenCalledOnce();
    expect(logs.mock.calls.some(([line]) => JSON.parse(line).postSubmissionId === "accepted-post")).toBe(true);
  } finally { logs.mockRestore(); }
});

it.each(["completeAttempt", "markJobPublished", "awaitAttemptConfirmation", "audit", "draft"])("retains exactly one receipt across settlement failure at %s and retries without publishing", async boundary => {
  const h = harness();
  const isPending = boundary.startsWith("await") || boundary === "markJobAwaitingConfirmation";
  publish.mockImplementation(async input => {
    await input.onBeforeSubmission();
    const target = boundary === "audit" ? h.deps.audits.recordEvent : boundary === "draft" ? h.deps.content.updateStatus : h.publishing[boundary as "completeAttempt"];
    target.mockRejectedValueOnce({ status: 503 });
    return isPending
      ? { success: "pending", providerSubmissionId: "accepted-post", metadata: { postSubmissionId: "accepted-post" } }
      : { success: true, externalPostId: "accepted-post", externalUrl: "https://example.test/post" };
  });
  await h.poll();
  for (let i = 0; i < 50; i++) await h.poll();
  expect(publish).toHaveBeenCalledOnce();
  h.advance(); await h.poll();
  expect(h.publishing.claimNextJob).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledOnce();
  expect(h.publishing.markJobFailed).not.toHaveBeenCalled();
  if (isPending) expect(h.publishing.awaitAttemptConfirmation).toHaveBeenLastCalledWith("attempt", expect.objectContaining({ postSubmissionId: "accepted-post" }));
  else expect(h.publishing.markJobPublished).toHaveBeenLastCalledWith("job");
});

it("recovers on startup and once per minute inside the same circuit, without a drain", async () => {
  const publishing = { recoverStaleJobs: vi.fn().mockResolvedValue([]), claimNextJob: vi.fn().mockResolvedValue(null), claimJobForConfirmation: vi.fn().mockResolvedValue(null) };
  let now = 0;
  const poll = createPublishingPoller({ publishing } as never, () => now);
  await poll();
  expect(publishing.recoverStaleJobs).toHaveBeenCalledWith(300);
  for (let i = 0; i < 20; i++) await poll();
  expect(publishing.recoverStaleJobs).toHaveBeenCalledOnce();
  now = 60_000; publishing.recoverStaleJobs.mockRejectedValueOnce({ code: "exceed_egress_quota" });
  await poll(); const claims = publishing.claimNextJob.mock.calls.length;
  now += 60_000; await poll();
  expect(publishing.claimNextJob).toHaveBeenCalledTimes(claims);
  now += 900_000; await poll();
  expect(publishing.recoverStaleJobs).toHaveBeenCalledTimes(3);
});

it("retains only one receipt through a prolonged outage and resumes settlement before any new claim", async () => {
  const h = harness();
  h.publishing.awaitAttemptConfirmation.mockRejectedValue({ code: "exceed_egress_quota" });
  publish.mockImplementation(async input => { await input.onBeforeSubmission(); return { success: "pending", providerSubmissionId: "receipt" }; });
  await h.poll();
  for (let i = 0; i < 30; i++) { h.advance(); await h.poll(); }
  expect(publish).toHaveBeenCalledOnce();
  expect(h.publishing.claimNextJob).toHaveBeenCalledOnce();
  expect(h.publishing.awaitAttemptConfirmation).toHaveBeenCalledTimes(31);
  h.publishing.awaitAttemptConfirmation.mockResolvedValue({});
  h.advance(); await h.poll();
  expect(h.publishing.awaitAttemptConfirmation).toHaveBeenLastCalledWith("attempt", expect.objectContaining({ postSubmissionId: "receipt" }));
  expect(h.publishing.claimNextJob).toHaveBeenCalledOnce();
});

it("does not fail or submit an expired claim when the durable barrier rejects it", async () => {
  const h = harness(); const post = vi.fn();
  h.publishing.beginSubmission.mockRejectedValue(new Error("expired lease"));
  publish.mockImplementation(async input => { await input.onBeforeSubmission(); post(); });
  await h.poll();
  expect(post).not.toHaveBeenCalled();
  expect(h.publishing.markJobFailed).not.toHaveBeenCalled();
});

it("does not settle an old pre-submission failure after recovery has reassigned its claim", async () => {
  const h = harness();
  Object.assign(h.publishing, { settleFailedClaim: vi.fn().mockResolvedValue(false) });
  h.deps.media.listAssetsForDraft.mockRejectedValue({ status: 503 });
  await h.poll();
  expect(h.publishing.markJobFailed).not.toHaveBeenCalled();
  expect(h.publishing.failAttempt).not.toHaveBeenCalled();
});

it.each(["pending", "published"])("retains bounded provider metadata after the first %s settlement RPC fails", async outcome => {
  const h = harness();
  const target = outcome === "pending" ? h.publishing.awaitAttemptConfirmation : h.publishing.completeAttempt;
  target.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({});
  publish.mockImplementation(async input => {
    await input.onBeforeSubmission();
    return {
      success: outcome === "pending" ? "pending" : true,
      providerSubmissionId: "receipt", externalPostId: "external-post", externalUrl: "url",
      metadata: { blotatoAccountId: "account", postSubmissionId: "receipt", provider: "blotato",
        confirmationError: { infrastructureCategory: "service", status: 503, message: "unavailable", response: "x".repeat(100000) },
        responseBody: "x".repeat(100000), rawResponse: { body: "x".repeat(100000) } },
    };
  });
  await h.poll(); h.advance(); await h.poll();
  expect(target).toHaveBeenCalledTimes(2);
  const args = target.mock.calls[1]![1];
  const metadata = outcome === "pending" ? args : args.providerMetadata;
  expect(metadata).toMatchObject({ blotatoAccountId: "account", provider: "blotato", postSubmissionId: "receipt",
    confirmationError: { infrastructureCategory: "service", status: 503, message: "unavailable" },
    publishedPayloadFingerprint: expect.any(String) });
  expect(JSON.stringify(metadata).length).toBeLessThan(16000);
  expect(metadata.rawResponse).toBeUndefined();
  expect(publish).toHaveBeenCalledOnce();
  expect(h.publishing.claimNextJob).toHaveBeenCalledOnce();
});

it.each([429, 503])("%s grows 2s → 4s → 8s across distinct claimed jobs and resumes after health restoration", async status => {
  const h = harness();
  let now = 0;
  const poll = createPublishingPoller(h.deps as never, () => now);
  h.publishing.claimNextJob.mockImplementation(async () => ({ id: `job-${h.publishing.claimNextJob.mock.calls.length}`, organisationId: "org", draftId: "draft", platform: "facebook", executionMode: "live", requestedBy: null }));
  h.deps.media.listAssetsForDraft.mockRejectedValue({ status });
  for (const [index, delay] of [2000, 4000, 8000].entries()) {
    await poll();
    expect(h.publishing.claimNextJob).toHaveBeenCalledTimes(index + 1);
    now += delay - 1;
    for (let i = 0; i < 10; i++) await poll();
    expect(h.publishing.claimNextJob).toHaveBeenCalledTimes(index + 1);
    now += 1;
  }
  expect(publish).not.toHaveBeenCalled();
  h.deps.media.listAssetsForDraft.mockResolvedValue([]);
  publish.mockResolvedValue({ success: true, externalPostId: "restored" });
  await poll();
  expect(publish).toHaveBeenCalledOnce();
  expect(h.publishing.claimNextJob).toHaveBeenCalledTimes(4);
});
