/**
 * GEN-PUB-A — one-message posting intake contract.
 *
 * Standing contract: the owner states one message ("post client X flier 14 Oct"
 * / "schedule fliers from Drive folder Y 2026-10-21 09:15") and Awo maps it to a
 * governed Genesis publishing job without improvising. This module is the
 * deterministic parser — the machine-readable half of the intake contract so
 * every claimed decision can be round-tripped, diffed and verified in tests.
 *
 * NO SCHEMA REWRITES: every output field maps onto existing Genesis shapes
 * (publishing.ts PUBLISHING_PLATFORMS, platform-policy.ts
 * evaluateHashtagPolicy / getPlatformPublishingPolicy, publishing use-case
 * createScheduledPublishingJob / createImmediatePublishingJob inputs). Nothing
 * here writes to the database — the parser is pure and idempotent: the same
 * message with the same clock, kept set and index always yields the same
 * contract.
 *
 * Authority boundary: parsing an owner message NEVER publishes and never
 * creates a job. Real submissions remain gated by (a) owner content approval —
 * granted ONCE per campaign asset, stored on the campaign card, and reusable
 * for every slot of that asset — and (b) the standing GEN-LIVE-1
 * execution-mode authority pattern at publish time, where the owner go toggles
 * execution mode (live vs simulation) per batch. Stops in the parsed contract
 * are how the parser surfaces exactly which owner decision is still missing.
 */

import { isPublishingPlatform } from "@/core/domain/entities/publishing";
import {
  evaluateHashtagPolicy,
  getPlatformPublishingPolicy,
} from "@/core/domain/entities/platform-policy";
import { normalizeHashtags } from "@/core/application/use-cases/content/hashtags";

// ─── Contract shapes ─────────────────────────────────────────────────────────

/** Campaign asset approval — recorded ONCE per asset on the campaign card, reusable for that asset's slots. */
export interface OwnerContentApproval {
  /** Verbatim owner wording (e.g. "send it", "approved"). Never paraphrased. */
  phrase: string;
  /** UTC instant the approval decision was made. */
  decidedAt: string;
  /** Kanban campaign card holding the durable approval record (null while pending filing). */
  campaignCardId: string | null;
  /** Where this approval was captured: in the directive message itself, or read from the campaign card. */
  record: "in_message" | "campaign_card";
}

export interface InferredClientContext {
  clientName: string;
  /** Where the client was resolved from: said in the message, or derived from the folder→client index. */
  source: "message" | "asset_index";
}

export interface ParsedSchedule {
  /** Zone the wall-clock time was interpreted in. Standing default GMT — stored as Etc/GMT (no DST). */
  timezone: string;
  /** UTC instant the wall-clock time resolves to (createScheduledPublishingJob scheduledFor input). */
  scheduledFor: string;
  /** How the clock time was obtained: explicit in the message, or the standing 09:00 default. */
  source: "explicit" | "default";
  /** Normalised wall-clock string as interpreted (e.g. "2026-10-14 09:15"). */
  requestedWallClock: string;
}

export interface CaptionSource {
  /** Provided = owner-supplied verbatim text in the message; drafted = to be drafted, then approved once. */
  kind: "provided" | "drafted";
  /** The verbatim text when kind="provided"; null when drafted (the draft does not exist yet). */
  value: string | null;
  /** True when the caption still needs explicit owner approval before scheduling. */
  requiresApproval: boolean;
}

export interface HashtagPolicy {
  /** True when the list was auto-trimmed to the platform's verified maximum (IG keeps the head of the owner-ordered set). */
  autoTrimmed: boolean;
  /** The exact normalised list that will be sent — always inside the platform limit when withinLimit. */
  final: string[];
  /** Hashtags removed by auto-trim, in kept-set order (IG only; empty elsewhere). */
  dropped: string[];
  /** Count exactly as it will be sent (normalised, deduplicated case-insensitively). */
  count: number;
  /** Provider-verified platform maximum; null = no verified limit exists yet (never an invented number). */
  platformLimit: number | null;
  /** False = the deterministic preflight would block live publishing; intake never schedules such a post. */
  withinLimit: boolean;
}

export interface AIBrandDeclaration {
  /** Per-post truth claims — TikTok requires all three; null would fail-closed block a TikTok publish. */
  isAiGenerated: boolean | null;
  isYourBrand: boolean | null;
  isBrandedContent: boolean | null;
  /** How the values were set: owner statement for this content, or the GEN-LIVE-1 certified-lane precedent. */
  source: "owner_statement" | "gen_live_1_precedent";
}

