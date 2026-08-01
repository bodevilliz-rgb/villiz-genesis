import "server-only";
import type { AuditRepository, AuditEvent } from "@/core/application/ports/audit-port";
import type { GenesisClient } from "../supabase/server-client";
import { translateError } from "./errors";

const AUDIT_EVENT_SELECT = `
  *,
  actor_profile:profiles!audit_events_actor_id_fkey(id, full_name, email)
`;

type ProfileRef = { id: string; full_name: string | null; email: string } | null;

type AuditEventRow = {
  id: string;
  organisation_id: string;
  draft_id: string | null;
  actor_id: string | null;
  event_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_profile: ProfileRef;
};

function toProfileRef(ref: ProfileRef) {
  return ref ? { id: ref.id, fullName: ref.full_name, email: ref.email } : null;
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    draftId: row.draft_id,
    actorId: row.actor_id,
    eventType: row.event_type,
    description: row.description,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    actor: toProfileRef(row.actor_profile),
  };
}

export class SupabaseAuditRepository implements AuditRepository {
  constructor(private readonly client: GenesisClient) {}

  async recordEvent(input: {
    organisationId: string;
    draftId: string | null;
    actorId: string | null;
    eventType: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEvent> {
    const result = await this.client
      .from("audit_events")
      .insert({
        organisation_id: input.organisationId,
        draft_id: input.draftId,
        actor_id: input.actorId,
        event_type: input.eventType,
        description: input.description,
        metadata: input.metadata || {},
      })
      .select(AUDIT_EVENT_SELECT)
      .single();

    if (result.error) translateError(result.error, "Audit Event creation");
    return toAuditEvent(result.data as unknown as AuditEventRow);
  }

  async listEventsForDraft(organisationId: string, draftId: string): Promise<AuditEvent[]> {
    const result = await this.client
      .from("audit_events")
      .select(AUDIT_EVENT_SELECT)
      .eq("organisation_id", organisationId)
      .eq("draft_id", draftId)
      .order("created_at", { ascending: true });

    if (result.error) translateError(result.error, "Audit Event listing");
    return (result.data ?? []).map((row) => toAuditEvent(row as unknown as AuditEventRow));
  }
}
