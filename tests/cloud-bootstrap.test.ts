import { describe, expect, it, vi } from "vitest";
import {
  ensureOrganisation,
  ensureAuthUser,
  ensureStaffProfile,
  ensureOrganisationMembership,
  type EnsureOrganisationDeps,
  type OrganisationRecord,
  type EnsureAuthUserDeps,
  type AuthUserRecord,
  type EnsureStaffProfileDeps,
  type ProfileRecord,
  type EnsureOrganisationMembershipDeps,
  type MembershipRecord,
} from "../scripts/cloud-bootstrap";

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

/**
 * Regression coverage for "duplicate key value violates unique constraint
 * profiles_pkey": the previous implementation looked up profiles by email
 * but inserted by the Auth user's id, so any email-matching mismatch (case,
 * whitespace, a stale/rehydrated auth user) fell through to insert a second
 * row for an id that already had one. ensureStaffProfile below must always
 * look up — and only ever insert — by primary key (id), never by email.
 */

const STAFF_EMAIL = "Bodevilliz@gmail.com";
const STAFF_INPUT = { authUserId: "user-1", email: STAFF_EMAIL, fullName: "Bode Villiz", role: "owner", confirm: true };

function fakeAuthUserDeps(overrides: Partial<EnsureAuthUserDeps> = {}): EnsureAuthUserDeps {
  return {
    findAuthUserByEmail: async () => null,
    createAuthUser: async (email) => ({ id: "user-created-1", email }),
    ...overrides,
  };
}

function fakeStaffProfileDeps(overrides: Partial<EnsureStaffProfileDeps> = {}): EnsureStaffProfileDeps {
  return {
    findProfileById: async () => null,
    createProfile: async (input) => ({ id: input.id, email: input.email, full_name: input.full_name, role: input.role, is_active: true }),
    updateProfile: async (id, fields) => ({
      id,
      email: fields.email ?? STAFF_EMAIL,
      full_name: fields.full_name ?? "Bode Villiz",
      role: fields.role ?? "owner",
      is_active: fields.is_active ?? true,
    }),
    ...overrides,
  };
}

function fakeMembershipDeps(overrides: Partial<EnsureOrganisationMembershipDeps> = {}): EnsureOrganisationMembershipDeps {
  return {
    findMembership: async () => null,
    createMembership: async () => {},
    updateMembershipRole: async () => {},
    ...overrides,
  };
}

const MEMBERSHIP_INPUT = { organisationId: "org-1", profileId: "user-1", role: "lead", confirm: true };

describe("ensureAuthUser + ensureStaffProfile — empty cloud project", () => {
  it("creates the auth user, then creates the profile keyed on that user's id", async () => {
    const createAuthUser = vi.fn(async (email: string) => ({ id: "user-new", email }));
    const createProfile = vi.fn(async (input: { id: string; email: string; full_name: string; role: string }) => ({
      id: input.id,
      email: input.email,
      full_name: input.full_name,
      role: input.role,
      is_active: true,
    }));

    const authResult = await ensureAuthUser(fakeAuthUserDeps({ createAuthUser }), STAFF_EMAIL, true);
    expect(authResult.outcome).toBe("created");
    expect(authResult.authUser?.id).toBe("user-new");

    const profileResult = await ensureStaffProfile(
      fakeStaffProfileDeps({ createProfile }),
      { ...STAFF_INPUT, authUserId: authResult.authUser!.id },
    );

    expect(createProfile).toHaveBeenCalledWith({ id: "user-new", email: STAFF_EMAIL, full_name: "Bode Villiz", role: "owner" });
    expect(profileResult.outcome).toBe("created");
    expect(profileResult.profileId).toBe("user-new");
  });

  it("dry run creates nothing", async () => {
    const createAuthUser = vi.fn();
    const authResult = await ensureAuthUser(fakeAuthUserDeps({ createAuthUser }), STAFF_EMAIL, false);

    expect(createAuthUser).not.toHaveBeenCalled();
    expect(authResult.outcome).toBe("would_create");
    expect(authResult.authUser).toBeNull();
  });
});

describe("ensureAuthUser + ensureStaffProfile — existing Auth user with existing complete profile", () => {
  it("reuses both and never calls createAuthUser, createProfile, or updateProfile", async () => {
    const existingUser: AuthUserRecord = { id: "user-existing", email: STAFF_EMAIL };
    const existingProfile: ProfileRecord = { id: "user-existing", email: STAFF_EMAIL, full_name: "Bode Villiz", role: "owner", is_active: true };

    const createAuthUser = vi.fn();
    const createProfile = vi.fn();
    const updateProfile = vi.fn();
    const findProfileById = vi.fn(async (id: string) => (id === "user-existing" ? existingProfile : null));

    const authResult = await ensureAuthUser(
      fakeAuthUserDeps({ findAuthUserByEmail: async () => existingUser, createAuthUser }),
      STAFF_EMAIL,
      true,
    );
    expect(authResult.outcome).toBe("found");
    expect(createAuthUser).not.toHaveBeenCalled();

    const profileResult = await ensureStaffProfile(
      fakeStaffProfileDeps({ findProfileById, createProfile, updateProfile }),
      { ...STAFF_INPUT, authUserId: authResult.authUser!.id },
    );

    expect(findProfileById).toHaveBeenCalledWith("user-existing");
    expect(createProfile).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(profileResult.outcome).toBe("found_complete");
    expect(profileResult.profileId).toBe("user-existing");
  });
});

