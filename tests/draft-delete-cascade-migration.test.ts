import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260921153000_allow_draft_delete_version_cascade.sql",
  "utf8",
);

describe("unpublished draft deletion cascade migration", () => {
  it("allows only a nested FK cascade to delete version rows", () => {
    expect(migration).toContain("if pg_trigger_depth() > 1 then");
    expect(migration).toContain("return old;");
    expect(migration).toContain("Content draft version history cannot be deleted");
  });

  it("keeps direct updates and deletes append-only", () => {
    expect(migration).toContain("if tg_op = 'DELETE' then");
    expect(migration).toContain("This version is already sealed");
    expect(migration).toContain("Content draft version history is append-only");
  });

  it("does not disable, drop, or bypass the history trigger", () => {
    expect(migration).not.toMatch(/disable\s+trigger/i);
    expect(migration).not.toMatch(/drop\s+trigger/i);
    expect(migration).not.toMatch(/security\s+definer/i);
  });
});
