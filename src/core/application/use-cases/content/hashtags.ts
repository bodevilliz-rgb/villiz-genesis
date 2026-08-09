/**
 * Hashtag utilities — the single, authoritative implementation used by
 * every path that touches hashtags: the UI normalizer, the publishing
 * composer, simulation, retries.
 *
 * composePublishedText is the ONLY function allowed to combine body + hashtags.
 * No other code should concatenate them. The stored body column is never
 * modified — composition happens at the publishing boundary only.
 */

/**
 * Normalize a raw token list into a clean, deduplicated array of tokens
 * ready for storage.
 *
 * Rules:
 *   - Strips leading # characters
 *   - Trims surrounding whitespace
 *   - Drops empty tokens
 *   - Drops tokens that contain internal whitespace (multi-word strings are
 *     not valid hashtag tokens)
 *   - Deduplicates case-insensitively; the first occurrence wins (preserving
 *     the case the operator typed)
 */
export function normalizeHashtags(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of raw) {
    const stripped = token.trim().replace(/^#+/, "");
    if (!stripped) continue;
    if (/\s/.test(stripped)) continue;
    const key = stripped.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(stripped);
    }
  }
  return result;
}

/**
 * Parse a freeform operator input string into individual tokens.
 *
 * Accepts both:
 *   "#Foo #Bar #Baz"
 *   "Foo, Bar, Baz"
 *   "#Foo, #Bar" (mixed)
 *
 * Always returns raw tokens — call normalizeHashtags() on the result.
 */
export function parseHashtagInput(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Compose the final published text from a stored body and a stored hashtag
 * list. This is the SINGLE composer used by every publish path.
 *
 * Guarantees:
 *   - body is returned unchanged when hashtags is empty
 *   - hashtags are formatted with a leading # and appended after a blank line
 *   - no hashtag is duplicated (normalizeHashtags is called internally)
 *   - retries produce the same output (pure function, no state)
 */
export function composePublishedText(body: string, hashtags: string[]): string {
  const normalized = normalizeHashtags(hashtags);
  if (normalized.length === 0) return body;
  const formatted = normalized.map((t) => `#${t}`).join(" ");
  return `${body}\n\n${formatted}`;
}
