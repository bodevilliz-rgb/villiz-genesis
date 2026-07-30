export type PlatformRole = "owner" | "admin" | "member";
export type OrganisationRole = "lead" | "contributor" | "reviewer";

export interface StaffProfile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  role: PlatformRole;
  isActive: boolean;
  createdAt: string;
}

/** The authenticated Villiz employee performing the current operation. */
export interface Actor extends StaffProfile {
  isPlatformAdmin: boolean;
}

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  member: "Team member",
};

export const ORGANISATION_ROLE_LABELS: Record<OrganisationRole, string> = {
  lead: "Account lead",
  contributor: "Contributor",
  reviewer: "Reviewer",
};

export const ORGANISATION_ROLE_DESCRIPTIONS: Record<OrganisationRole, string> = {
  lead: "Runs the account. Can edit the client record, manage the team and connect channels.",
  contributor: "Creates and edits work, including MemBrain knowledge.",
  reviewer: "Reads everything and approves work. Cannot edit.",
};

export function canEditOrganisation(actor: Actor, role: OrganisationRole | null): boolean {
  return actor.isPlatformAdmin || role === "lead";
}

export function canWriteContent(actor: Actor, role: OrganisationRole | null): boolean {
  return actor.isPlatformAdmin || role === "lead" || role === "contributor";
}

/**
 * Approval is distinct from editing — a Reviewer cannot write content (see
 * canWriteContent) but exists specifically to approve it, per their own role
 * description above. A Contributor cannot approve their own draft; it must
 * pass to a Reviewer or Lead.
 */
export function canApproveContent(actor: Actor, role: OrganisationRole | null): boolean {
  return actor.isPlatformAdmin || role === "lead" || role === "reviewer";
}
