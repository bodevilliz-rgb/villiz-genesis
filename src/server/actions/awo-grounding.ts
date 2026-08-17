/**
 * Pure functions for AWO AI Assist system prompt construction with MemBrain grounding.
 *
 * These functions are deliberately free of I/O, model calls, and side effects
 * so they can be tested and tuned without infrastructure.
 *
 * Grounding hierarchy applied to every generated output:
 *   1. Factual claims must be directly supported by MemBrain context.
 *   2. Faithful paraphrasing is allowed, provided it does not introduce,
 *      strengthen, quantify or materially alter the underlying fact.
 *   3. Booking/CTA channel references are prohibited unless explicitly stated
 *      in MemBrain context.
 *   4. If a detail is absent, omit it entirely — never substitute industry
 *      knowledge, plausible assumptions, or invented specifics.
 */

import type { MembrainOverview } from "@/core/application/use-cases/membrain";

/**
 * Authoritative MemBrain category keys. Matches BRAND_CATEGORY_KEYS in
 * context.ts — key-based, not label-based, so administrator renames do not
 * break context extraction.
 */
const CATEGORY_KEYS = {
  brandDescription: "brand_description",
  brandVoice: "brand_voice",
  targetAudience: "audience",
  contentPillars: "content_pillars",
  productsAndServices: "offering",
  restrictions: "guidelines",
} as const;

/**
 * All six standard MemBrain categories extracted as string arrays.
 * Only active entries are included — draft and archived entries are not
 * trusted knowledge for generation (matches the rule in readiness.ts).
 */
export interface AwoMembrainContext {
  brandVoice: string[];
  targetAudience: string[];
  brandDescription: string[];
  productsAndServices: string[];
  contentPillars: string[];
  restrictions: string[];
}

/**
 * The four canonical generation intents.  Every caption request resolves to
 * exactly one of these — the intent determines which instruction block the
 * model receives alongside the MemBrain context.
 *
 * A. brand_general  — whole-brand message; must not arbitrarily centre one service.
 * B. service_specific — operator explicitly named or requested a specific offering.
 * C. campaign       — post serves a linked campaign or promotional occasion.
 * D. educational    — topic/question is primary; expertise without hard sell.
 */
export type ContentIntent = "brand_general" | "service_specific" | "campaign" | "educational";

export type ServiceTreatment = "brand_overview" | "specific_service" | "no_service_mention";
export type PromotionLevel = "none" | "soft" | "promotional";
export type CtaMode = "auto" | "soft_enquiry" | "book" | "custom" | "none";

/**
 * Operator-supplied generation brief for a single post.
 * All fields are optional — omitting the entire structure falls back to
 * existing prompt-only generation with no regression.
 */
export interface GenerationGuidedContext {
  /** Existing active MemBrain content-pillar entry selected by the operator. */
  contentPillar?: string;
  topic?: string;
  goal?: string;
  serviceTreatment?: ServiceTreatment;
  /** Only used when serviceTreatment === "specific_service". Free text — no parser. */
  specificService?: string;
  promotionLevel?: PromotionLevel;
  ctaMode?: CtaMode;
  /** Only used when ctaMode === "custom". */
  customCta?: string;
  extraDirection?: string;
}

/**
 * Structured signals passed from the call-site (client) to the server action
 * so that intent classification can use structured draft/campaign data in
 * addition to semantic analysis of the prompt text.
 *
 * These are deliberately optional so the action degrades gracefully when the
 * caller cannot supply them (e.g. a programmatic API call).
 */
export interface GenerationIntentHints {
  /** True when the draft is linked to an active campaign. */
  hasCampaign?: boolean;
  /** The content pillar label assigned to this draft, if any. */
  contentPillar?: string | null;
  /** True when the operator typed an explicit prompt (vs just using the draft title). */
  userPromptIsExplicit?: boolean;
}

function activeBodiesForKey(membrain: MembrainOverview, key: string): string[] {
  const group = membrain.groups.find((g) => g.category.key === key);
  if (!group) return [];
  return group.entries
    .filter((e) => e.status === "active")
    .map((e) => e.body)
    .filter(Boolean);
}

/**
 * Extracts all six MemBrain categories from the overview, active entries only.
 * Uses key-based lookup (authoritative) — the previous label-based lookup in
 * awo.ts was brittle and missed four of the six categories entirely.
 */
