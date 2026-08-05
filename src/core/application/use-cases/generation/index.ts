import type { Actor } from "@/core/domain/entities/identity";
import type { GenerationReadiness } from "@/core/domain/entities/generation";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { buildGenerationContext } from "./context";
import { resolveKnowledgeCoverage } from "./knowledge-resolver";
import { resolveCampaignReadiness } from "./campaign-resolver";
import { analyseDraft } from "./draft-analyser";
import { computeOverallConfidence } from "./confidence-engine";
import { composePromptSpecification } from "./prompt-composer";

export type { GenerationContext, GenerationReadiness } from "@/core/domain/entities/generation";
export { buildGenerationContext } from "./context";
export { resolveKnowledgeCoverage } from "./knowledge-resolver";
export { resolveCampaignReadiness } from "./campaign-resolver";
export { analyseDraft } from "./draft-analyser";
export { computeOverallConfidence } from "./confidence-engine";
export { composePromptSpecification } from "./prompt-composer";

interface GenerationDeps {
  actor: Actor;
  organisations: OrganisationRepository;
  campaigns: CampaignRepository;
  content: ContentRepository;
  membrain: MembrainRepository;
}

/**
 * Below this, and only below this, is "Ready for Awo" rather than "Needs
 * Attention" (Phase 9). Documented here as the one place the threshold is
 * decided, not scattered across the UI.
 */
const READY_CONFIDENCE_THRESHOLD = 80;

/**
 * Orchestrates every engine in this sprint into one bundle for the
 * generation-readiness panel: fetches MemBrain once (reused by both the
 * Context Engine and the Knowledge Resolver — see context.ts's own note on
 * why), then runs the Campaign Resolver, Draft Analyser, Confidence Engine
 * and Prompt Composer over the assembled context. Nothing here calls a
 * model or generates anything; it only computes what's already knowable
 * from data Genesis has.
 */
export async function getGenerationReadiness(
  deps: GenerationDeps,
  organisationId: string,
  draftId: string,
): Promise<GenerationReadiness> {
  const membrainOverview = await getMembrainOverview(
    { actor: deps.actor, membrain: deps.membrain, organisations: deps.organisations },
    organisationId,
  );

  const context = await buildGenerationContext(deps, organisationId, draftId, membrainOverview);

  const knowledgeCoverage = resolveKnowledgeCoverage(membrainOverview.readiness);
  const campaignReadiness = resolveCampaignReadiness(context.campaign);
  const draftAnalysis = analyseDraft({
    title: context.draft.title,
    body: context.draft.body,
    contentType: context.draft.contentType,
    hasCategory: context.draft.category !== null,
    campaign: context.campaign,
  });
  const confidence = computeOverallConfidence(knowledgeCoverage, campaignReadiness, draftAnalysis);
  const promptSpecification = composePromptSpecification(context);

  const promptReady = context.brand.brandDescription.length > 0 && context.draft.body.trim().length > 0;

  const blockingReasons: string[] = [
    ...(!promptReady ? ["A brand description and some draft body text are needed before a prompt can be assembled."] : []),
    ...confidence.missingInformation,
  ];

  const status: GenerationReadiness["status"] =
    confidence.score >= READY_CONFIDENCE_THRESHOLD && promptReady ? "ready_for_awo" : "needs_attention";

  return {
    status,
    context,
    knowledgeCoverage,
    campaignReadiness,
    draftAnalysis,
    confidence,
    promptSpecification,
    promptReady,
    blockingReasons: status === "ready_for_awo" ? [] : blockingReasons,
  };
}
export * from "./generate-improved-draft";
