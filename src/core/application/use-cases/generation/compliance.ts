/**
 * Post-generation compliance validation and lexical repair.
 *
 * Primary defence: grounding rules embedded in the system prompt so the
 * model never produces violations in the first place.
 *
 * Secondary defence (this module): pure, deterministic functions that
 * scan the returned body for prohibited terms extracted from MemBrain
 * restrictions and attempt a coherence-safe lexical repair. No additional
 * AI call is made.
 *
 * Repair hierarchy (user-specified):
 *   A. Prevention via generation instructions (system prompt / principles).
 *   B. Detection of prohibited terms after generation.
 *   C. Deterministic removal only when the result is demonstrably coherent.
 *   D. If safe repair is not possible, flag as requiring review — do not
 *      return damaged copy as compliant.
 *
 * Every exported function is a pure function — no I/O, no model calls, no
 * database — so each can be tested and tuned in isolation.
 */

/**
 * Extracts explicitly prohibited terms from MemBrain restriction strings.
 *
 * A restriction sentence qualifies when it contains a prohibition trigger
 * ("never", "do not", "avoid", "prohibited", "banned", "forbidden"). All
 * single-quoted terms in that sentence are treated as the prohibited vocabulary.
 *
 * Example:
 *   "Never use the word 'perfect', 'perfection', or 'perfectly'."
 *   → ["perfect", "perfection", "perfectly"]
 *
 * Returned terms are lower-cased and de-duplicated.
 */
const PROHIBITION_TRIGGER = /\b(?:never|do\s+not|avoid|prohibite?d?|bann?e?d?|forbidden)\b/i;

export function extractProhibitedTerms(restrictions: string[]): string[] {
  const terms: string[] = [];
  for (const restriction of restrictions) {
    if (!PROHIBITION_TRIGGER.test(restriction)) continue;
    const quoted = /'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = quoted.exec(restriction)) !== null) {
      if (match[1]) terms.push(match[1].toLowerCase());
    }
  }
  return [...new Set(terms)];
}

/**
 * Returns the subset of prohibited terms that appear in the generated body.
 * Comparison is case-insensitive substring match, so "perfect" also catches
 * "perfection" and "perfectly" when those are separate prohibited terms.
 */
export function detectComplianceViolations(body: string, restrictions: string[]): string[] {
  const prohibited = extractProhibitedTerms(restrictions);
  const lower = body.toLowerCase();
  return prohibited.filter((term) => lower.includes(term));
}

/**
 * The result of an attempted compliance repair.
 *
 * `safe: true`  — the repair produced coherent copy; `body` is the cleaned text.
 * `safe: false` — the repair would damage copy; `body` is the original unmodified
 *                 text and `requiresReview` is `true`. Callers must surface a
 *                 "requires human review" warning rather than returning the output
 *                 as compliant.
 */
export interface ComplianceRepairResult {
  body: string;
  safe: boolean;
  requiresReview: boolean;
}

/**
 * Checks that a string still reads as grammatically coherent copy after
 * word removal. This is a minimal structural gate, not a style evaluation.
 *
 * Fails when the result:
 *   - is empty or whitespace only
 *   - contains no word characters at all
 *   - starts with punctuation (indicates an orphaned sentence opener)
 *   - contains a comma or semi-colon immediately before a sentence-ending
 *     punctuation mark (", !" or "; ." etc.)
 *   - contains whitespace immediately before "!" or "?" (indicates the
 *     exclamation was attached to the removed word)
 */
function isCoherent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!/\w/.test(trimmed)) return false;
  if (/^[,;:!?.]/.test(trimmed)) return false;
  if (/[,;]\s*[!?.]/.test(trimmed)) return false;
  if (/ [!?]/.test(trimmed)) return false;
  return true;
}

/**
 * Attempts a minimal lexical repair: removes each violated term using
 * whole-word (word-boundary) regex replacement, then collapses stray
 * whitespace.
 *
 * Returns a `ComplianceRepairResult`:
 *   - If the repaired text passes the coherence gate, `safe` is `true` and
 *     `body` is the cleaned text.
 *   - If the repaired text would be incoherent, `safe` is `false`, `body` is
 *     the **original unmodified text**, and `requiresReview` is `true`.
 *     Callers must not present this output as compliant.
 */
export function repairComplianceViolations(body: string, violations: string[]): ComplianceRepairResult {
  if (violations.length === 0) {
    return { body, safe: true, requiresReview: false };
  }

  let repaired = body;
  for (const violation of violations) {
    const escaped = violation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    repaired = repaired
      .replace(new RegExp(`\\b${escaped}\\b`, "gi"), "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  if (!isCoherent(repaired)) {
    return { body, safe: false, requiresReview: true };
  }

  return { body: repaired, safe: true, requiresReview: false };
}
