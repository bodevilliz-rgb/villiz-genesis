export interface CalendarEventPayload {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  platform?: string;
}

export interface CalendarSyncResult {
  success: boolean;
  externalEventId?: string;
  errorMessage?: string;
}

/**
 * Transport-only provider interface for external calendar syncing.
 */
export interface ExternalCalendarProvider {
  providerName: "google" | "outlook" | "apple";
  syncEvent(event: CalendarEventPayload): Promise<CalendarSyncResult>;
  removeEvent(externalEventId: string): Promise<boolean>;
}
