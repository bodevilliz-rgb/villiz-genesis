export const ACOR_LIFECYCLE = ["DISCOVERY", "FORENSIC_REVIEW", "STRATEGY_REQUIRED", "GROUNDING", "GROWTH_READY", "ACTIVE_LEARNING"] as const;
export type AcorLifecycle = (typeof ACOR_LIFECYCLE)[number];
export const PROOF_DEPTHS = ["STRONGLY_PROVEN", "ADEQUATELY_PROVEN", "UNDER_PROVEN", "CONFIRMED_UNPROVEN", "NOT_MARKET_READY"] as const;
export type ProofDepth = (typeof PROOF_DEPTHS)[number];
export type EvidenceVerification = "VERIFY" | "PENDING" | "VERIFIED";
export type EvidenceApproval = "PROPOSED" | "APPROVED" | "REJECTED";
export type PublicUseStatus = "CLEARED" | "RESTRICTED" | "PENDING" | "NOT_APPLICABLE";

export interface AcorEvidence {
  id: string;
  organisationId: string;
  evidenceType: string;
  serviceCategory: string;
  provenance: string;
  ownerSupplied: boolean;
  publicUseStatus: PublicUseStatus;
  market: string;
  proves: string;
  restrictions: string[];
  verification: EvidenceVerification;
  approval: EvidenceApproval;
}

/** Only explicitly verified and human-approved evidence may become authoritative knowledge. */
export function canGroundMembrain(evidence: AcorEvidence): boolean {
  return evidence.approval === "APPROVED" && evidence.verification === "VERIFIED" && evidence.proves.trim().length > 0;
}

export const GROWTH_READINESS_GATES = ["brand_truth", "membrain", "market_intelligence", "conversion_path", "priority_offer_proof", "baseline", "platform_connections", "measurement"] as const;
export type GrowthReadinessGateKey = (typeof GROWTH_READINESS_GATES)[number];
export interface GrowthReadinessGate { key: GrowthReadinessGateKey; label: string; met: boolean; evidence: string; }
export interface GrowthReadiness { lifecycle: "GROUNDING" | "GROWTH_READY"; metCount: number; total: number; gates: GrowthReadinessGate[]; missing: GrowthReadinessGate[]; }

const GATE_LABELS: Record<GrowthReadinessGateKey, string> = {
  brand_truth: "Brand truth ready", membrain: "MemBrain ready", market_intelligence: "Market Intelligence ready", conversion_path: "Conversion path ready", priority_offer_proof: "Proof sufficient for priority offer", baseline: "Baseline captured", platform_connections: "Platform connections ready", measurement: "Measurement ready",
};

export function computeGrowthReadiness(values: Record<GrowthReadinessGateKey, { met: boolean; evidence: string }>): GrowthReadiness {
  const gates = GROWTH_READINESS_GATES.map((key) => ({ key, label: GATE_LABELS[key], ...values[key] }));
  const missing = gates.filter((gate) => !gate.met);
  return { lifecycle: missing.length === 0 ? "GROWTH_READY" : "GROUNDING", metCount: gates.length - missing.length, total: gates.length, gates, missing };
}

export function deriveGrowthReadinessFromGenesis(input: { brandDescriptionReady: boolean; brandVoiceReady: boolean; membrainReady: boolean; marketIntelligenceReady: boolean; conversionActions: string[]; approvedPriorityProof: boolean; baselineCaptured: boolean; connectedPlatformCount: number; measurementConfigured: boolean; }): GrowthReadiness {
  return computeGrowthReadiness({
    brand_truth: { met: input.brandDescriptionReady && input.brandVoiceReady, evidence: input.brandDescriptionReady && input.brandVoiceReady ? "Approved brand description and voice are active." : "Approved brand description or voice is missing." },
    membrain: { met: input.membrainReady, evidence: input.membrainReady ? "All six authoritative knowledge areas are ready." : "One or more authoritative knowledge areas are incomplete." },
    market_intelligence: { met: input.marketIntelligenceReady, evidence: input.marketIntelligenceReady ? "The deterministic Market Intelligence profile is complete." : "The Market Intelligence profile is incomplete." },
    conversion_path: { met: input.conversionActions.length > 0, evidence: input.conversionActions.length > 0 ? `Configured: ${input.conversionActions.join(", ")}.` : "No legitimate conversion action is configured." },
    priority_offer_proof: { met: input.approvedPriorityProof, evidence: input.approvedPriorityProof ? "Human-reviewed priority-offer proof is recorded." : "Priority-offer proof is missing or pending approval." },
    baseline: { met: input.baselineCaptured, evidence: input.baselineCaptured ? "An honest Day-0 reference is recorded." : "Day-0 baseline is not recorded." },
    platform_connections: { met: input.connectedPlatformCount > 0, evidence: input.connectedPlatformCount > 0 ? `${input.connectedPlatformCount} authorised destination account(s) connected.` : "No authorised destination account is connected." },
    measurement: { met: input.measurementConfigured, evidence: input.measurementConfigured ? "Measurement is configured." : "Measurement remains not configured or not measured." },
  });
}

export type BaselineState = "ACTUAL" | "ZERO" | "NOT_CONFIGURED" | "NOT_MEASURED" | "OWNER_ANALYTICS_REQUIRED";
export interface AcorBaselineMetric { key: string; label: string; state: BaselineState; value: string | number | null; source: string; }

export function validateBaseline(metrics: AcorBaselineMetric[]): AcorBaselineMetric[] {
  return metrics.map((metric) => {
    if ((metric.state === "ACTUAL" || metric.state === "ZERO") && metric.value === null) throw new Error(`${metric.key} requires an explicit value`);
    if (metric.state === "ZERO" && metric.value !== 0) throw new Error(`${metric.key} ZERO must equal 0`);
    if (metric.state !== "ACTUAL" && metric.state !== "ZERO" && metric.value !== null) throw new Error(`${metric.key} cannot carry an unmeasured value`);
    return { ...metric };
  });
}

export interface AcorImpactCheckpoint {
  day: 30 | 60 | 90;
  visibility: Record<string, number | null>;
  engagement: Record<string, number | null>;
  intent: Record<string, number | null>;
  commercialOutcomes: Record<string, number | null>;
}

export function emptyImpactCheckpoint(day: 30 | 60 | 90): AcorImpactCheckpoint {
  return { day, visibility: { reach: null, views: null }, engagement: { comments: null, shares: null, saves: null }, intent: { clicks: null, profileVisits: null }, commercialOutcomes: { enquiries: null, bookings: null, purchases: null, revenue: null } };
}

export interface AcorBlueprint {
  brandTruth: string[]; commercialNorthStar: string; primaryAudiences: string[]; marketBattlefield: string[]; competitivePosition: string[]; discoveryOpportunities: string[]; searchStrategy: string[]; contentStrategy: string[]; visibilityStrategy: string[]; conversionStrategy: string[]; thirtyDayAttackPlan: string[]; measurementFramework: string[];
}
