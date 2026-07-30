import type { OrganisationUsage } from "@/core/domain/entities/usage";

export interface UsageRepository {
  forOrganisation(organisationId: string): Promise<OrganisationUsage | null>;
  forAllVisibleOrganisations(): Promise<OrganisationUsage[]>;
  updateLimits(input: {
    organisationId: string;
    maxSocialAccounts: number;
    maxPostsPerWeek: number;
    maxStorageBytes: number;
    maxAiTokensPerMonth: number;
    maxMembrainEntries: number;
  }): Promise<void>;
}