export function extractAwoMembrainContext(membrain: MembrainOverview): AwoMembrainContext {
  return {
    brandVoice: activeBodiesForKey(membrain, CATEGORY_KEYS.brandVoice),
    targetAudience: activeBodiesForKey(membrain, CATEGORY_KEYS.targetAudience),
    brandDescription: activeBodiesForKey(membrain, CATEGORY_KEYS.brandDescription),
    productsAndServices: activeBodiesForKey(membrain, CATEGORY_KEYS.productsAndServices),
    contentPillars: activeBodiesForKey(membrain, CATEGORY_KEYS.contentPillars),
    restrictions: activeBodiesForKey(membrain, CATEGORY_KEYS.restrictions),
  };
}

/**
 * Extracts lowercased discriminating terms (4+ chars, single words and
 * adjacent 2-word pairs) from the first 120 characters of each offering
 * description.  The service name is typically at the start of each entry,
 * so truncating before extracting avoids matching common filler words that
 * appear later in longer descriptions.
 *
 * Generic — reads from actual MemBrain data, no client-specific hardcoding.
 */
function buildServiceTermSet(offerings: string[]): string[] {
  const terms = new Set<string>();
  for (const offering of offerings) {
    const cleaned = offering
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .trim()
      .slice(0, 120);
    const words = cleaned.split(/\s+/).filter((w) => w.length >= 4);
    words.forEach((w) => terms.add(w));
    for (let i = 0; i < words.length - 1; i++) {
      terms.add(`${words[i]!} ${words[i + 1]!}`);
    }
  }
  return Array.from(terms);
}

/**
 * Classifies the operator's request into one of four content intents.
 *
 * Precedence:
 *  1. Structural signals (campaign linked) — most authoritative, no false negatives.
 *  2. Universal educational patterns — topic-led language ("how to", "tips for", …).
 *  3. Explicit service reference — user's prompt contains a term from the
 *     actual MemBrain offerings (generic, no hardcoding).
 *  4. Promotional language heuristic — campaign-flavoured phrasing without a linked campaign.
 *  5. Default: brand_general — the safest fallback for ambiguous prompts.
 *
 * The default (brand_general) applies the strictest service-weighting rules,
 * preventing arbitrary single-service dominance on general posts like
 * "Welcome to August" or "Happy New Month".
 */
export function classifyContentIntent(
  prompt: string,
  ctx: AwoMembrainContext,
  hints: GenerationIntentHints = {},
): ContentIntent {
  // 1. Structural: campaign linked → campaign intent
  if (hints.hasCampaign) return "campaign";

  const lower = prompt.toLowerCase();

  // 2. Educational: universal how-to / topic-led patterns
  if (
    /\bhow (to|do|can|should|you)\b|\btips?\b|\bsteps?\b|\bguide\b|\btutorial\b/.test(lower) ||
    /\bwhat (is|are|to)\b|\badvice\b|\blearn\b|\bcare (for|of)\b/.test(lower)
  ) {
    return "educational";
  }

  // 3. Service-specific: explicit prompt references a known offering term.
  //    Only applies when the operator typed something explicit (not just a title).
  //    Uses MemBrain offering data generically — no client-specific terms hardcoded.
  if (hints.userPromptIsExplicit && ctx.productsAndServices.length > 0) {
    const serviceTerms = buildServiceTermSet(ctx.productsAndServices);
    if (serviceTerms.some((term) => lower.includes(term))) {
      return "service_specific";
    }
  }

  // 4. Campaign-flavoured phrasing (no linked campaign, but promotional language)
  if (/\bcampaign\b|\bpromo\b|\boffer\b|\bdiscount\b|\bsale\b|\blaunch\b/.test(lower)) {
    return "campaign";
  }

  // 5. Default: brand/general — safest fallback
  return "brand_general";
}

const SERVICE_TREATMENT_INSTRUCTIONS: Record<ServiceTreatment, string> = {
  brand_overview:
    "Brand overview — services may be referenced naturally when relevant; no single service should dominate",
  specific_service: "Specific service focus",
  no_service_mention:
    "No service mention — keep content service-neutral unless the operator explicitly requires otherwise",
};

const PROMOTION_INSTRUCTIONS: Record<PromotionLevel, string> = {
  none: "None — no commercial promotion",
  soft: "Soft — brand or service awareness may appear naturally without overpowering the main subject",
  promotional:
    "Promotional — a clear commercial objective is appropriate, while respecting MemBrain rules and factual grounding",
};

const CTA_INSTRUCTIONS: Record<CtaMode, string> = {
  auto: "Auto — include only if appropriate to the content intent and grounded booking information in MemBrain",
  soft_enquiry: "Soft enquiry — a natural invitation to enquire or make contact",
  book: "Booking — clear booking invitation; use only grounded booking information from MemBrain; if none is in context, use a generic non-channel-specific invitation",
  custom: "Custom",
  none: "None — do not include a call to action",
};

