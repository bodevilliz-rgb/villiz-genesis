import "server-only";
import type {
  AutomationEvent,
  AutomationRepository,
  AutomationStatusSnapshot,
} from "@/core/application/ports/automation-port";
import type { Json } from "@/infrastructure/supabase/database.types";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";

type ClaimedEventRow = {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  organisation_id: string | null;
  payload: Json;
  occurred_at: string;
  lease_token: string;
};

export class SupabaseAutomationRepository implements AutomationRepository {
  private readonly client = createAdminClient();

  async status(): Promise<AutomationStatusSnapshot> {
    const { data, error } = await this.client.rpc("automation_status_snapshot");
    if (error) throw new Error(`Automation status failed: ${error.message}`);
    return data as unknown as AutomationStatusSnapshot;
  }

  async claim(input: { consumer: string; limit: number; leaseSeconds: number }): Promise<AutomationEvent[]> {
    const { data, error } = await this.client.rpc("claim_automation_events", {
      p_consumer: input.consumer,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
    });
    if (error) throw new Error(`Automation event claim failed: ${error.message}`);

    return ((data ?? []) as ClaimedEventRow[]).map((row) => ({
      id: row.event_id,
      type: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      organisationId: row.organisation_id,
      payload: row.payload as Record<string, unknown>,
      occurredAt: row.occurred_at,
      leaseToken: row.lease_token,
    }));
  }

  async acknowledge(input: { eventId: string; consumer: string; leaseToken: string }): Promise<boolean> {
    const { data, error } = await this.client.rpc("ack_automation_event", {
      p_event_id: input.eventId,
      p_consumer: input.consumer,
      p_lease_token: input.leaseToken,
    });
    if (error) throw new Error(`Automation event acknowledgement failed: ${error.message}`);
    return data === true;
  }
}
