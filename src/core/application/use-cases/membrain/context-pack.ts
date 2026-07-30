import type { MembrainContextItem, MembrainContextPack } from "@/core/domain/entities/membrain";
import { importanceLabel } from "@/core/domain/entities/membrain";

/**
 * Assembles retrieved knowledge into a prompt-ready block.
 *
 * This is deliberately a pure function in the application layer, not a
 * repository concern: how knowledge is *presented* to a model is a product
 * decision that will be tuned often, and it must be testable without a
 * database.
 *
 * Rules encoded here:
 *  - Highest importance first, so the truncation boundary drops the least
 *    valuable knowledge rather than an arbitrary tail.
 *  - Every fragment is attributed with its title, category and version, which
 *    lets a reviewer trace any AI claim back to the exact entry that caused it.
 *  - Truncation is reported, never silent.
 */
const CHARS_PER_TOKEN = 4;

export function buildContextPack(input: {
  organisationId: string;
  organisationName: string;
  query: string | null;
  items: MembrainContextItem[];
  maxCharacters: number;
}): MembrainContextPack {
  const header = [
    `# MemBrain — ${input.organisationName}`,
    input.query ? `Retrieved for: ${input.query}` : "Retrieved: core account knowledge",
    "",
    "Treat the following as authoritative client knowledge. Where it conflicts with general assumptions, the knowledge below wins. Cite an entry title when a claim depends on it.",
    "",
  ].join("\n");

  const included: MembrainContextItem[] = [];
  const blocks: string[] = [];
  let used = header.length;
  let truncated = false;

  for (const item of input.items) {
    const block = renderItem(item);
    if (used + block.length > input.maxCharacters) {
      truncated = true;
      continue;
    }
    included.push(item);
    blocks.push(block);
    used += block.length;
  }

  // A budget too small for even the top-ranked entry must never present as
  // "this client has no knowledge". That sentence is false, and it is exactly
  // the case where the dropped entry is most likely to be a hard constraint —
  // a legal restriction, a banned claim — that the model then violates.
  //
  // Include the highest-ranked entry regardless, truncated and labelled, so the
  // model is working from partial knowledge it can see rather than none it
  // cannot.
  if (blocks.length === 0 && input.items.length > 0) {
    const first = input.items[0]!;
    const room = Math.max(0, input.maxCharacters - header.length - TRUNCATION_NOTICE.length);

    included.push(first);
    blocks.push(renderItem(first).slice(0, room) + TRUNCATION_NOTICE);
    truncated = true;
  }

  const prompt =
    blocks.length > 0
      ? header + blocks.join("\n")
      : `${header}No knowledge has been recorded for this client yet.\n`;

  return {
    organisationId: input.organisationId,
    query: input.query,
    items: included,
    prompt,
    estimatedTokens: Math.ceil(prompt.length / CHARS_PER_TOKEN),
    truncated,
  };
}

const TRUNCATION_NOTICE = "\n<!-- truncated: entry exceeded the context budget -->\n";

function renderItem(item: MembrainContextItem): string {
  const label = item.categoryLabel ?? "Uncategorised";
  const meta = `${label} · ${importanceLabel(item.importance)} · v${item.version}`;
  const summary = item.summary ? `_${item.summary}_\n\n` : "";
  return `## ${item.title}\n<!-- ${meta} -->\n${summary}${item.body.trim()}\n\n`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