/**
 * Converts a GenerationGuidedContext into a clearly delimited system-prompt
 * block.  Returns null when the context is entirely empty so callers can skip
 * injection cleanly.
 *
 * This is the single authoritative builder — no ad-hoc string concatenation
 * in components.
 */
export function buildGuidedContextBlock(ctx: GenerationGuidedContext): string | null {
  const lines: string[] = [];

  if (ctx.contentPillar) lines.push(`Selected MemBrain content pillar: ${ctx.contentPillar}`);
  if (ctx.topic) lines.push(`Topic: ${ctx.topic}`);
  if (ctx.goal) lines.push(`Goal: ${ctx.goal}`);

  if (ctx.serviceTreatment) {
    lines.push(`Service treatment: ${SERVICE_TREATMENT_INSTRUCTIONS[ctx.serviceTreatment]}`);
    if (ctx.serviceTreatment === "specific_service" && ctx.specificService) {
      lines.push(`Specific service: ${ctx.specificService}`);
    }
  }

  if (ctx.promotionLevel) {
    lines.push(`Promotion level: ${PROMOTION_INSTRUCTIONS[ctx.promotionLevel]}`);
  }

  if (ctx.ctaMode) {
    const ctaLabel =
      ctx.ctaMode === "custom" && ctx.customCta
        ? `Custom — ${ctx.customCta}`
        : CTA_INSTRUCTIONS[ctx.ctaMode];
    lines.push(`CTA: ${ctaLabel}`);
  }

  if (ctx.extraDirection) lines.push(`Extra direction: ${ctx.extraDirection}`);

  if (lines.length === 0) return null;

  return [
    "=== GUIDED CONTEXT ===",
    ...lines,
    "",
    "Rules for Guided Context:",
    "- The operator's explicit subject and this guided context define the desired treatment.",
    "- Guided Context must never authorise invention of facts not present in MemBrain.",
    "- Rules & Compliance from MemBrain remain authoritative over all other guidance.",
  ].join("\n");
}

function renderSection(label: string, entries: string[]): string {
  const body = entries.length > 0 ? entries.join("\n") : "(none recorded)";
  return `[${label}]\n${body}`;
}

const GROUNDING_RULES = [
  "=== FACTUAL GROUNDING — highest priority ===",
  "Every factual business claim must be directly supported by the MemBrain context above.",
  "Faithful paraphrasing is allowed, provided it does not introduce, strengthen, quantify or materially alter the underlying fact.",
  "If a detail is absent from the MemBrain context, omit it entirely.",
  "Never substitute general industry knowledge, plausible assumptions or best practices for missing facts.",
  "Never invent: service processes, techniques, prices, durations, booking channels, contact methods,",
  "guarantees, qualifications, availability, locations, outcomes, offers,",
  "or contextual occasions, events, deadlines or assumed client needs.",
  "",
  "=== BOOKING & CTA ===",
  'Do not mention any specific booking or contact method — including "DM us", "link in bio",',
  '"WhatsApp us", "call us", "email us" or "visit our website" — unless that exact channel is',
  "explicitly stated in the MemBrain context above.",
  "A call to action is only appropriate when this content type warrants it.",
  "For greetings, appreciation, community and similar brand-level posts, a commercial CTA is not required.",
  "If a CTA is appropriate and no booking method appears in the context, use a non-channel-specific CTA",
  'such as "Book your appointment" or "Get in touch to learn more."',
  "",
  "=== CREATIVE LATITUDE ===",
  "Hooks, transitions, emotional language, sentence structure, clarity and flow may be freely improved,",
  "provided no new factual business claim is introduced in doing so.",
].join("\n");

/**
 * Per-intent instruction blocks injected between the MemBrain context and the
 * grounding rules.  These instructions tell the model HOW to weight the context
 * for this specific request — a critical gap in the previous prompt that caused
 * multi-service brand posts to collapse onto whichever service happened to
 * appear first in the MemBrain retrieval order.
 */
