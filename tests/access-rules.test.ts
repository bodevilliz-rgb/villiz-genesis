import { describe, expect, it } from "vitest";
import { canApproveContent, canEditOrganisation, canManagePlatformStaff, canWriteContent } from "@/core/domain/entities/identity";
import type { Actor } from "@/core/domain/entities/identity";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: "profile-1",
    email: "strategist@villiz.com",
    fullName: "Strategist",
    jobTitle: null,
    avatarUrl: null,
    role: "member",
    isActive: true,
    isPlatformAdmin: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("who may change what", () => {
  it("lets an account lead manage their own organisation", () => {
    expect(canEditOrganisation(actor(), "lead")).toBe(true);
  });

  it("does not let a reviewer change the organisation record", () => {
    expect(canEditOrganisation(actor(), "reviewer")).toBe(false);
  });

  it("does not let a non-member change an organisation", () => {
    expect(canEditOrganisation(actor(), null)).toBe(false);
  });

  it("lets a platform admin manage any organisation, member or not", () => {
    expect(canEditOrganisation(actor({ isPlatformAdmin: true, role: "admin" }), null)).toBe(true);
  });

  it("lets leads and contributors write knowledge", () => {
    expect(canWriteContent(actor(), "lead")).toBe(true);
    expect(canWriteContent(actor(), "contributor")).toBe(true);
  });

  it("keeps reviewers read-only", () => {
    expect(canWriteContent(actor(), "reviewer")).toBe(false);
  });

  it("gives a non-member no write access at all", () => {
    expect(canWriteContent(actor(), null)).toBe(false);
  });

  it("lets leads and reviewers approve content, but not contributors", () => {
    expect(canApproveContent(actor(), "lead")).toBe(true);
    expect(canApproveContent(actor(), "reviewer")).toBe(true);
    expect(canApproveContent(actor(), "contributor")).toBe(false);
  });

  it("gives a non-member no approval rights", () => {
    expect(canApproveContent(actor(), null)).toBe(false);
  });

  it("lets a platform admin approve content regardless of role", () => {
    expect(canApproveContent(actor({ isPlatformAdmin: true, role: "admin" }), null)).toBe(true);
  });

  it("allows only active canonical owners and admins to manage staff", () => {
    expect(canManagePlatformStaff(actor({ role: "owner", isPlatformAdmin: true }))).toBe(true);
    expect(canManagePlatformStaff(actor({ role: "admin", isPlatformAdmin: true }))).toBe(true);
    expect(canManagePlatformStaff(actor({ role: "member", isPlatformAdmin: false }))).toBe(false);
    expect(canManagePlatformStaff(actor({ role: "admin", isPlatformAdmin: true, isActive: false }))).toBe(false);
  });

  it("does not trust an inconsistent client-supplied admin flag", () => {
    expect(canManagePlatformStaff(actor({ role: "member", isPlatformAdmin: true }))).toBe(false);
    expect(canManagePlatformStaff(actor({ role: "admin", isPlatformAdmin: false }))).toBe(false);
  });
});
