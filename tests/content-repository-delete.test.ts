import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/core/domain/errors";
import { SupabaseContentRepository } from "@/infrastructure/repositories/supabase-content-repository";

function deleteClient(result: { data: { id: string } | null; error: null }) {
  const maybeSingle = vi.fn(async () => result);
  const select = vi.fn(() => ({ maybeSingle }));
  const organisationEq = vi.fn(() => ({ select }));
  const idEq = vi.fn(() => ({ eq: organisationEq }));
  const update = vi.fn(() => ({ eq: idEq }));
  const from = vi.fn(() => ({ update }));

  return {
    client: { from },
    calls: { from, update, idEq, organisationEq, select, maybeSingle },
  };
}

describe("SupabaseContentRepository.deleteDraft", () => {
  it("soft-deletes by tenant and id while preserving publishing evidence", async () => {
    const { client, calls } = deleteClient({ data: { id: "draft-1" }, error: null });
    const repository = new SupabaseContentRepository(client as never);

    await repository.deleteDraft("org-1", "draft-1", "actor-1");

    expect(calls.from).toHaveBeenCalledWith("content_drafts");
    expect(calls.update).toHaveBeenCalledWith(expect.objectContaining({ deleted_by: "actor-1", updated_by: "actor-1" }));
    expect(calls.idEq).toHaveBeenCalledWith("id", "draft-1");
    expect(calls.organisationEq).toHaveBeenCalledWith("organisation_id", "org-1");
    expect(calls.select).toHaveBeenCalledWith("id");
  });

  it("rejects a zero-row removal instead of reporting false success", async () => {
    const { client } = deleteClient({ data: null, error: null });
    const repository = new SupabaseContentRepository(client as never);

    await expect(repository.deleteDraft("org-1", "missing-draft", "actor-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