const INTENT_INSTRUCTIONS: Record<ContentIntent, string> = {
  brand_general: [
    "=== CONTENT INTENT: Brand / General ===",
    "This post should represent the brand at its appropriate level.",
    "Rules for this intent:",
    "- The operator's explicit request is the primary subject of this post. Fulfil that specific",
    "  request using the brand's voice. Do not replace the stated theme with a commercial objective,",
    "  invented occasion, or unrelated brand content.",
    "- Do not select one product or service as the central subject of this post",
    "  unless the operator has explicitly requested it or a campaign or content pillar requires it.",
    "- You may reference multiple offerings only when it flows naturally.",
    "  Do not mechanically list every service.",
    "- Never infer a 'primary service' from the order services appear in this context.",
    "  Retrieval order does not imply importance.",
    "- Apply the brand voice to the whole brand, not to any single offering.",
  ].join("\n"),

  service_specific: [
    "=== CONTENT INTENT: Service-focused ===",
    "The operator has requested a post focused on a specific offering.",
    "- Focus on the most relevant product or service from the Products & Services section above.",
    "- Use service detail from MemBrain context; do not invent additional claims about it.",
  ].join("\n"),

  campaign: [
    "=== CONTENT INTENT: Campaign / Promotional ===",
    "This post serves a campaign or promotional occasion.",
    "- The campaign context or occasion is the primary frame.",
    "- Include services only where they naturally support the campaign objective.",
    "- Do not foreground a service that is not relevant to the campaign.",
  ].join("\n"),

  educational: [
    "=== CONTENT INTENT: Educational / Value content ===",
    "This post is topic-led, not sales-led.",
    "- The topic or question in the operator prompt is the primary subject.",
    "- Use relevant expertise from MemBrain; do not turn every point into a sales statement.",
    "- A soft reference to a relevant offering is acceptable; a hard sell is not.",
  ].join("\n"),
};

function buildOperatorRequestBlock(prompt: string): string {
  return [
    "=== OPERATOR REQUEST ===",
    `The operator's request: "${prompt}"`,
    "",
    "This is the primary semantic anchor of this post. Fulfil this specific request using the",
    "brand's voice, context, and factual boundaries above. Do not substitute a different subject,",
    "theme, occasion, or commercial objective. MemBrain defines HOW this organisation communicates —",
    "it does not replace WHAT the operator asked for.",
  ].join("\n");
}

/**
 * Builds the grounded system prompt for generateCaption.
 * Includes all six MemBrain categories so the model sees the full factual
 * boundary — previous prompts included only two.
 *
 * The `intent` parameter selects the instruction block that governs how the
 * model weights the brand context for this specific request.  Defaults to
 * `brand_general` — the strictest, safest option — so all callers that do not
 * supply an intent get the no-single-service-dominance rule automatically.
 *
 * The optional `operatorPrompt` injects an explicit subject-anchor block so the
 * model cannot replace the operator's stated theme with invented context.
 */
export function buildCaptionSystemPrompt(
  orgName: string,
  platform: string,
  ctx: AwoMembrainContext,
  intent: ContentIntent = "brand_general",
  operatorPrompt?: string,
  guidedContext?: GenerationGuidedContext,
): string {
  const membrainBlock = [
    "=== MEMBRAIN CONTEXT ===",
    renderSection("Brand Description", ctx.brandDescription),
    "",
    renderSection("Target Audience", ctx.targetAudience),
    "",
    renderSection("Brand Voice & Positioning", ctx.brandVoice),
    "",
    renderSection("Products & Services", ctx.productsAndServices),
    "",
    renderSection("Content Pillars", ctx.contentPillars),
    "",
    renderSection("Rules & Compliance", ctx.restrictions),
  ].join("\n");

  const parts: string[] = [
    `You are AWO, the AI Work Optimiser for ${orgName}.`,
    `You write high-quality social media content for ${platform}.`,
    "",
    membrainBlock,
    "",
  ];

  if (operatorPrompt) {
    parts.push(buildOperatorRequestBlock(operatorPrompt), "");
  }

  const guidedBlock = guidedContext ? buildGuidedContextBlock(guidedContext) : null;
  if (guidedBlock) {
    parts.push(guidedBlock, "");
  }

  parts.push(
    INTENT_INSTRUCTIONS[intent],
    "",
    GROUNDING_RULES,
    "",
    "Respond ONLY with the generated caption.",
  );

  return parts.join("\n");
}

/**
 * Builds the grounded system prompt for rewriteContent.
 * Includes brand voice and restrictions so rewrites respect both
 * tone and compliance — previous prompts included only brand voice.
 */
export function buildRewriteSystemPrompt(
  orgName: string,
  modifier: string,
  ctx: AwoMembrainContext,
): string {
  const membrainBlock = [
    "=== MEMBRAIN CONTEXT ===",
    renderSection("Brand Voice & Positioning", ctx.brandVoice),
    "",
    renderSection("Rules & Compliance", ctx.restrictions),
  ].join("\n");

  return [
    `You are AWO, the AI Work Optimiser for ${orgName}.`,
    "Your task is to edit content.",
    `Instruction: ${modifier}`,
    "",
    membrainBlock,
    "",
    "=== FACTUAL GROUNDING ===",
    "Every factual business claim must be directly supported by the MemBrain context above.",
    "Do not add, remove or alter specific factual claims during rewriting — only improve language and structure.",
    "Never substitute general industry knowledge or invent details not present in the original content.",
    "",
    "Respond ONLY with the rewritten content. Do not include any explanations.",
  ].join("\n");
}
