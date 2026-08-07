/**
 * Pure, side-effect-free helpers for the AWO AI Assist panel.
 *
 * Extracted from draft-form.tsx so the context-awareness rules can be
 * tested independently of React rendering or Next.js infrastructure.
 */

export type AiRewriteInstruction = "expand" | "shorten" | "professional" | "casual" | "punchy";

const CONTENT_DEPENDENT_ACTIONS = [
  "rewrite",
  "shorten",
  "expand",
  "change_tone",
  "alternative_captions",
  "clarity",
] as const;

/** True when the draft body is empty or whitespace-only. */
export function isDraftBodyEmpty(body: string): boolean {
  return body.trim() === "";
}

/**
 * Returns the action that should actually run given the current body content.
 *
 * Rules:
 * - Empty body → "generate" (the only valid action)
 * - Non-empty body + "generate" selected → fall back to "rewrite"
 * - Non-empty body + content-dependent action → use that action unchanged
 */
export function resolveEffectiveAiAction(body: string, selectedAction: string): string {
  if (isDraftBodyEmpty(body)) return "generate";
  if (selectedAction === "generate") return "rewrite";
  return selectedAction;
}

/**
 * Returns true when `action` is valid for the current body content.
 *
 * - Empty body: only "generate" is available.
 * - Non-empty body: all content-dependent actions are available; "generate" is not.
 */
export function isAiActionAvailable(body: string, action: string): boolean {
  const empty = isDraftBodyEmpty(body);
  if (empty && (CONTENT_DEPENDENT_ACTIONS as readonly string[]).includes(action)) return false;
  if (!empty && action === "generate") return false;
  return true;
}

/** Maps the AI action key to the rewriteContent instruction value. */
export function rewriteInstructionForAction(action: string): AiRewriteInstruction {
  if (action === "shorten") return "shorten";
  if (action === "expand") return "expand";
  if (action === "change_tone") return "professional";
  if (action === "alternative_captions") return "punchy";
  return "professional";
}

/**
 * Builds the argument tuple for generateCaption().
 *
 * Prompt precedence: explicit user prompt → draft title → generic fallback.
 * Platform should be the draft's scheduled social platform (e.g. "Instagram").
 * Defaults to "social media" when no specific platform has been chosen yet —
 * that matches the system-prompt sentence "You write high-quality social media
 * content for social media." and is semantically correct for an unscheduled draft.
 */
export function buildGenerateCaptionArgs(
  organisationId: string,
  prompt: string,
  draftTitle: string | null | undefined,
  platform: string | null | undefined,
): [string, string, string] {
  return [
    organisationId,
    prompt || draftTitle || "Generate a creative draft",
    platform || "social media",
  ];
}