/** Why the contract cannot yet produce a schedulable publishing job. */
export type IntakeStopCode =
  | "unknown_client"
  | "no_resolved_asset"
  | "ambiguous_asset"
  | "unknown_platform"
  | "unparseable_date"
  | "past_date"
  | "caption_requires_approval";

/** Which owner decision each stop asks for. */
export type IntakeGateCode =
  | "client_asset_mapping"
  | "caption_approval"
  | "declaration_statement"
  | "publishing_go"

export interface IntakeStop {
  code: IntakeStopCode;
  gate: IntakeGateCode;
  message: string;
  /** The concrete owner decision(s) that clear this stop. */
  pendingOwnerDecisions: string[];
}

export interface ParsedIntakeJob {
  client: InferredClientContext | null;
  asset: {
    kind: "content" | "drive_folder" | "client_asset_index";
    ref: string | null;
    /** Turned into resolved media URLs by asset resolution (GEN-PUB-B); null until that lane runs. */
    resolvedAssetIds: string[] | null;
  };
  platforms: string[];
  schedule: ParsedSchedule;
  caption: CaptionSource;
  hashtags: Record<string, HashtagPolicy> | null;
  aiBrandDeclarations: Record<string, AIBrandDeclaration> | null;
  contentApproval: OwnerContentApproval | null;
  /** Non-empty when the contract cannot yet produce a schedulable job — every stop names its owner decision. */
  stops: IntakeStop[];
  /** Echoed owner message — the provenance anchor for every derived field above. */
  sourceMessage: string;
  contractVersion: "1.0";
}

export interface IntakeContractInput {
  message: string;
  /** Clock used to resolve relative dates and the past-date check (ISO instant). */
  now: string;
  /** Owner-kept hashtag set, owner-ordered (trim keeps the head of this order). */
  keptHashtags: string[];
  /** Owner-kept index: client name → Drive folder ref. Bootstrapped once, then reused for every intake. */
  clientIndex: Record<string, string>;
  /** Approval already stored on the campaign card for this asset, if any (record="campaign_card"). */
  existingApproval?: OwnerContentApproval | null;
}

// ─── Grammar ─────────────────────────────────────────────────────────────────

const PLATFORM_ALTS = "insta(?:gram)?|ig|face(?:book)?|fb|meta|twitter|linked\\s?in|li|tik\\s?tok|tt|x";

/** Platform words only count with a preposition prefix ("on IG", "to TikTok", "and X") — so a client literally named "X" is never mistaken for the X platform. */
function platformScanRegex(): RegExp {
  return new RegExp(`\\b(?:on|and|or|to|via)\\s+(${PLATFORM_ALTS})\\b`, "gi");
}

/** Operator shorthand: "platforms: instagram, tiktok". */
const PLATFORMS_CLAUSE_RE = /\bplatforms?\s*[:=]\s*([A-Za-z,\s]+)/i;
const PLATFORM_TOKEN_MAP: Record<string, string> = {
  instagram: "instagram", insta: "instagram", ig: "instagram",
  facebook: "facebook", face: "facebook", fb: "facebook", meta: "facebook",
  twitter: "x", x: "x",
  linkedin: "linkedin", "linked in": "linkedin", li: "linkedin",
  tiktok: "tiktok", "tik tok": "tiktok", "tiktok ": "tiktok", tt: "tiktok",
};

