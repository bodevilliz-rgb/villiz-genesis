import type { Organisation, OrganisationMember } from "@/core/domain/entities/organisation";
import type { OrganisationRow, ProfileRow, OrganisationMemberRow } from "../supabase/database.types";

export function toOrganisation(row: OrganisationRow): Organisation {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legalName: row.legal_name,
    industry: row.industry,
    websiteUrl: row.website_url,
    status: row.status,
    brandColour: row.brand_colour,
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    notes: row.notes,
    onboardedAt: row.onboarded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toOrganisationMember(
  row: OrganisationMemberRow & {
    profiles: Pick<ProfileRow, "id" | "email" | "full_name" | "avatar_url" | "job_title" | "is_active" | "role"> | null;
  },
): OrganisationMember {
  return {
    organisationId: row.organisation_id,
    profileId: row.profile_id,
    role: row.role,
    createdAt: row.created_at,
    profile: {
      id: row.profiles?.id ?? row.profile_id,
      email: row.profiles?.email ?? "unknown",
      fullName: row.profiles?.full_name ?? null,
      avatarUrl: row.profiles?.avatar_url ?? null,
      jobTitle: row.profiles?.job_title ?? null,
      isActive: row.profiles?.is_active ?? false,
      platformRole: row.profiles?.role,
    },
  };
}
