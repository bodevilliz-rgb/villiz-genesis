export const INTENT_SOURCES = ["phone", "direct_message", "website", "booking", "social", "referral", "other"] as const;
export const INTENT_STAGES = ["enquiry", "quote_requested", "booking_started", "booked", "lost"] as const;
export const INTENT_CONSENT_STATUSES = ["not_recorded", "not_required", "consented", "objected"] as const;

export type IntentSource = (typeof INTENT_SOURCES)[number];
export type IntentStage = (typeof INTENT_STAGES)[number];
export type IntentConsentStatus = (typeof INTENT_CONSENT_STATUSES)[number];

export interface IntentSignal {
  id: string;
  organisationId: string;
  serviceKey: string;
  serviceLabel: string;
  locality: string | null;
  desiredTimeframe: string | null;
  source: IntentSource;
  stage: IntentStage;
  consentStatus: IntentConsentStatus;
  occurredAt: string;
  createdBy: string | null;
  createdAt: string;
}

export interface IntentOpportunity {
  key: string;
  serviceKey: string;
  serviceLabel: string;
  locality: string | null;
  signalCount: number;
  intentOpportunityScore: number;
  priority: "observe" | "recommend" | "priority";
  latestSignalAt: string;
  sources: IntentSource[];
  stages: IntentStage[];
  evidenceSignalIds: string[];
  rationale: string[];
}

const STAGE_WEIGHT: Record<IntentStage, number> = {
  enquiry: 5,
  quote_requested: 9,
  booking_started: 12,
  booked: 15,
  lost: 0,
};

export function normaliseIntentService(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function buildIntentOpportunities(signals: IntentSignal[], now = new Date()): IntentOpportunity[] {
  const groups = new Map<string, IntentSignal[]>();
  for (const signal of signals) {
    const localityKey = signal.locality?.trim().toLocaleLowerCase("en-GB") || "all-localities";
    const key = signal.serviceKey + "::" + localityKey;
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const latest = [...group].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const latestAgeHours = Math.max(0, (now.getTime() - new Date(latest.occurredAt).getTime()) / 3_600_000);
    const volumeScore = Math.min(40, group.length * 10);
    const recencyScore = latestAgeHours <= 48 ? 20 : latestAgeHours <= 168 ? 12 : 4;
    const stageScore = Math.min(25, Math.max(...group.map((signal) => STAGE_WEIGHT[signal.stage])));
    const localityScore = latest.locality ? 10 : 0;
    const sourceScore = new Set(group.map((signal) => signal.source)).size >= 2 ? 5 : 0;
    const score = Math.min(100, volumeScore + recencyScore + stageScore + localityScore + sourceScore);
    const priority = score >= 85 ? "priority" : score >= 60 ? "recommend" : "observe";
    const rationale = [
      group.length + " demand signal" + (group.length === 1 ? "" : "s") + " recorded",
      latestAgeHours <= 48 ? "Recent intent within 48 hours" : latestAgeHours <= 168 ? "Intent active within seven days" : "Older demand evidence",
      latest.locality ? "Locality evidence: " + latest.locality : "No locality recorded",
      new Set(group.map((signal) => signal.source)).size >= 2 ? "Demand confirmed across multiple sources" : "Single-source evidence",
    ];

    return {
      key,
      serviceKey: latest.serviceKey,
      serviceLabel: latest.serviceLabel,
      locality: latest.locality,
      signalCount: group.length,
      intentOpportunityScore: score,
      priority,
      latestSignalAt: latest.occurredAt,
      sources: [...new Set(group.map((signal) => signal.source))],
      stages: [...new Set(group.map((signal) => signal.stage))],
      evidenceSignalIds: group.map((signal) => signal.id),
      rationale,
    };
  }).sort((a, b) => b.intentOpportunityScore - a.intentOpportunityScore || b.latestSignalAt.localeCompare(a.latestSignalAt));
}
