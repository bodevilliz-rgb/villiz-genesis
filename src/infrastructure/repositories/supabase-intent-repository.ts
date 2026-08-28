import "server-only";
import type { IntentRepository, IntentSignalWriteModel } from "@/core/application/ports/intent-port";
import type { IntentSignal } from "@/core/domain/entities/intent";
import type { GenesisClient } from "@/infrastructure/supabase/server-client";
import { translateError, unwrap } from "./errors";

function toIntentSignal(row: {
  id: string; organisation_id: string; service_key: string; service_label: string; locality: string | null;
  desired_timeframe: string | null; source: IntentSignal["source"]; stage: IntentSignal["stage"];
  consent_status: IntentSignal["consentStatus"]; occurred_at: string; created_by: string | null; created_at: string;
}): IntentSignal {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    serviceKey: row.service_key,
    serviceLabel: row.service_label,
    locality: row.locality,
    desiredTimeframe: row.desired_timeframe,
    source: row.source,
    stage: row.stage,
    consentStatus: row.consent_status,
    occurredAt: row.occurred_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export class SupabaseIntentRepository implements IntentRepository {
  constructor(private readonly client: GenesisClient) {}

  async listRecent(organisationId: string, since: string): Promise<IntentSignal[]> {
    const { data, error } = await this.client.from("intent_signals").select("*")
      .eq("organisation_id", organisationId).gte("occurred_at", since).order("occurred_at", { ascending: false });
    if (error) translateError(error, "Intent signals");
    return (data ?? []).map(toIntentSignal);
  }

  async create(input: IntentSignalWriteModel): Promise<IntentSignal> {
    const result = await this.client.from("intent_signals").insert({
      organisation_id: input.organisationId,
      service_key: input.serviceKey,
      service_label: input.serviceLabel,
      locality: input.locality,
      desired_timeframe: input.desiredTimeframe,
      source: input.source,
      stage: input.stage,
      consent_status: input.consentStatus,
      occurred_at: input.occurredAt,
      created_by: input.createdBy,
    }).select("*").single();
    return toIntentSignal(unwrap(result, "Intent signal"));
  }
}
