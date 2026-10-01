import { beforeEach, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
vi.mock("@/server/container", () => ({ requireContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { requireContext } from "@/server/container";
import { revalidatePath } from "next/cache";
import * as actions from "@/server/actions/publishing";
import { idleState } from "@/server/action-result";

const findJobById = vi.fn();
const findLatestAttemptForJob = vi.fn();
const reconcileFailedTimeout = vi.fn();
const getPostStatus = vi.fn();
const context = { actor: { id: "actor", isPlatformAdmin: true }, organisations: {}, publishing: { findJobById, findLatestAttemptForJob, reconcileFailedTimeout }, blotatoClient: { getPostStatus } };
const form = new FormData(); form.set("organisationId", "org"); form.set("jobId", "job");
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireContext).mockResolvedValue(context as never);
  findJobById.mockResolvedValue({ id: "job", organisationId: "org", draftId: "draft", status: "failed", executionMode: "live" });
  findLatestAttemptForJob.mockResolvedValue({ id: "attempt", status: "failed", errorCode: "blotato_status_timeout", providerMetadata: { postSubmissionId: "receipt" } });
  reconcileFailedTimeout.mockResolvedValue({ id: "job", draftId: "draft" });
});
it.each(["published", "failed", "in-progress"])("authenticated action checks the existing receipt for %s", async status => {
  getPostStatus.mockResolvedValue({ status, postSubmissionId: "receipt", publicUrl: "https://example.test/post" });
  const result = await actions.reconcilePublishingJobAction(idleState, form);
  expect(result.status).toBe("success");
  expect(getPostStatus).toHaveBeenCalledExactlyOnceWith("receipt");
  expect(reconcileFailedTimeout).toHaveBeenCalledTimes(status === "in-progress" ? 0 : 1);
  expect(revalidatePath).toHaveBeenCalledWith("/organisations/org/publishing/job");
});
it("authentication failure does not read or reconcile", async () => {
  vi.mocked(requireContext).mockRejectedValueOnce(new Error("Sign in required"));
  expect((await actions.reconcilePublishingJobAction(idleState, form)).status).toBe("error");
  expect(findJobById).not.toHaveBeenCalled(); expect(getPostStatus).not.toHaveBeenCalled();
});
it("permission failure does not contact the provider", async () => {
  vi.mocked(requireContext).mockResolvedValueOnce({ ...context, actor: { id: "reader", isPlatformAdmin: false }, organisations: { viewerRole: vi.fn().mockResolvedValue("viewer") } } as never);
  expect((await actions.reconcilePublishingJobAction(idleState, form)).status).toBe("error");
  expect(getPostStatus).not.toHaveBeenCalled(); expect(reconcileFailedTimeout).not.toHaveBeenCalled();
});
it("ineligible rows fail without contacting the provider", async () => {
  findLatestAttemptForJob.mockResolvedValueOnce(null);
  expect((await actions.reconcilePublishingJobAction(idleState, form)).status).toBe("error");
  expect(getPostStatus).not.toHaveBeenCalled();
});
it("has exactly one runtime caller of legacy reconciliation", () => {
  function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.[cm]?tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []); }
  const callers = [...files("src"), ...files("scripts")].flatMap(file => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/(?<!function\s)\breconcileBlotatoStatusTimeout\s*\(/g)].map(() => file);
  });
  expect(callers).toEqual(["src/server/actions/publishing.ts"]);
});
