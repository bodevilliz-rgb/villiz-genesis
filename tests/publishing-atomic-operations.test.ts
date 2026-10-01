import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = resolve(root, "supabase/migrations/20260916170000_publishing_atomic_operations.sql");
const migration = readFileSync(migrationPath, "utf8").toLowerCase();
const repository = readFileSync(
  resolve(root, "src/infrastructure/repositories/supabase-publishing-repository.ts"),
  "utf8",
);
const useCase = readFileSync(resolve(root, "src/core/application/use-cases/publishing/index.ts"), "utf8");
const rotationScript = readFileSync(resolve(root, "scripts/rotate-publishing-worker-generation.ts"), "utf8");

describe("atomic publishing operations", () => {
  it("queues an immediate job, advances the draft and writes the audit event in one RPC", () => {
    expect(migration).toContain("create or replace function public.enqueue_immediate_publishing_job");
    expect(migration).toContain("insert into public.publishing_jobs as jobs");
    expect(migration).toContain("update public.content_drafts as drafts");
    expect(migration).toContain("v_draft.version is distinct from p_expected_draft_version");
    expect(migration).toContain("insert into public.audit_events as events");
    expect(migration).toContain("from public.blotato_accounts as accounts");
    expect(migration).toContain("values (v_job.organisation_id");
    expect(migration).toContain("where status in ('queued', 'processing', 'awaiting_confirmation')");
    expect(migration).toContain("grant execute on function public.enqueue_immediate_publishing_job");
    expect(repository).toContain('.rpc("enqueue_immediate_publishing_job"');
    expect(useCase).toContain("deps.publishing.createImmediateJob({");
  });

  it("provides a service-role-only, bounded generation rotation and rollback contract", () => {
    expect(migration).toContain("create or replace function public.rotate_publishing_worker_generation");
    expect(migration).toContain("create or replace function public.rollback_publishing_worker_generation");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(rotationScript).toContain("crypto.randomBytes(32)");
    expect(rotationScript).toContain("rotate_publishing_worker_generation");
    expect(rotationScript).toContain("rollback_publishing_worker_generation");
    expect(rotationScript).not.toContain("console.log(proof");
  });
});
