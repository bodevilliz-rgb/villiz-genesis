// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { toast } from "sonner";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/actions/publishing", () => ({ reconcilePublishingJobAction: vi.fn(), retryPublishingJobAction: vi.fn(), cancelPublishingJobAction: vi.fn() }));
import { reconcilePublishingJobAction } from "@/server/actions/publishing";
import { PublishingJobRow } from "@/components/publishing/publishing-job-row";
import type { PublishingAttempt, PublishingJob } from "@/core/domain/entities/publishing";
import type { ActionState } from "@/server/action-result";

it.each(["success", "error"] as const)("operator status check submits only identifiers, disables during request, and reports %s", async status => {
  vi.clearAllMocks();
  let resolve!: (state: ActionState) => void;
  vi.mocked(reconcilePublishingJobAction).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  render(<PublishingJobRow organisationId="org" job={{ id: "job", draftId: "draft", status: "failed", executionMode: "live", platform: "instagram", triggerType: "immediate", retryCount: 0, maxRetries: 3 } as PublishingJob} draftTitle="Legacy" campaign={null} organisationName="Org" canWrite attempts={[{ id: "attempt", jobId: "job", organisationId: "org", draftId: "draft", platform: "instagram",
    attemptNumber: 1, queuedAt: "2026-08-01T10:00:00Z", startedAt: null, completedAt: null,
    failedAt: "2026-08-01T10:01:00Z", durationMs: 60_000, externalPostId: null, externalUrl: null,
    errorMessage: "Provider status timed out", retryOfAttemptId: null, createdAt: "2026-08-01T10:00:00Z", status: "failed", errorCode: "blotato_status_timeout", providerMetadata: { postSubmissionId: "receipt" } } as PublishingAttempt]} />);
  expect(screen.queryByRole("button", { name: "Retry Publish" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check provider status" }));
  await waitFor(() => expect(reconcilePublishingJobAction).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Checking provider…" })).toBeDisabled();
  const submitted = vi.mocked(reconcilePublishingJobAction).mock.calls[0]![1];
  expect([...submitted.entries()]).toEqual([["organisationId", "org"], ["jobId", "job"]]);
  await act(async () => resolve({ status, message: "Provider result" }));
  expect(toast[status]).toHaveBeenCalledWith("Provider result");
  expect(screen.getByRole("button", { name: "Check provider status" })).toBeEnabled();
});
