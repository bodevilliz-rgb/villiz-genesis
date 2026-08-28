import type { IntentConsentStatus, IntentSignal, IntentSource, IntentStage } from "@/core/domain/entities/intent";

export interface IntentSignalWriteModel {
  organisationId: string;
  serviceKey: string;
  serviceLabel: string;
  locality: string | null;
  desiredTimeframe: string | null;
  source: IntentSource;
  stage: IntentStage;
  consentStatus: IntentConsentStatus;
  occurredAt: string;
  createdBy: string;
}

export interface IntentRepository {
  listRecent(organisationId: string, since: string): Promise<IntentSignal[]>;
  create(input: IntentSignalWriteModel): Promise<IntentSignal>;
}
