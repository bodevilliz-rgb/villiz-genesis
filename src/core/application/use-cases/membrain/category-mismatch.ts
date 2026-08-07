/**
 * Heuristic detection of MemBrain entries stored under the wrong category.
 *
 * The fundamental failure mode this guards against: a user saves "Target
 * Audience" information under the Brand Voice category because they clicked
 * the wrong pill. The readiness engine then reports Target Audience as
 * missing even though the knowledge exists — and Brand Voice is diluted
 * with off-topic content.
 *
 * This module uses keyword lists rather than a second AI call. It is cheap,
 * deterministic, and testable without any I/O. Semantic detection (embedding
 * cosine similarity) is noted as future work in the Task H limitation list.
 */

export interface CategoryMismatchWarning {
  entryId: string;
  entryTitle: string;
  currentCategoryKey: string | null;
  suggestedCategoryKey: string;
  suggestedCategoryLabel: string;
  reason: string;
}

/** Minimum shape an entry must expose for mismatch detection. */
export interface EntryInput {
  id: string;
  title: string;
  body: string;
  categoryKey: string | null;
}

interface CategorySignal {
  key: string;
  label: string;
  keywords: string[];
}

const CATEGORY_SIGNALS: CategorySignal[] = [
  {
    key: "audience",
    label: "Target Audience",
    keywords: [
      "target audience",
      "customer",
      "client",
      "demographic",
      "buyer persona",
      "end user",
      "age group",
      "segment",
      "persona",
      "niche",
    ],
  },
  {
    key: "brand_voice",
    label: "Brand Voice",
    keywords: [
      "tone of voice",
      "writing style",
      "brand personality",
      "communication style",
      "speak in",
      "always write",
      "formal",
      "casual",
      "conversational",
      "authoritative",
    ],
  },
  {
    key: "brand_description",
    label: "Brand Description",
    keywords: [
      "founded in",
      "we are a",
      "our mission",
      "our vision",
      "company overview",
      "about us",
      "established",
      "headquartered",
      "our story",
      "who we are",
    ],
  },
  {
    key: "content_pillars",
    label: "Content Pillars",
    keywords: [
      "content pillar",
      "key theme",
      "content topic",
      "editorial focus",
      "content category",
      "content area",
      "core topic",
    ],
  },
  {
    key: "offering",
    label: "Products & Services",
    keywords: [
      "product",
      "service",
      "package",
      "pricing",
      "plan",
      "subscription",
      "feature",
      "solution",
      "offer",
      "deliverable",
    ],
  },
  {
    key: "guidelines",
    label: "Guidelines & Restrictions",
    keywords: [
      "never use",
      "do not",
      "avoid",
      "prohibited",
      "banned",
      "forbidden",
      "comply",
      "compliance",
      "legal",
      "restriction",
    ],
  },
];

function scoreEntry(text: string, signal: CategorySignal): number {
  const lower = text.toLowerCase();
  return signal.keywords.reduce((hits, kw) => hits + (lower.includes(kw) ? 1 : 0), 0);
}

/**
 * Returns warnings for entries whose content strongly matches a different
 * category than the one they are currently stored under.
 *
 * An entry is flagged only when:
 *   - It scores ≥ 2 keyword hits in a foreign category, AND
 *   - That foreign category scores strictly higher than the current one.
 *
 * The thresholds keep false-positive noise low: a single incidental keyword
 * ("our clients love this product") won't trigger a warning.
 */
export function detectCategoryMismatches(entries: EntryInput[]): CategoryMismatchWarning[] {
  const warnings: CategoryMismatchWarning[] = [];

  for (const entry of entries) {
    const text = `${entry.title} ${entry.body}`;

    let currentScore = 0;
    if (entry.categoryKey) {
      const currentSignal = CATEGORY_SIGNALS.find((s) => s.key === entry.categoryKey);
      if (currentSignal) currentScore = scoreEntry(text, currentSignal);
    }

    let topScore = 0;
    let topSignal: CategorySignal | null = null;
    for (const signal of CATEGORY_SIGNALS) {
      if (signal.key === entry.categoryKey) continue;
      const score = scoreEntry(text, signal);
      if (score > topScore) {
        topScore = score;
        topSignal = signal;
      }
    }

    if (topSignal && topScore >= 2 && topScore > currentScore) {
      warnings.push({
        entryId: entry.id,
        entryTitle: entry.title,
        currentCategoryKey: entry.categoryKey,
        suggestedCategoryKey: topSignal.key,
        suggestedCategoryLabel: topSignal.label,
        reason: `Entry scored ${topScore} keyword hits for "${topSignal.label}" but only ${currentScore} for its current category.`,
      });
    }
  }

  return warnings;
}
