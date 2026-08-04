export interface AutomationEvent {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  organisationId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  leaseToken: string;
}

export interface AutomationStatusSnapshot {
  generatedAt: string;
  organisations: { active: number };
  reviews: { needsReview: number; changesRequested: number };
  publishing: { queued: number; processing: number; failed: number; publishedToday: number };
  failedJobs: Array<{
    jobId: string;
    organisationId: string;
    draftId: string;
    platform: string;
    completedAt: string | null;
  }>;
}

export interface AutomationRepository {
  status(): Promise<AutomationStatusSnapshot>;
  claim(input: { consumer: string; limit: number; leaseSeconds: number }): Promise<AutomationEvent[]>;
  acknowledge(input: { eventId: string; consumer: string; leaseToken: string }): Promise<boolean>;
}