describe("ensureAuthUser + ensureStaffProfile — existing Auth user without a profile", () => {
  it("reuses the auth user and creates the profile using the resolved user's id, never a second auth user", async () => {
    const existingUser: AuthUserRecord = { id: "user-existing", email: STAFF_EMAIL };
    const createAuthUser = vi.fn();
    const createProfile = vi.fn(async (input: { id: string; email: string; full_name: string; role: string }) => ({
      id: input.id,
      email: input.email,
      full_name: input.full_name,
      role: input.role,
      is_active: true,
    }));

    const authResult = await ensureAuthUser(
      fakeAuthUserDeps({ findAuthUserByEmail: async () => existingUser, createAuthUser }),
      STAFF_EMAIL,
      true,
    );
    expect(createAuthUser).not.toHaveBeenCalled();

    const profileResult = await ensureStaffProfile(
      fakeStaffProfileDeps({ findProfileById: async () => null, createProfile }),
      { ...STAFF_INPUT, authUserId: authResult.authUser!.id },
    );

    expect(createProfile).toHaveBeenCalledWith({ id: "user-existing", email: STAFF_EMAIL, full_name: "Bode Villiz", role: "owner" });
    expect(profileResult.outcome).toBe("created");
  });
});

describe("ensureStaffProfile — existing inactive profile", () => {
  it("updates only the incomplete/incorrect bootstrap-owned fields, preserving everything else", async () => {
    const incompleteProfile: ProfileRecord = { id: "user-1", email: STAFF_EMAIL, full_name: "Bode Villiz", role: "owner", is_active: false };
    const updateProfile = vi.fn(async (id: string, fields: Partial<{ is_active: boolean }>) => ({
      id,
      email: STAFF_EMAIL,
      full_name: "Bode Villiz",
      role: "owner",
      is_active: true,
      ...fields,
    }));

    const result = await ensureStaffProfile(
      fakeStaffProfileDeps({ findProfileById: async () => incompleteProfile, updateProfile }),
      STAFF_INPUT,
    );

    expect(updateProfile).toHaveBeenCalledWith("user-1", { is_active: true });
    expect(result.outcome).toBe("updated");
    expect(result.profileId).toBe("user-1");
  });

  it("dry run reports what would change without calling updateProfile", async () => {
    const incompleteProfile: ProfileRecord = { id: "user-1", email: STAFF_EMAIL, full_name: "Bode Villiz", role: "owner", is_active: false };
    const updateProfile = vi.fn();

    const result = await ensureStaffProfile(
      fakeStaffProfileDeps({ findProfileById: async () => incompleteProfile, updateProfile }),
      { ...STAFF_INPUT, confirm: false },
    );

    expect(updateProfile).not.toHaveBeenCalled();
    expect(result.outcome).toBe("would_update");
  });
});

describe("ensureStaffProfile — repeated bootstrap produces no duplicates", () => {
  it("calling it twice against the same backing store creates exactly once", async () => {
    const rows = new Map<string, ProfileRecord>();
    const createProfile = vi.fn(async (input: { id: string; email: string; full_name: string; role: string }) => {
      const record: ProfileRecord = { id: input.id, email: input.email, full_name: input.full_name, role: input.role, is_active: true };
      rows.set(input.id, record);
      return record;
    });
    const findProfileById = async (id: string) => rows.get(id) ?? null;

    const first = await ensureStaffProfile({ findProfileById, createProfile, updateProfile: fakeStaffProfileDeps().updateProfile }, STAFF_INPUT);
    const second = await ensureStaffProfile({ findProfileById, createProfile, updateProfile: fakeStaffProfileDeps().updateProfile }, STAFF_INPUT);

    expect(createProfile).toHaveBeenCalledTimes(1);
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("found_complete");
    expect(second.profileId).toBe(first.profileId);
  });
});

describe("ensureOrganisationMembership — existing membership is reused", () => {
  it("reuses a membership whose role already matches and never calls create or update", async () => {
    const existing: MembershipRecord = { organisation_id: "org-1", profile_id: "user-1", role: "lead" };
    const createMembership = vi.fn();
    const updateMembershipRole = vi.fn();

    const result = await ensureOrganisationMembership(
      fakeMembershipDeps({ findMembership: async () => existing, createMembership, updateMembershipRole }),
      MEMBERSHIP_INPUT,
    );

    expect(createMembership).not.toHaveBeenCalled();
    expect(updateMembershipRole).not.toHaveBeenCalled();
    expect(result.outcome).toBe("found_complete");
  });

  it("updates the role when an existing membership has the wrong one, without creating a duplicate", async () => {
    const existing: MembershipRecord = { organisation_id: "org-1", profile_id: "user-1", role: "contributor" };
    const createMembership = vi.fn();
    const updateMembershipRole = vi.fn();

    const result = await ensureOrganisationMembership(
      fakeMembershipDeps({ findMembership: async () => existing, createMembership, updateMembershipRole }),
      MEMBERSHIP_INPUT,
    );

    expect(createMembership).not.toHaveBeenCalled();
    expect(updateMembershipRole).toHaveBeenCalledWith("org-1", "user-1", "lead");
    expect(result.outcome).toBe("updated");
  });

  it("creates a membership only when none exists", async () => {
    const createMembership = vi.fn();

    const result = await ensureOrganisationMembership(fakeMembershipDeps({ createMembership }), MEMBERSHIP_INPUT);

    expect(createMembership).toHaveBeenCalledWith({ organisation_id: "org-1", profile_id: "user-1", role: "lead" });
    expect(result.outcome).toBe("created");
  });
});
