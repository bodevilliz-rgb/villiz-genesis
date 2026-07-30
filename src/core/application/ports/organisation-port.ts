import type {
  Organisation,
  OrganisationMember,
  OrganisationSummary,
} from "@/core/domain/entities/organisation";
import type { OrganisationRole } from "@/core/domain/entities/identity";

export interface OrganisationWriteModel {
  name: string;
  slug: string;
  legalName: string | null;
  industry: string | null;
  websiteUrl: string | null;
  status: Organisation["status"];
  brandColour: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  notes: string | null;
}

export interface OrganisationRepository {
  listForActor(): Promise<OrganisationSummary[]>;
  findById(id: string): Promise<Organisation | null>;
  slugExists(slug: string, excludeId?: string): Promise<boolean>;
  create(input: OrganisationWriteModel & { createdBy: string }): Promise<Organisation>;
  update(id: string, input: OrganisationWriteModel): Promise<Organisation>;
  delete(id: string): Promise<void>;

  listMembers(organisationId: string): Promise<OrganisationMember[]>;
  viewerRole(organisationId: string): Promise<OrganisationRole | null>;
  assignMember(input: {
    organisationId: string;
    profileId: string;
    role: OrganisationRole;
    assignedBy: string;
  }): Promise<void>;
  removeMember(organisationId: string, profileId: string): Promise<void>;
}
