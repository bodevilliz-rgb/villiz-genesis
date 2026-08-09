/**
 * Timezone-aware scheduling conversion — shared by the scheduling form
 * (client, for the live preview) and createScheduledPublishingJobAction
 * (server, authoritative). Uses only the built-in Intl API — no external
 * timezone library — so it works identically in the browser and in Node
 * without a new dependency.
 *
 * Root cause this replaces: the previous scheduling form offered "EST",
 * "PST", "GMT", "CET" — ambiguous non-IANA abbreviations — and the server
 * action did `new Date(scheduledAt).toISOString()` on the raw
 * datetime-local string, which JavaScript parses as the RUNTIME's own local
 * time (UTC on Vercel), silently ignoring whichever timezone the operator
 * selected entirely. Every scheduled post whose operator picked anything
 * other than a UTC-equivalent zone was scheduled for the wrong instant.
 */
import { ValidationError } from "@/core/domain/errors";

/** True only for a real IANA identifier (or "UTC") — rejects legacy/ambiguous abbreviations like "EST", "PST", "GMT", "CET", which either aren't real IANA zones or (worse) resolve to a fixed non-DST-aware offset. */
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  if (timeZone === "UTC") return true;
  // Intl silently accepts some 3-4 letter legacy codes on certain engines
  // (as fixed-offset aliases) — since those are exactly what this fix is
  // removing, explicitly reject anything that isn't a canonical Region/City
  // identifier (or single-word canonical zones the IANA database also
  // defines, e.g. "UTC", handled above).
  if (!/^[A-Za-z_]+\/[A-Za-z_/-]+$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The full canonical IANA timezone list, generic across every current and
 * future organisation/region (UK, US, Nigeria, anywhere) with zero
 * per-region code. Falls back to a small, clearly-non-exhaustive set only if
 * the runtime doesn't support Intl.supportedValuesOf (very old engines) —
 * scheduling itself always accepts any valid IANA zone regardless of what
 * this list contains; it only feeds the picker's option list.
 */
export function listSupportedTimeZones(): string[] {
  const intlWithSupportedValues = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intlWithSupportedValues.supportedValuesOf === "function") {
    try {
      return intlWithSupportedValues.supportedValuesOf("timeZone");
    } catch {
      // fall through to the static fallback below
    }
  }
  return ["UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Africa/Lagos", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];
}

/** The offset (in ms) that `timeZone` has AT `instant` — positive means the zone is ahead of UTC. */
function timeZoneOffsetMsAt(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(instant).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - instant.getTime();
}

/**
 * Converts a wall-clock local date/time (as produced by an
 * `<input type="datetime-local">`, e.g. "2026-08-15T14:00") in the given
 * IANA timezone into the one canonical UTC instant it represents — DST
 * included, since the offset is recomputed at the resolved instant rather
 * than assumed fixed.
 *
 * Throws ValidationError for: an unrecognised timezone, an unparseable
 * datetime, or a local time that does not exist in that timezone (a
 * spring-forward DST gap) — proven by re-rendering the resolved UTC instant
 * back through the same timezone and requiring it reproduce the exact
 * wall-clock the operator entered.
 */
export function convertLocalTimeToUtc(localDateTime: string, timeZone: string): Date {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new ValidationError(`"${timeZone}" is not a recognised timezone.`);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime);
  if (!match) {
    throw new ValidationError("That date and time could not be understood.");
  }
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr ?? "0");

  // Reject calendar-impossible values (e.g. month 13, day 32, hour 25) before
  // Date.UTC silently normalises them into a different date.
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new ValidationError("That date and time could not be understood.");
  }

  // Converge on the UTC instant whose wall-clock reading in `timeZone`
  // equals the requested local time. Two passes are enough: the offset can
  // only change across a DST boundary once between guesses of a date this
  // close together, and a second pass re-measures at the corrected instant.
  let guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 2; i += 1) {
    const offsetMs = timeZoneOffsetMsAt(new Date(guessUtcMs), timeZone);
    const correctedUtcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
    if (correctedUtcMs === guessUtcMs) break;
    guessUtcMs = correctedUtcMs;
  }

  const resolved = new Date(guessUtcMs);

  // Nonexistent local time (DST "spring forward" gap): re-reading the
  // resolved instant back through the same zone must reproduce the exact
  // wall-clock requested, or no such local time actually exists.
  const offsetMs = timeZoneOffsetMsAt(resolved, timeZone);
  const roundTripMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
  if (roundTripMs !== guessUtcMs) {
    throw new ValidationError(
      `${hourStr}:${minuteStr} on ${yearStr}-${monthStr}-${dayStr} does not exist in ${timeZone} (likely a daylight-saving transition). Choose a different time.`,
    );
  }

  return resolved;
}

/** Renders a UTC instant back as a local wall-clock string in the given timezone, for display only (e.g. the pre-publish review's "Scheduled for" summary). */
export function formatInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(instant);
}
