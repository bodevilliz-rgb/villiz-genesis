import type { ContentDraftType } from "@/core/domain/entities/content";
import type {
  CampaignContext,
  DraftAnalyserInput,
  DraftAnalysis,
  DraftAnalysisCheck,
  DraftAnalysisCheckKey,
} from "@/core/domain/entities/generation";

/**
 * Phase 4 — Draft Analyser. Diagnostic only: it never rewrites or generates
 * a single word of the draft, only reports on what's there. Every check is a
 * plain, explainable rule over data already on the draft/campaign — no NLP,
 * no scoring model, nothing that requires a provider.
 */
const MIN_SUBSTANTIAL_BODY_LENGTH = 140;
const MIN_TITLE_LENGTH = 10;
const PLACEHOLDER_MARKERS = ["todo", "tbd", "[insert", "lorem ipsum", "xxx", "placeholder"];
const GENERIC_CTA_KEYWORDS = [
  "book",
  "sign up",
  "learn more",
  "buy",
  "shop",
  "call",
  "visit",
  "click",
  "register",
  "subscribe",
  "contact",
  "order",
  "download",
];

/** Content types with no inherent platform requirement — alignment is trivially satisfied. */
const PLATFORM_AGNOSTIC_TYPES: ContentDraftType[] = ["email"];

function checkLength(body: string): boolean {
  return body.trim().length >= MIN_SUBSTANTIAL_BODY_LENGTH;
}

function checkTitle(title: string): boolean {
  return title.trim().length >= MIN_TITLE_LENGTH;
}

function checkStructure(body: string): boolean {
  const lower = body.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

function checkCallToAction(body: string, campaign: CampaignContext | null): boolean {
  const lower = body.toLowerCase();
  if (campaign?.primaryCTA) return lower.includes(campaign.primaryCTA.toLowerCase());
  return GENERIC_CTA_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function checkCampaignAlignment(contentType: ContentDraftType, campaign: CampaignContext | null): boolean {
  if (PLATFORM_AGNOSTIC_TYPES.includes(contentType)) return true;
  return campaign !== null && campaign.platforms.length > 0;
}

const LABELS: Record<DraftAnalysisCheckKey, string> = {
  length: "Substantial body length",
  title: "Descriptive title",
  structure: "No unfinished placeholders",
  callToAction: "Has a call to action",
  campaignAlignment: "Aligned with campaign platforms",
  brandAlignment: "Linked to a content pillar",
  completeness: "Title, body and pillar all present",
};

const WARNINGS: Record<DraftAnalysisCheckKey, string> = {
  length: "The draft is still quite short.",
  title: "The title is too short to be descriptive.",
  structure: "The body still contains an unfinished placeholder.",
  callToAction: "No clear call to action was found in the body.",
  campaignAlignment: "This content type has no platform selected on its campaign.",
  brandAlignment: "This draft has no content pillar assigned.",
  completeness: "This draft is missing one or more basics (title, body length, or content pillar).",
};

const SUGGESTIONS: Record<DraftAnalysisCheckKey, string> = {
  length: "Keep writing, or send a brief to Awo to bring in more from MemBrain.",
  title: "Give the draft a more descriptive title.",
  structure: "Replace the placeholder text with real content before this is ready.",
  callToAction: "Add a clear next step for the reader — book, buy, visit, sign up, and so on.",
  campaignAlignment: "Select at least one platform on the linked campaign.",
  brandAlignment: "Pick a content pillar so this draft is easy to find and measure later.",
  completeness: "Fill in the title, write more of the body, and set a content pillar.",
};

/** completeness and campaignAlignment are checked directly; the rest are derived per-input and re-used for both the check list and the summary flags. */
export function analyseDraft(input: DraftAnalyserInput): DraftAnalysis {
  const lengthOk = checkLength(input.body);
  const titleOk = checkTitle(input.title);
  const structureOk = checkStructure(input.body);
  const ctaOk = checkCallToAction(input.body, input.campaign);
  const campaignAlignmentApplicable = input.campaign !== null;
  const campaignAlignmentOk = checkCampaignAlignment(input.contentType, input.campaign);
  const brandAlignmentOk = input.hasCategory;
  const completenessOk = lengthOk && titleOk && brandAlignmentOk;

  const raw: Array<{ key: DraftAnalysisCheckKey; passed: boolean; applicable: boolean }> = [
    { key: "length", passed: lengthOk, applicable: true },
    { key: "title", passed: titleOk, applicable: true },
    { key: "structure", passed: structureOk, applicable: true },
    { key: "callToAction", passed: ctaOk, applicable: true },
    { key: "campaignAlignment", passed: campaignAlignmentOk, applicable: campaignAlignmentApplicable },
    { key: "brandAlignment", passed: brandAlignmentOk, applicable: true },
    { key: "completeness", passed: completenessOk, applicable: true },
  ];

  const checks: DraftAnalysisCheck[] = raw.map(({ key, passed, applicable }) => ({
    key,
    label: LABELS[key],
    passed,
    applicable,
  }));

  const applicableChecks = checks.filter((check) => check.applicable);
  const passedCount = applicableChecks.filter((check) => check.passed).length;
  const failedApplicable = applicableChecks.filter((check) => !check.passed);

  return {
    readinessPercent: applicableChecks.length === 0 ? 100 : Math.round((passedCount / applicableChecks.length) * 100),
    checks,
    warnings: failedApplicable.map((check) => WARNINGS[check.key]),
    suggestions: failedApplicable.map((check) => SUGGESTIONS[check.key]),
  };
}
