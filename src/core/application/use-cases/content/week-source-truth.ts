import type { ContentDraft } from "@/core/domain/entities/content";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueLines(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of values) {
    const value = clean(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(value);
  }
  return lines;
}

/**
 * Builds the most specific customer-facing evidence available for one content
 * item. Only draft/artwork metadata is returned here: no model instructions,
 * control language, or internal terminology is allowed into this evidence.
 */
export function composeWeekSourceTruth(draft: ContentDraft | null): string | null {
  if (!draft) return null;

  const assetLines = (draft.assets ?? []).flatMap(({ asset }) => {
    if (!asset) return [];
    return [
      asset.title,
      asset.description,
      asset.altText,
      asset.tags.length ? asset.tags.join(", ") : null,
    ];
  });

  const lines = uniqueLines([
    draft.title,
    draft.summary,
    ...assetLines,
  ]);

  return lines.length ? lines.join("\n") : null;
}

/**
 * Keeps the most specific evidence first without adding prompt-like labels or
 * internal instructions that a generative model could echo into public copy.
 */
export function prependWeekSourceTruth(brief: string, sourceTruth: string | null): string {
  if (!sourceTruth) return brief;
  return [sourceTruth, brief].join("\n\n");
}
