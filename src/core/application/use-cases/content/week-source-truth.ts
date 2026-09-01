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
 * Builds the most specific, durable truth available for one scheduled content
 * item. Asset metadata is deliberately included because it belongs to the
 * actual week artwork, while campaign/MemBrain context remains downstream.
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

export function prependWeekSourceTruth(brief: string, sourceTruth: string | null): string {
  if (!sourceTruth) return brief;
  return [
    "WEEK SOURCE TRUTH — authoritative for this specific content item. Preserve its meaning; platform adaptation may change delivery, never subject:",
    sourceTruth,
    "GENERATION BRIEF — secondary to the Week Source Truth:",
    brief,
  ].join("\n\n");
}
