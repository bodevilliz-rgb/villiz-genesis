import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { EXPECTED_SEEDED_ORGANISATION, verifySeededOrganisation } = require("../scripts/local-seed-verification.js") as {
  EXPECTED_SEEDED_ORGANISATION: { id: string; name: string };
  verifySeededOrganisation: (actual: { id: string; name: string }) => { ok: boolean; error?: string };
};

describe("local ACOR Client Zero seed verification", () => {
  it("accepts only the authoritative organisation ID and UK name", () => {
    expect(EXPECTED_SEEDED_ORGANISATION).toEqual({ id: "00000000-0000-4000-b000-000000000001", name: "Villiz Pixels UK" });
    expect(verifySeededOrganisation(EXPECTED_SEEDED_ORGANISATION)).toEqual({ ok: true });
  });

  it("rejects the same ID with an unexpected name", () => {
    const result = verifySeededOrganisation({ id: EXPECTED_SEEDED_ORGANISATION.id, name: "Villiz Pixels" });
    expect(result.ok).toBe(false); expect(result.error).toContain('expected organisation "Villiz Pixels UK"');
  });

  it("rejects a wrong ID even when the name is correct", () => {
    const result = verifySeededOrganisation({ id: "00000000-0000-4000-b000-000000000099", name: EXPECTED_SEEDED_ORGANISATION.name });
    expect(result.ok).toBe(false); expect(result.error).toContain("expected organisation ID");
  });
});
