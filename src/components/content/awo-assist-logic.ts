/**
 * Pure, side-effect-free helpers for the AWO AI Assist panel.
 *
 * Extracted from draft-form.tsx so the context-awareness rules can be
 * tested independently of React rendering or Next.js infrastructure.
 */
import type { GenerationIntentHints } from "@/server/actions/awo-grounding";

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
 * Explicit state-machine resolver.
 *
 * STATE A — empty body  → "generate" (the only valid action)
 * STATE B — has content → currentAction (if a transform) or "rewrite" fallback
 *
 * This is the single authoritative resolver. The component derives effectiveAiAction
 * from this function; nothing else reads body state to determine the action.
 */
export function normaliseAiAction(currentAction: string, body: string): string {
  if (isDraftBodyEmpty(body)) return "generate";
  if (currentAction === "generate") return "rewrite";
  return currentAction;
}

/** Backward-compat alias — use normaliseAiAction for new call sites. */
export function resolveEffectiveAiAction(body: string, selectedAction: string): string {
  return normaliseAiAction(selectedAction, body);
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
 * Defaults to "social media" when no specific platform has been chosen yet.
 *
 * The optional `intentHints` parameter carries structured signals from the
 * call-site (campaign linked, content pillar, whether the operator typed an
 * explicit prompt) so the server action can classify intent without re-fetching
 * draft data — those signals are already available in the component.
 */
export function buildGenerateCaptionArgs(
  organisationId: string,
  prompt: string,
  draftTitle: string | null | undefined,
  platform: string | null | undefined,
  intentHints?: GenerationIntentHints,
): [string, string, string, GenerationIntentHints | undefined] {
  return [
    organisationId,
    prompt || draftTitle || "Generate a creative draft",
    platform || "social media",
    intentHints,
  ];
}

export type { GenerationIntentHints };
