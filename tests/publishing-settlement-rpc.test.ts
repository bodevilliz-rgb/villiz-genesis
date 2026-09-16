import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";

const CLAIM_ISOLATION_MIGRATION = "supabase/migrations/20260909000000_publishing_claim_isolation.sql";

it("denies live-authorised jobs to workers whose effective live mode is false", () => {
  const sql = readFileSync(CLAIM_ISOLATION_MIGRATION, "utf8");
  const claim = sql.split("create or replace function public.claim_pre_submission_publishing_job(")[1];

  expect(claim).toBeDefined();
  expect(claim).toContain("j.execution_mode = 'simulation'");
  expect(claim).toContain("p_live_publishing_enabled is true");
  expect(claim).toContain("j.execution_mode = 'live'");
});

it("requires a current active generation and independently registered live-capability proof", () => {
  const sql = readFileSync(CLAIM_ISOLATION_MIGRATION, "utf8");
  const claim = sql.split("create or replace function public.claim_pre_submission_publishing_job(")[1];

  expect(sql).toContain("create table public.publishing_worker_generations");
  expect(sql).toContain("status in ('active', 'draining', 'retired')");
  expect(claim).toContain("g.status = 'active'");
  expect(claim).toContain("g.generation_id = p_worker_generation");
  expect(claim).toContain("g.live_publishing_capable is true");
  expect(claim).toContain("g.capability_proof_sha256 = encode(extensions.digest(p_live_capability_proof, 'sha256'), 'hex')");
  expect(claim).toContain("g.valid_until > now()");
});

it("fails closed on prior submission evidence until the exact duplicate set is reconciled", () => {
  const sql = readFileSync(CLAIM_ISOLATION_MIGRATION, "utf8");
  const claim = sql.split("create or replace function public.claim_pre_submission_publishing_job(")[1];

  expect(sql).toContain("create table public.publishing_duplicate_reconciliations");
  expect(sql).toContain("reconciled_attempt_ids uuid[]");
  expect(sql).toContain("disposition = 'safe_to_submit'");
  expect(claim).toContain("array_agg(a.id order by a.id)");
  expect(claim).toContain("r.reconciled_attempt_ids =");
  expect(sql).toContain("prevent_publishing_reconciliation_mutation");
});

it("revalidates the same current live-capability proof at the provider-submission barrier", () => {
  const sql = readFileSync(CLAIM_ISOLATION_MIGRATION, "utf8");
  const barrier = sql.split("create or replace function public.begin_publishing_submission(")[1];

  expect(sql).toContain("claimed_generation_id text");
  expect(barrier).toBeDefined();
  expect(barrier).toContain("v_job.claimed_generation_id is distinct from p_worker_generation");
  expect(barrier).toContain("g.status = 'active'");
  expect(barrier).toContain("g.valid_until > now()");
  expect(barrier).toContain("providerSubmissionAuthorized");
});

it("locks capability state at claim and revalidates the exact duplicate set at the provider barrier", () => {
  const sql = readFileSync(CLAIM_ISOLATION_MIGRATION, "utf8");
  const claim = sql.split("create or replace function public.claim_pre_submission_publishing_job(")[1];
  const barrier = sql.split("create or replace function public.begin_publishing_submission(")[1];

  expect(claim).toContain("for share");
  expect(claim).not.toContain("for key share");
  expect(barrier).toContain("for share");
  expect(barrier).toContain("publishing_duplicate_reconciliations");
  expect(barrier).toContain("r.reconciled_attempt_ids = (");
  expect(barrier).toContain("array_agg(a.id order by a.id)");
});

it("guards inserts and updates so mock settlement is simulation-only", () => {
  const sql = readFileSync(CLAIM_ISOLATION_MIGRATION, "utf8");
  const guard = sql.split("create or replace function app.enforce_publishing_attempt_semantics()")[1];

  expect(guard).toBeDefined();
  expect(guard).toContain("v_job.execution_mode = 'live'");
  expect(guard).toContain("providerSubmissionAuthorized");
  expect(guard).toContain("mock.local");
  expect(guard).toContain("new.provider_metadata->'simulated' is distinct from 'true'::jsonb");
  expect(sql).toContain("before insert or update on public.publishing_attempts");
  expect(guard).toContain("reconciledFromAttemptId");
  expect(guard).toContain("error_code = 'blotato_status_timeout'");
});

it("preserves terminal and receipt-bearing attempt evidence across delete cascades", () => {
  const sql = readFileSync(CLAIM_ISOLATION_MIGRATION, "utf8");
  const guard = sql.split("create or replace function app.prevent_publishing_attempt_evidence_deletion()")[1];

  expect(guard).toBeDefined();
  expect(guard).toContain("old.status in ('completed', 'failed')");
  expect(guard).toContain("old.provider_metadata ? 'simulated'");
  expect(sql).toContain("before delete on public.publishing_attempts");
  expect(sql).toContain("using errcode = '42501'");
});

it("threads fail-closed worker capability fields into the transactional claim", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null, status: 200 });
  const repo = new SupabasePublishingRepository({ rpc } as never);

  await repo.claimNextJob("worker", true, {
    livePublishingEnabled: false,
    generationId: null,
    proof: null,
  });

  expect(rpc).toHaveBeenCalledExactlyOnceWith("claim_pre_submission_publishing_job", {
    p_worker_id: "worker",
    p_live_publishing_enabled: false,
    p_worker_generation: null,
    p_live_capability_proof: null,
  });
});

it("threads the same capability proof into the final provider-submission barrier", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, status: 204 });
  const repo = new SupabasePublishingRepository({ rpc } as never);

  await repo.beginSubmission("job", "attempt", "worker", {
    livePublishingEnabled: true,
    generationId: "generation-2",
    proof: "proof-value",
  });

  expect(rpc).toHaveBeenCalledExactlyOnceWith("begin_publishing_submission", {
    p_job_id: "job",
    p_attempt_id: "attempt",
    p_worker_id: "worker",
    p_worker_generation: "generation-2",
    p_live_capability_proof: "proof-value",
  });
});

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
