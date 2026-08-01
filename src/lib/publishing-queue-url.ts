import { routes } from "@/lib/routes";

export interface PublishingQueueSearch {
  tab?: string;
  platform?: string;
  triggerType?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Builds a queue URL preserving every current filter except the ones being overridden — so switching tabs or platforms never silently drops a search or date range. Overriding a key with `undefined` clears it. */
export function buildQueueUrl(
  orgId: string,
  current: PublishingQueueSearch,
  overrides: Partial<PublishingQueueSearch>,
): string {
  const merged: PublishingQueueSearch = { ...current, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${routes.organisations.publishing.index(orgId)}?${query}` : routes.organisations.publishing.index(orgId);
}
