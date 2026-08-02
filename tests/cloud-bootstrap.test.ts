import { describe, expect, it, vi } from "vitest";
import { ensureOrganisation, type EnsureOrganisationDeps, type OrganisationRecord } from "../scripts/cloud-bootstrap";

/**
 * Regression coverage for the cloud bootstrap "null value in column slug"
 * failure: organisations.slug is NOT NULL + UNIQUE, so ensureOrganisation
 * must always look up by slug (not name), always pass slug through on
 * create, and never insert a second row for a slug that already exists —
 * including when a previous run left the organisation half-bootstrapped
 * (row exists, but the caller hadn't yet created a profile/membership for
 * it — see main()'s own doc comment on why that's the caller's job, not
 * this function's).
 */

const INPUT = { name: "Villiz Pixels", slug: "villiz-pixels", confirm: true };

function fakeDeps(overrides: Partial<EnsureOrganisationDeps> = {}): EnsureOrganisationDeps {
  return {
    findOrganisationBySlug: async () => null,
    createOrganisation: async (input) => ({ id: "org-created-1", ...input } as unknown as OrganisationRecord),
    ...overrides,
  };
}

describe("ensureOrganisation — empty cloud project", () => {
  it("creates the organisation with both name and slug when none exists and confirm is true", async () => {
    const createOrganisation = vi.fn(async () => ({ id: "org-new" }));
    const result = await ensureOrganisation(fakeDeps({ createOrganisation }), INPUT);

    expect(createOrganisation).toHaveBeenCalledWith({ name: "Villiz Pixels", slug: "villiz-pixels" });
    expect(result.outcome).toBe("created");
    expect(result.organisationId).toBe("org-new");
    expect(result.message).toContain("created");
  });

  it("does not create anything and reports would_create when confirm is false", async () => {
    const createOrganisation = vi.fn();
    const result = await ensureOrganisation(fakeDeps({ createOrganisation }), { ...INPUT, confirm: false });

    expect(createOrganisation).not.toHaveBeenCalled();
    expect(result.outcome).toBe("would_create");
    expect(result.organisationId).toBeNull();
  });
});

describe("ensureOrganisation — existing organisation found by slug", () => {
  it("reuses the existing organisation and never calls createOrganisation", async () => {
    const findOrganisationBySlug = vi.fn(async (slug: string) => (slug === "villiz-pixels" ? { id: "org-existing" } : null));
    const createOrganisation = vi.fn();

    const result = await ensureOrganisation(fakeDeps({ findOrganisationBySlug, createOrganisation }), INPUT);

    expect(findOrganisationBySlug).toHaveBeenCalledWith("villiz-pixels");
    expect(createOrganisation).not.toHaveBeenCalled();
    expect(result.outcome).toBe("found");
    expect(result.organisationId).toBe("org-existing");
    expect(result.message).toContain("found");
    expect(result.message).toContain("reusing");
  });

  it("still reports 'found' for an organisation that has no downstream profile/membership yet — recovery is the caller's job, not a re-create", async () => {
    // Simulates a previous run that created the org row but crashed before
    // Step 2/3 ever ran. ensureOrganisation's contract is: if the slug
    // exists, reuse it — it has no visibility into profiles/membership at
    // all, and must not attempt to create a second organisation for the
    // same slug just because those are missing.
    const findOrganisationBySlug = vi.fn(async () => ({ id: "org-partial" }));
    const createOrganisation = vi.fn();

    const result = await ensureOrganisation(fakeDeps({ findOrganisationBySlug, createOrganisation }), INPUT);

    expect(result.outcome).toBe("found");
    expect(result.organisationId).toBe("org-partial");
    expect(createOrganisation).not.toHaveBeenCalled();
  });
});

describe("ensureOrganisation — repeated bootstrap remains idempotent", () => {
  it("calling it twice against the same backing store creates exactly once", async () => {
    const rows = new Map<string, OrganisationRecord>();
    const createOrganisation = vi.fn(async (input: { name: string; slug: string }) => {
      const record = { id: "org-idempotent-1" };
      rows.set(input.slug, record);
      return record;
    });
    const findOrganisationBySlug = async (slug: string) => rows.get(slug) ?? null;

    const first = await ensureOrganisation({ findOrganisationBySlug, createOrganisation }, INPUT);
    const second = await ensureOrganisation({ findOrganisationBySlug, createOrganisation }, INPUT);

    expect(createOrganisation).toHaveBeenCalledTimes(1);
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("found");
    expect(second.organisationId).toBe(first.organisationId);
  });
});

describe("ensureOrganisation — insert failure surfaces a useful error", () => {
  it("wraps the underlying error with the organisation name and slug for context", async () => {
    const createOrganisation = vi.fn(async () => {
      throw new Error('null value in column "slug" of relation "organisations" violates not-null constraint');
    });

    await expect(ensureOrganisation(fakeDeps({ createOrganisation }), INPUT)).rejects.toThrow(
      /Failed to create organisation "Villiz Pixels" \(slug: "villiz-pixels"\)/,
    );
  });

  it("propagates a non-Error rejection as a readable message too", async () => {
    const createOrganisation = vi.fn(async () => {
      throw "unexpected string rejection";
    });

    await expect(ensureOrganisation(fakeDeps({ createOrganisation }), INPUT)).rejects.toThrow("unexpected string rejection");
  });
});
