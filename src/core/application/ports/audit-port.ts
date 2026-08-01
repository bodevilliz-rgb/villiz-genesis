export interface AuditEvent {
  id: string;
  organisationId: string;
  draftId: string | null;
  actorId: string | null;
  eventType: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor?: { id: string; fullName: string | null; email: string } | null;
}

export interface AuditRepository {
  recordEvent(input: {
    organisationId: string;
    draftId: string | null;
    actorId: string | null;
    eventType: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEvent>;

  listEventsForDraft(organisationId: string, draftId: string): Promise<AuditEvent[]>;
}
