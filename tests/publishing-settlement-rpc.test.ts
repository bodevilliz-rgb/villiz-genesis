import { expect, it, vi } from "vitest";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";

it.each(["pending", "published"])("settles %s with one transaction and propagates a lost RPC response for retry", async outcome => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "unavailable" }, status: 503 });
  const from = vi.fn(() => { throw new Error("non-atomic write"); });
  const repo = new SupabasePublishingRepository({ rpc, from } as never);
  const result = outcome === "pending"
    ? repo.awaitAttemptConfirmation("attempt", { postSubmissionId: "receipt" })
    : repo.completeAttempt("attempt", { externalPostId: "receipt", externalUrl: "url", providerMetadata: {} });
  await expect(result).rejects.toMatchObject({ infrastructureCategory: "service" });
  expect(from).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledOnce();
});

it("atomically settles an owned pre-submission failure and propagates errors for retry", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "unavailable" }, status: 503 })
    .mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
  const from = vi.fn(() => { throw new Error("non-atomic write"); });
  const repo = new SupabasePublishingRepository({ rpc, from } as never);
  const failure = { errorCode: "infrastructure_transient", errorMessage: "unavailable" };
  await expect(repo.settleFailedClaim("job", "owner", failure)).rejects.toMatchObject({ infrastructureCategory: "service" });
  await expect(repo.settleFailedClaim("job", "owner", failure)).resolves.toBe(true);
  await expect(repo.settleFailedClaim("job", "stale-owner", failure)).resolves.toBe(false);
  expect(rpc).toHaveBeenLastCalledWith("settle_failed_publishing_claim", {
    p_job_id: "job", p_worker_id: "stale-owner", p_error_code: failure.errorCode, p_error_message: failure.errorMessage,
  });
  expect(from).not.toHaveBeenCalled();
});
