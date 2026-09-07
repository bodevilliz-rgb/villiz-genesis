import { readFileSync } from "node:fs";
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

it("legacy reconciliation uses one dedicated RPC and propagates response loss without partial writes", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "unavailable" }, status: 503 });
  const from = vi.fn(() => { throw new Error("non-atomic write"); });
  const repo = new SupabasePublishingRepository({ rpc, from } as never);
  await expect(repo.reconcileFailedTimeout({
    organisationId: "org", jobId: "job", attemptId: "old", postSubmissionId: "receipt", externalUrl: "url", actorId: "actor",
  })).rejects.toMatchObject({ infrastructureCategory: "service" });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("reconcile_failed_publishing_timeout", {
    p_organisation_id: "org", p_job_id: "job", p_attempt_id: "old",
    p_post_submission_id: "receipt", p_external_url: "url", p_actor_id: "actor",
  });
  expect(from).not.toHaveBeenCalled();
});

it("confirmed provider failure uses atomic receipt settlement and propagates response loss", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "unavailable" }, status: 503 });
  const from = vi.fn(() => { throw new Error("non-atomic write"); });
  const repo = new SupabasePublishingRepository({ rpc, from } as never);
  await expect(repo.failAttempt("attempt", {
    errorCode: "blotato_publish_failed", errorMessage: "rejected",
    providerMetadata: { postSubmissionId: "receipt", confirmedAfterAwaiting: true },
  })).rejects.toMatchObject({ infrastructureCategory: "service" });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("settle_publishing_receipt", {
    p_attempt_id: "attempt", p_outcome: "failed",
    p_metadata: { postSubmissionId: "receipt", confirmedAfterAwaiting: true, errorMessage: "rejected" },
    p_external_post_id: "receipt", p_external_url: null,
  });
  expect(from).not.toHaveBeenCalled();
});

it("validates receipt identity for every outcome before replay or mutation", () => {
  const sql = readFileSync("supabase/migrations/20260907000000_publishing_safe_recovery_settlement.sql", "utf8")
    .split("create or replace function public.settle_publishing_receipt(")[1];
  expect(sql).toBeDefined();
  const functionSql = sql!;
  const guard = functionSql.slice(functionSql.indexOf("  if ("), functionSql.indexOf("Provider receipt identity mismatch"));
  expect(guard).not.toContain("p_outcome");
  expect(guard).toContain("nullif(btrim(p_external_post_id), '') is null");
  expect(guard).toContain("jsonb_typeof(p_metadata->'postSubmissionId') is distinct from 'string'");
  expect(guard).toContain("p_metadata->>'postSubmissionId' is distinct from p_external_post_id");
  expect(guard).toContain("v_attempt.provider_metadata->>'postSubmissionId' is distinct from p_external_post_id");
  expect(guard).toContain("v_attempt.external_post_id is distinct from p_external_post_id");
  expect(functionSql.indexOf("Provider receipt identity mismatch")).toBeLessThan(functionSql.indexOf("return v_attempt"));
  expect(functionSql.indexOf("Provider receipt identity mismatch")).toBeLessThan(functionSql.indexOf("update public."));
});

it.each(["receipt", "wrong", "   ", 123, null, undefined])(
  "pending passes receipt %s to atomic settlement and propagates rejection without fallback writes",
  async receipt => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Provider receipt identity mismatch" } });
    const from = vi.fn(() => { throw new Error("non-atomic write"); });
    const repo = new SupabasePublishingRepository({ rpc, from } as never);
    await expect(repo.awaitAttemptConfirmation("attempt", { postSubmissionId: receipt }))
      .rejects.toThrow("Provider receipt identity mismatch");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("settle_publishing_receipt", {
      p_attempt_id: "attempt", p_outcome: "pending", p_metadata: { postSubmissionId: receipt },
      p_external_post_id: typeof receipt === "string" ? receipt : null, p_external_url: null,
    });
    expect(from).not.toHaveBeenCalled();
  },
);
