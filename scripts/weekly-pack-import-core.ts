export interface WeeklyPackItem {
  sourceKey: string;
  driveFileId: string;
  fileName: string;
  brand: string;
  itemLabel: string;
  captionOptions: string[];
  slotTime: string | null;
  metadata: Record<string, unknown>;
}

type ScanSeen = {
  name?: unknown;
  brand?: unknown;
  packed_as?: unknown;
  status?: unknown;
  pack?: unknown;
  drive_file_id?: unknown;
};

type PackCard = {
  card?: unknown;
  message?: unknown;
  option_1?: unknown;
  option_2?: unknown;
  option_3?: unknown;
  tt_slot?: unknown;
  ig_slot_hold?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function londonSlotToUtc(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:\s+[A-Za-z]{3})?\s+(\d{2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const wallClockAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(wallClockAsUtc));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const londonAtGuess = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return new Date(wallClockAsUtc - (londonAtGuess - wallClockAsUtc)).toISOString();
}

export function parseWeeklyPackSources(scanRaw: unknown, metadataRaw: unknown): WeeklyPackItem[] {
  const scan = record(scanRaw);
  const seen = record(scan.seen);
  const packs = record(scan.packs);
  const metadata = Array.isArray(metadataRaw) ? metadataRaw.map(record) : [];
  const cardsByName = new Map<string, PackCard>();

  for (const packValue of Object.values(packs)) {
    const numbering = record(record(packValue).owner_pack_numbering);
    for (const cardValue of Object.values(numbering)) {
      const card = record(cardValue) as PackCard;
      const name = text(card.card);
      if (name) cardsByName.set(name.toLowerCase(), card);
    }
  }

  const seenById = new Map(Object.entries(seen));
  const seenByName = new Map(Object.values(seen).map((value) => {
    const item = record(value) as ScanSeen;
    return [text(item.name)?.toLowerCase() ?? "", item] as const;
  }));
  const merged = new Map<string, WeeklyPackItem>();
  for (const [sourceId, value] of Object.entries(seen)) {
    const item = record(value) as ScanSeen;
    const driveFileId = text(item.drive_file_id) ?? sourceId;
    const fileName = text(item.name);
    const brand = text(item.brand);
    if (!driveFileId || !fileName || !brand) continue;
    const card = cardsByName.get(fileName.toLowerCase());
    const options = [text(card?.option_1), text(card?.option_2), text(card?.option_3)].filter((option): option is string => Boolean(option));
    merged.set(`drive:${driveFileId}`, {
      sourceKey: `drive:${driveFileId}`,
      driveFileId,
      fileName,
      brand,
      itemLabel: text(card?.message) ?? text(item.packed_as) ?? fileName.replace(/\.[^.]+$/, ""),
      captionOptions: options.length === 3 ? options : [],
      slotTime: londonSlotToUtc(card?.tt_slot) ?? londonSlotToUtc(card?.ig_slot_hold),
      metadata: { status: text(item.status), pack: text(item.pack), packedAs: text(item.packed_as) },
    });
  }

  for (const row of metadata) {
    const driveFileId = text(row.id) ?? text(row.file_id) ?? text(row.drive_file_id);
    const fileName = text(row.name) ?? text(row.file_name);
    const brand = text(row.brand);
    if (!driveFileId || !fileName || !brand) continue;
    const key = `drive:${driveFileId}`;
    if (merged.has(key)) continue;
    const item = (seenById.get(driveFileId) ? record(seenById.get(driveFileId)) : seenByName.get(fileName.toLowerCase()) ?? {}) as ScanSeen;
    const card = cardsByName.get(fileName.toLowerCase());
    const options = [text(card?.option_1), text(card?.option_2), text(card?.option_3)].filter((value): value is string => Boolean(value));
    merged.set(key, {
      sourceKey: key,
      driveFileId,
      fileName,
      brand,
      itemLabel: text(card?.message) ?? text(item.packed_as) ?? fileName.replace(/\.[^.]+$/, ""),
      captionOptions: options.length === 3 ? options : [],
      slotTime: londonSlotToUtc(card?.tt_slot) ?? londonSlotToUtc(card?.ig_slot_hold),
      metadata: { status: text(item.status), pack: text(item.pack), packedAs: text(item.packed_as) },
    });
  }

  return [...merged.values()].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

/** Exact initial owner-review pack requested for Genesis: 10 Mervic + 4 Villiz. */
export function selectInitialWeeklyPackItems(items: WeeklyPackItem[]): WeeklyPackItem[] {
  const eligible = items
    .filter((item) => item.metadata.status === "awaiting_approval")
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "en", { numeric: true }));
  return [
    ...eligible.filter((item) => item.brand === "Mervic").slice(0, 10),
    ...eligible.filter((item) => item.brand === "Villiz").slice(0, 4),
  ];
}
