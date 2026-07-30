import type { OrganisationRole } from "./identity";

export type OrganisationStatus = "prospect" | "active" | "paused" | "offboarded";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  industry: string | null;
  websiteUrl: string | null;
  status: OrganisationStatus;
  brandColour: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  notes: string | null;
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationSummary extends Organisation {
  /** The current actor's role on this account, null for platform admins with no assignment. */
  viewerRole: OrganisationRole | null;
  memberCount: number;
  membrainEntryCount: number;
}

export interface OrganisationMember {
  organisationId: string;
  profileId: string;
  role: OrganisationRole;
  createdAt: string;
  profile: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    jobTitle: string | null;
    isActive: boolean;
  };
}

export const ORGANISATION_STATUS_LABELS: Record<OrganisationStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  paused: "Paused",
  offboarded: "Offboarded",
};

/**
 * Status drives the operational meaning of an account, so the mapping to visual
 * treatment lives in the domain rather than being re-invented per component.
 */
export const ORGANISATION_STATUS_TONE: Record<OrganisationStatus, "positive" | "neutral" | "warning" | "muted"> = {
  active: "positive",
  prospect: "neutral",
  paused: "warning",
  offboarded: "muted",
};
