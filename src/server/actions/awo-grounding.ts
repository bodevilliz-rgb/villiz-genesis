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
  "guarantees, qualifications, availability, locations, outcomes or offers.",
  "",
  "=== BOOKING & CTA ===",
  'Do not mention any specific booking or contact method — including "DM us", "link in bio",',
  '"WhatsApp us", "call us", "email us" or "visit our website" — unless that exact channel is',
  "explicitly stated in the MemBrain context above.",
  "If no booking method appears in the context, use a non-channel-specific CTA such as:",
  '"Book your appointment" or "Get in touch to learn more."',
  "",
  "=== CREATIVE LATITUDE ===",
  "Hooks, transitions, emotional language, sentence structure, clarity and flow may be freely improved,",
  "provided no new factual business claim is introduced in doing so.",
].join("\n");

/**
 * Builds the grounded system prompt for generateCaption.
 * Includes all six MemBrain categories so the model sees the full factual
 * boundary — previous prompts included only two.
 */
export function buildCaptionSystemPrompt(
  orgName: string,
  platform: string,
  ctx: AwoMembrainContext,
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

  return [
    `You are AWO, the AI Work Optimiser for ${orgName}.`,
    `You write high-quality social media content for ${platform}.`,
    "",
    membrainBlock,
    "",
    GROUNDING_RULES,
    "",
    "Respond ONLY with the generated caption.",
  ].join("\n");
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