const CONTENT_RE = /content\s+["'“”]([^"'“”]+)["'“”]/i;
const DRIVE_FOLDER_RE = /(?:from|in)\s+(?:the\s+)?(?:drive\s+)?folder\s+["'“”]?([A-Za-z0-9][A-Za-z0-9 _/-]*)/i;
/** Bare "folder Y" — anchor used for cutting the asset-noun tail (no "from" required). */
const FOLDER_ANCHOR_RE = /\bfolder\b/i;
/** Trailing platform context must never become folder data: three shapes exist.
 *  (1) an operator clause starting inside the capture: `platforms: …`,
 *  `platforms =` (fire when whitespace/colon/equals trails the word);
 *  (2) the bare word itself at the END of the capture — the colon sits just
 *  outside the capture class, so "folder Y platforms: instagram …" is folder "Y";
 *  (3) a preposition + platform word ("folder Y on Instagram", "folder Y to
 *  TikTok"). Anchored with \s+ on the left so hyphenated names
 *  ("launch-on-ig-raw") survive intact. Known trade-off: a folder name that
 *  genuinely ENDS with the word "platforms" or reads as a preposition+platform
 *  ("Tik Tok") cuts short — the kept index then surfaces the mismatch as an
 *  unknown_client stop instead of silently losing owner intent. */
const PLATFORM_TAIL_CUT_RE = new RegExp(`\\s+(?:platforms?[\\s:=]+|platforms?\\s*$|(?:on|and|or|to|via)\\s+(${PLATFORM_ALTS})\\b)`, "i");
const FROM_CLAUSE_RE = /\b(?:from|in)\b/i;
const DATE_PHRASE_RE = /\b(?:(\d{4}-\d{1,2}-\d{1,2})|(tomorrow|tonight|today)|(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:\s+(\d{4}))?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?)\b/i;
const CLOCK_RE = /\b(\d{1,2})[:.](\d{2})(?:\s*([ap])\.?m?\b)?/i;
const VERB_RE = /\b(?:post|schedule|queue|publish)\b/i;
const APPROVAL_PHRASE_RE = /\b(approved to send|approved|send it|go ahead|yes send|confirmed)\b/i;
const KEPT_SET_LINE_RE = /\bkept\s+hashtag\s+set\s*[:=]\s*([^\n\r]+)/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const GMT_DEFAULT_TIMEZONE = "Etc/GMT";
/** Standing default clock time when the owner's message carries a date but no time. */
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;

// ─── Token helpers (pure, individually testable) ─────────────────────────────

export function extractPlatformTokens(message: string): string[] {
  const found: string[] = [];
  const push = (platform: string) => {
    if (!found.includes(platform)) found.push(platform);
  };
  const scan = platformScanRegex();
  let match = scan.exec(message);
  while (match !== null) {
    const token = match[1];
    if (token !== undefined) {
      const key = token.toLowerCase().replace(/\s+/, " ");
      const platform = Object.prototype.hasOwnProperty.call(PLATFORM_TOKEN_MAP, key) ? PLATFORM_TOKEN_MAP[key] : null;
      if (platform) push(platform);
    }
    match = scan.exec(message);
  }
  const clause = PLATFORMS_CLAUSE_RE.exec(message);
  if (clause && clause[1] !== undefined) {
    for (const rawToken of clause[1].split(/[,\s]+/)) {
      const platform = Object.prototype.hasOwnProperty.call(PLATFORM_TOKEN_MAP, rawToken.toLowerCase())
        ? PLATFORM_TOKEN_MAP[rawToken.toLowerCase()]
        : null;
      if (platform) push(platform);
    }
  }
  return found;
}

/**
 * Unknown platform names the owner explicitly stated — through the operator
 * clause only ("platforms: bebo"), because bare words elsewhere are ambiguous
 * (a client may be named "X"; brand/product words may contain platform
 * substrings) and the preposition-bound scan already maps every known word.
 * The parser MUST surface these as a real `unknown_platform` stop instead of
 * silently defaulting to Instagram (QA round-1 blocking finding #2 — the
 * documented runbook stop had no live trigger path).
 */
export function extractUnknownPlatformTokens(message: string): string[] {
  const unknown: string[] = [];
  const clause = PLATFORMS_CLAUSE_RE.exec(message);
  if (clause && clause[1] !== undefined) {
    for (const rawToken of clause[1].split(/[,\s]+/)) {
      if (rawToken.length === 0) continue;
      if (Object.prototype.hasOwnProperty.call(PLATFORM_TOKEN_MAP, rawToken.toLowerCase())) continue;
      if (!unknown.includes(rawToken.toLowerCase())) unknown.push(rawToken.toLowerCase());
    }
  }
  return unknown;
}

export function extractContentRef(message: string): string | null {
  const match = CONTENT_RE.exec(message);
  const value = match?.[1];
  return value === undefined || value.length === 0 ? null : value;
}

export function extractDriveFolderRef(message: string): string | null {
  const match = DRIVE_FOLDER_RE.exec(message);
  const value = match?.[1];
  if (value === undefined) return null;
  // Trailing schedule data must never become folder data: cut the captured
  // name at the first full date, clock time or orphan hour —
  // "folder Y 2026-10-21 09:15" is folder "Y"; "alpha-homes oct" stays whole.
  const cutMatch = /\s+(?:\d{4}-\d{1,2}-\d{1,2}(?:\s|$)|\d{1,2}[:.]\d{2}|\d{1,2}$)/.exec(value);
  let head = cutMatch !== null && cutMatch.index !== undefined ? value.slice(0, cutMatch.index) : value;
  // Trailing platform context must never become folder data either (QA round-1
  // blocking finding #1): probe head PLUS one lookahead char — the capture
  // class stops at the colon ("Y platforms", bare "Y"), so the cut regex must
  // see past the capture boundary to find the clause start.
  const platformCut = PLATFORM_TAIL_CUT_RE.exec(`${head} `);
  if (platformCut !== null && platformCut.index !== undefined && platformCut.index < head.length) {
    head = head.slice(0, platformCut.index);
  }
  const trimmed = head.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Client names are matched case-insensitively against the owner-kept index —
 * longest key first, multi-word names allowed ("Alpha Homes"); the capture is
 * cut at the first schedule/platform/from clause so trailing context never
 * becomes name data. Unindexed names surface as their bare first word so the
 * unknown_client stop can name them.
 */
export function extractClientName(message: string, clientIndex: Record<string, string> = {}): string | null {
  const match = /\bclient\s+(.+)$/i.exec(message);
  if (!match || match[1] === undefined) return null;
  let rest = match[1];
  const cutReSources = [DATE_PHRASE_RE, /\b\d{1,2}[:.]\d{2}\b/, /\b(?:on|and|or|to|via)\s+\S+/i, /\b(?:from|in)\b/i, FOLDER_ANCHOR_RE];
  let cutIndex = rest.length;
  for (const source of cutReSources) {
    const cut = new RegExp(source.source, "i").exec(rest);
    const index = cut && cut.index !== undefined ? cut.index : undefined;
    if (index !== undefined && index < cutIndex) cutIndex = index;
  }
  rest = rest.slice(0, cutIndex).trim();
  for (const key of Object.keys(clientIndex).sort((a, b) => b.length - a.length)) {
    const lower = rest.toLowerCase();
    if (lower === key.toLowerCase() || lower.startsWith(`${key.toLowerCase()} `)) return key;
  }
  const bare = rest.split(/\s+/)[0] ?? null;
  return bare !== null && bare.length > 0 ? bare : null;
}

/** Approval phrase scan — ordered longest-first so "approved to send" wins over "approved". */
export function extractApprovalPhrase(message: string): string | null {
  const match = APPROVAL_PHRASE_RE.exec(message);
  return match?.[0] ?? null;
}

/** Owner-provided kept-set override line inside the message ("kept hashtag set: flier, launch"). */
export function extractKeptSetOverride(message: string): string[] | null {
  const match = KEPT_SET_LINE_RE.exec(message);
  if (!match || match[1] === undefined) return null;
  const tokens = match[1]
    .split(/[,\s]+/)
    .map((token) => token.trim().replace(/^#/, ""))
    .filter((token) => token.length > 0);
  return tokens.length > 0 ? tokens : null;
}

/** The asset noun ("flier") between the verb and the first asset-ref/date/time/prepositional tail. */
export function extractAssetNoun(
  message: string,
  clientIndex: Record<string, string> = {},
): string | null {
  const verbMatch = VERB_RE.exec(message);
  if (!verbMatch || verbMatch[0] === undefined || verbMatch.index === undefined) return null;
  let tail = message.slice(verbMatch.index + verbMatch[0].length);

  const cutReSources = [CONTENT_RE, DRIVE_FOLDER_RE, FOLDER_ANCHOR_RE, FROM_CLAUSE_RE, DATE_PHRASE_RE, /\b\d{1,2}[:.]\d{2}\b/, PLATFORM_TAIL_CUT_RE];
  let cutIndex = tail.length;
  for (const source of cutReSources) {
    const match = new RegExp(source.source, "i").exec(tail);
    const index = match?.index;
    if (index !== undefined && index < cutIndex) cutIndex = index;
  }
  tail = tail.slice(0, cutIndex);
  tail = tail.replace(/^\s*(?:a\s+|an\s+|the\s+|all\s+|every\s+|some\s+)?/i, "");
  // Owner shape "post client X flier …" — strip the client clause per kept index key,
  // longest first, always followed by whitespace so the noun never becomes "flier co"
  // or is eaten when the noun itself ("flier") starts a longer index name.
  for (const key of Object.keys(clientIndex).sort((a, b) => b.length - a.length)) {
    const lowerTail = tail.toLowerCase();
    if (lowerTail.startsWith(`client ${key.toLowerCase()} `)) {
      tail = tail.slice(("client " + key + " ").length);
      break;
    }
  }
  // Unindexed clients still expose a noun when only ONE following token remains
  // ("post client Delta flier 14 Oct" → "flier") — never two tokens (too ambiguous).
  tail = tail.replace(/^client\s+\S+\s+/, "");
  // Shape "post a flier for client X" — strip the trailing client clause.
  tail = tail.replace(/\s+for\s+client\s+.*$/i, "");
  const noun = tail.trim().toLowerCase();
  return noun.length > 0 ? noun : null;
}

// ─── Schedule parsing (GMT default) ─────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysInUtcMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Date/time parsing, standing default GMT (stored as Etc/GMT): "14 Oct",
 * "Oct 14", "14 Oct 2027" (explicit year), "2026-10-14", "tomorrow",
 * "today"/"tonight"; optional "09:15"/"9.30pm". Default clock time 09:00 when
 * the date carries none. Year-less dates resolve to the current year; a
 * year-less date that has already passed this year FAILS CLOSED (state the
 * year) instead of silently rolling +12 months. scheduledFor is always a
 * UTC-normalised instant.
 */
export function extractScheduleDate(
  message: string,
  now: string,
): ParsedSchedule | { error: IntakeStopCode; message: string; requestedWallClock: string } {
  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    return { error: "unparseable_date", message: "Intake clock is not a valid instant.", requestedWallClock: message };
  }
  // Quoted asset names may contain digits that are not schedule data — strip them before scanning.
  const clean = message.replace(/["'“”][^"'“”]+["'“”]/g, " ");

  const clockMatch = CLOCK_RE.exec(clean);
  let hour = DEFAULT_HOUR;
  let minute = DEFAULT_MINUTE;
  let timeSource: ParsedSchedule["source"] = "default";
  if (clockMatch && clockMatch[1] !== undefined && clockMatch[2] !== undefined) {
    hour = parseInt(clockMatch[1], 10);
    minute = parseInt(clockMatch[2], 10);
    const meridiem = (clockMatch[3] ?? "").toLowerCase();
    if (meridiem === "p" && hour < 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
    timeSource = "explicit";
  }
  if (hour > 23 || minute > 59) {
    return { error: "unparseable_date", message: `Clock time could not be understood.`, requestedWallClock: clean };
  }

  const dateMatch = DATE_PHRASE_RE.exec(clean);
  if (!dateMatch || dateMatch[0] === undefined || dateMatch.index === undefined) {
    return {
      error: "unparseable_date",
      message: "No date phrase found. Give a date like '14 Oct', '2026-10-14' or 'tomorrow 09:15'.",
      requestedWallClock: clean,
    };
  }

  let year: number;
  let month1: number;
  let day: number;
  const iso = dateMatch[1];
  const relative = dateMatch[2];
  const dayFirstDay = dateMatch[3];
  const dayFirstMonth = dateMatch[4];
  const dayFirstYear = dateMatch[5];
  const monthFirstMonth = dateMatch[6];
  const monthFirstDay = dateMatch[7];
  const monthFirstYear = dateMatch[8];

  if (iso !== undefined) {
    const parts = iso.split("-");
    if (parts[0] === undefined || parts[1] === undefined || parts[2] === undefined) {
      return { error: "unparseable_date", message: "Date could not be understood.", requestedWallClock: iso };
    }
    year = parseInt(parts[0], 10);
    month1 = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month1) || isNaN(day)) {
      return { error: "unparseable_date", message: "Date could not be understood.", requestedWallClock: iso };
    }
  } else if (relative !== undefined) {
    const base = new Date(nowDate.getTime());
    if (relative === "tomorrow") base.setUTCDate(base.getUTCDate() + 1);
    year = base.getUTCFullYear();
    month1 = base.getUTCMonth() + 1;
    day = base.getUTCDate();
  } else if (dayFirstDay !== undefined && dayFirstMonth !== undefined) {
    const monthIndex = MONTHS.indexOf(dayFirstMonth.toLowerCase());
    if (monthIndex < 0) {
      return { error: "unparseable_date", message: "Month token not recognised.", requestedWallClock: dateMatch[0] };
    }
    day = parseInt(dayFirstDay, 10);
    month1 = monthIndex + 1;
    year = dayFirstYear !== undefined ? parseInt(dayFirstYear, 10) : nowDate.getUTCFullYear();
  } else if (monthFirstMonth !== undefined && monthFirstDay !== undefined) {
    const monthIndex = MONTHS.indexOf(monthFirstMonth.toLowerCase());
    if (monthIndex < 0) {
      return { error: "unparseable_date", message: "Month token not recognised.", requestedWallClock: dateMatch[0] };
    }
    month1 = monthIndex + 1;
    day = parseInt(monthFirstDay, 10);
    year = monthFirstYear !== undefined ? parseInt(monthFirstYear, 10) : nowDate.getUTCFullYear();
  } else {
    return { error: "unparseable_date", message: "Date could not be understood.", requestedWallClock: dateMatch[0] };
  }

  const wall = `${year}-${pad2(month1)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
  if (month1 < 1 || month1 > 12 || day < 1 || (month1 <= 12 && day > daysInUtcMonth(year, month1))) {
    return { error: "unparseable_date", message: "That date does not exist in the calendar.", requestedWallClock: wall };
  }
  const utc = new Date(Date.UTC(year, month1 - 1, day, hour, minute, 0, 0));
  // Year-less date already passed this year → the intent itself is ambiguous:
  // this year's date is past and silently pushing to +12 months is an
  // assumption. Fail closed as a past-date stop; an explicit year resolves it.
  if (iso === undefined && relative === undefined && utc.getTime() <= nowDate.getTime()) {
    return {
      error: "past_date",
      message: `Year-less date ${day} ${MONTHS[month1 - 1] ?? ""} has already passed this year. State the year explicitly (e.g. '14 Oct 2027').`,
      requestedWallClock: wall,
    };
  }
  return {
    timezone: GMT_DEFAULT_TIMEZONE,
    scheduledFor: utc.toISOString(),
    source: timeSource,
    requestedWallClock: wall,
  };
}

// ─── Hashtag policy ──────────────────────────────────────────────────────────

/**
 * Apply the owner-kept hashtag set under the platform's provider-verified
 * policy: Instagram auto-trims to 5 keeping the head of the owner-ordered
 * set; platforms without a verified limit (TikTok, Facebook, LinkedIn, X)
 * keep the full normalised set — richer sets allowed, unproven limits never
 * invented.
 */
export function applyHashtagPolicy(platform: string, keptHashtags: string[]): HashtagPolicy {
  const normalized = normalizeHashtags(keptHashtags);
  if (!isPublishingPlatform(platform)) {
    return { autoTrimmed: false, final: normalized, dropped: [], count: normalized.length, platformLimit: null, withinLimit: true };
  }
  const policy = getPlatformPublishingPolicy(platform);
  if (policy.maxHashtags === undefined) {
    return { autoTrimmed: false, final: normalized, dropped: [], count: normalized.length, platformLimit: null, withinLimit: true };
  }
  const result = evaluateHashtagPolicy(platform, normalized);
  if (!result.exceeds) {
    return { autoTrimmed: false, final: normalized, dropped: [], count: result.count, platformLimit: policy.maxHashtags, withinLimit: true };
  }
  return {
    autoTrimmed: true,
    final: normalized.slice(0, result.excessCount === normalized.length ? 0 : policy.maxHashtags),
    dropped: normalized.slice(policy.maxHashtags),
    count: policy.maxHashtags,
    platformLimit: policy.maxHashtags,
    withinLimit: true,
  };
}

// ─── AI / brand declarations ────────────────────────────────────────────────

/**
 * Starting declarations for campaign content, per the certified production
 * lane (GEN-LIVE-1): owner-directed generative campaign content declared
 * AI-generated, own-brand, not a paid third-party partnership. Every value
 * stays overridable per content via `overrides` — the owner statement always
 * wins over the precedent, and a future campaign whose content differs
 * (human-made, paid partnership) must be declared so before its TikTok
 * publish can pass preflight.
 */
export function deriveAiBrandDeclaration(
  platform: string,
  overrides: { isAiGenerated?: boolean; isYourBrand?: boolean; isBrandedContent?: boolean } = {},
): AIBrandDeclaration {
  const declaration: AIBrandDeclaration = {
    isAiGenerated: true,
    isYourBrand: true,
    isBrandedContent: false,
    source: "gen_live_1_precedent",
  };
  // No verified declaration requirement on linkedin/facebook/x (platform-policy.ts):
  // the precedent values are carried for the record, source still the precedent.
  if (overrides.isAiGenerated !== undefined) { declaration.isAiGenerated = overrides.isAiGenerated; declaration.source = "owner_statement"; }
  if (overrides.isYourBrand !== undefined) { declaration.isYourBrand = overrides.isYourBrand; declaration.source = "owner_statement"; }
  if (overrides.isBrandedContent !== undefined) { declaration.isBrandedContent = overrides.isBrandedContent; declaration.source = "owner_statement"; }
  return declaration;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

function firstStopCode(schedule: ParsedSchedule | { error: IntakeStopCode; message: string; requestedWallClock: string }): schedule is { error: IntakeStopCode; message: string; requestedWallClock: string } {
  return (schedule as { error?: IntakeStopCode }).error !== undefined;
}

/**
 * Parse an owner one-message directive into a ParsedIntakeContract — the
 * governed mapping of the message onto client, asset, platforms, schedule,
 * caption, hashtags and declarations. Pure: never publishes, never writes.
 */
export function parseOwnerDirective(
  input: IntakeContractInput,
  overrides: { isAiGenerated?: boolean; isYourBrand?: boolean; isBrandedContent?: boolean } = {},
): ParsedIntakeJob {
  const keptSet = extractKeptSetOverride(input.message) ?? input.keptHashtags;
  const stops: IntakeStop[] = [];

  const clientFromMessage = extractClientName(input.message, input.clientIndex);
  const folderRef = extractDriveFolderRef(input.message);
  const contentRef = extractContentRef(input.message);

  // Client: from the message; for folder-only messages, the folder→client index resolves it.
  let clientName: string | null = clientFromMessage;
  let clientSource: InferredClientContext["source"] = "message";
  if (!clientName && folderRef) {
    const indexed = Object.keys(input.clientIndex).find((key) => input.clientIndex[key] === folderRef);
    if (indexed !== undefined) {
      clientName = indexed;
      clientSource = "asset_index";
    }
  }
  const client: InferredClientContext | null = clientName
    ? { clientName, source: clientSource }
    : null;
  if (!clientName) {
    stops.push({
      code: "unknown_client",
      gate: "client_asset_mapping",
      message: folderRef
        ? `Drive folder '${folderRef}' is not mapped to a client in the kept index. Confirm the client name mapping.`
        : "No client name found. Name the client (e.g. 'post client X flier …').",
      pendingOwnerDecisions: [
        folderRef ? `Map Drive folder '${folderRef}' to a client in the kept index.` : "Name the client for this job.",
      ],
    });
  } else if (!Object.prototype.hasOwnProperty.call(input.clientIndex, clientName)) {
    stops.push({
      code: "unknown_client",
      gate: "client_asset_mapping",
      message: `Client '${clientName}' is not in the kept index. Confirm the client name mapping.`,
      pendingOwnerDecisions: [`Add client '${clientName}' to the kept index (client → folder/content set).`],
    });
  }

  // Asset: content "…" (verbatim owner text) or Drive folder (batch slots); neither → the client-asset index decides.
  let asset: ParsedIntakeJob["asset"];
  if (contentRef !== null && folderRef !== null) {
    asset = { kind: "drive_folder", ref: folderRef, resolvedAssetIds: null };
    stops.push({
      code: "ambiguous_asset",
      gate: "client_asset_mapping",
      message: "Message names both quoted content and a Drive folder — the contract maps one asset source per message.",
      pendingOwnerDecisions: ["Re-send with either content \"…\" or a Drive folder, not both."],
    });
  } else if (contentRef !== null) {
    asset = { kind: "content", ref: contentRef, resolvedAssetIds: null };
  } else if (folderRef !== null) {
    asset = { kind: "drive_folder", ref: folderRef, resolvedAssetIds: null };
  } else {
    asset = { kind: "client_asset_index", ref: extractAssetNoun(input.message, input.clientIndex), resolvedAssetIds: null };
    stops.push({
      code: "no_resolved_asset",
      gate: "client_asset_mapping",
      message: `No asset stated. Give content "…", a Drive folder, or confirm the client-asset index maps client + '${extractAssetNoun(input.message, input.clientIndex) ?? "asset"}' to assets (asset-resolution lane).`,
      pendingOwnerDecisions: [
        "Provide the asset: content \"…\" or a Drive folder; or extend the client-asset index so the noun alone resolves.",
      ],
    });
  }

  // Platforms: none detected → default Instagram (the certified lane). Owner
  // explicitly stated unknown names (operator clause) → real `unknown_platform`
  // stop — never a silent default (QA round-1 blocking finding #2).
  let platforms = extractPlatformTokens(input.message);
  if (platforms.length === 0 && extractUnknownPlatformTokens(input.message).length === 0) {
    platforms = ["instagram"];
  }
  for (const unknownToken of extractUnknownPlatformTokens(input.message)) {
    stops.push({
      code: "unknown_platform",
      gate: "publishing_go",
      message: `Platform '${unknownToken}' is outside the five supported publishing platforms (Instagram, Facebook, LinkedIn, X, TikTok).`,
      pendingOwnerDecisions: [`Use one of Instagram / Facebook / LinkedIn / X / TikTok instead of '${unknownToken}'.`],
    });
  }
  if (platforms.length > 0) {
    for (const platform of platforms) {
      if (!isPublishingPlatform(platform)) {
        stops.push({
          code: "unknown_platform",
          gate: "publishing_go",
          message: `Platform '${platform}' is outside the five supported publishing platforms.`,
          pendingOwnerDecisions: [],
        });
      }
    }
  }

  // Schedule.
  const scheduleOrError = extractScheduleDate(input.message, input.now);
  let schedule: ParsedSchedule;
  if (firstStopCode(scheduleOrError)) {
    stops.push({
      code: scheduleOrError.error,
      gate: "publishing_go",
      message: scheduleOrError.message,
      pendingOwnerDecisions: ["Provide a future schedule date/time for this job."],
    });
    schedule = {
      timezone: GMT_DEFAULT_TIMEZONE,
      scheduledFor: "",
      source: "default",
      requestedWallClock: scheduleOrError.requestedWallClock,
    };
  } else {
    schedule = scheduleOrError;
    if (new Date(schedule.scheduledFor).getTime() <= new Date(input.now).getTime()) {
      stops.push({
        code: "past_date",
        gate: "publishing_go",
        message: `Requested time ${schedule.scheduledFor} is not in the future — Genesis refuses scheduled publish times in the past.`,
        pendingOwnerDecisions: ["Give a future date/time."],
      });
    }
  }

  // Caption: verbatim owner text → provided (owner-stated → approved by construction);
  // anything the intake itself cannot see (folder batch / asset index) → drafted, approved once per asset.
  const caption: CaptionSource =
    asset.kind === "content" && asset.ref !== null
      ? { kind: "provided", value: asset.ref, requiresApproval: false }
      : { kind: "drafted", value: null, requiresApproval: true };

  // Content approval: campaign-card record first, then the in-message approval phrase.
  const contentApproval: OwnerContentApproval | null =
    input.existingApproval ??
    (extractApprovalPhrase(input.message)
      ? {
          phrase: extractApprovalPhrase(input.message) as string,
          decidedAt: input.now,
          campaignCardId: null,
          record: "in_message",
        }
      : null);
  if (caption.requiresApproval && contentApproval === null) {
    stops.push({
      code: "caption_requires_approval",
      gate: "caption_approval",
      message: "Caption will be drafted — owner approves the campaign content ONCE per asset (stored on the campaign card, reusable for that asset's slots).",
      pendingOwnerDecisions: ["Approve the drafted campaign content once, on the campaign card."],
    });
  }

  // Hashtag + declaration policy, per platform.
  let hashtags: Record<string, HashtagPolicy> | null = null;
  let aiBrandDeclarations: Record<string, AIBrandDeclaration> | null = null;
  if (platforms.length > 0) {
    hashtags = {};
    aiBrandDeclarations = {};
    for (const platform of platforms) {
      hashtags[platform] = applyHashtagPolicy(platform, keptSet);
      aiBrandDeclarations[platform] = deriveAiBrandDeclaration(platform, overrides);
    }
  }

  return {
    client,
    asset,
    platforms,
    schedule,
    caption,
    hashtags,
    aiBrandDeclarations,
    contentApproval,
    stops,
    sourceMessage: input.message,
    contractVersion: "1.0",
  };
}

/** True when the parsed contract is ready to enter the governed publishing path: no stops, a future schedule, and assets RESOLVED by the asset-resolution lane (a parsed message alone never reaches publishing). */
export function isSchedulable(job: ParsedIntakeJob): boolean {
  if (job.stops.length !== 0) return false;
  if (job.schedule.scheduledFor === "") return false;
  if (job.asset.kind === "client_asset_index") return false;
  if (job.asset.resolvedAssetIds === null || job.asset.resolvedAssetIds.length === 0) return false;
  return true;
}