/**
 * Timezone-aware scheduling conversion — fix/scheduled-publishing-integrity.
 *
 * Root cause this replaces: createScheduledPublishingJobAction did
 * `new Date(scheduledAt).toISOString()` on a raw <input type="datetime-local">
 * string with no timezone offset — JavaScript parses that as the RUNTIME's
 * own local time (UTC on Vercel), completely ignoring whichever IANA/legacy
 * timezone the operator selected. The selector itself offered only
 * ambiguous, non-DST-aware abbreviations (EST/PST/GMT/CET).
 *
 * T1  — Europe/London summer time (BST, UTC+1) converts correctly
 * T2  — Europe/London winter time (GMT, UTC+0) converts correctly
 * T3  — America/New_York DST (EDT, UTC-4) converts correctly
 * T4  — America/New_York standard time (EST, UTC-5) converts correctly
 * T5  — a third, non-UK/US region (Africa/Lagos, UTC+1, no DST) works with the same code — proves genericity
 * T6  — UTC itself round-trips exactly
 * T7  — an invalid/unrecognised timezone is rejected cleanly
 * T8  — legacy ambiguous abbreviations (EST, PST, GMT, BST) are rejected, not silently accepted
 * T9  — a malformed datetime string is rejected cleanly
 * T10 — a calendar-impossible time (25:00) is rejected cleanly
 * T11 — formatInTimeZone renders the same instant differently per zone (display only, never re-derives the instant)
 * T12 — listSupportedTimeZones returns a large, generic IANA list (not a hardcoded regional subset)
 */

import { describe, expect, it } from "vitest";
import { convertLocalTimeToUtc, isValidIanaTimeZone, formatInTimeZone, listSupportedTimeZones } from "@/core/domain/entities/scheduling";
import { ValidationError } from "@/core/domain/errors";

describe("T1/T2 — Europe/London — summer (BST) and winter (GMT) both convert correctly", () => {
  it("15 July 14:00 London time (BST, UTC+1) is 13:00 UTC", () => {
    const result = convertLocalTimeToUtc("2026-07-15T14:00", "Europe/London");
    expect(result.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("15 January 14:00 London time (GMT, UTC+0) is 14:00 UTC", () => {
    const result = convertLocalTimeToUtc("2026-01-15T14:00", "Europe/London");
    expect(result.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
});

describe("T3/T4 — America/New_York — DST (EDT) and standard (EST) both convert correctly", () => {
  it("15 July 09:00 New York time (EDT, UTC-4) is 13:00 UTC", () => {
    const result = convertLocalTimeToUtc("2026-07-15T09:00", "America/New_York");
    expect(result.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("15 January 09:00 New York time (EST, UTC-5) is 14:00 UTC", () => {
    const result = convertLocalTimeToUtc("2026-01-15T09:00", "America/New_York");
    expect(result.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
});

describe("T5 — a non-UK/US region works through the identical code path", () => {
  it("Africa/Lagos (UTC+1 year-round, no DST) converts correctly with no region-specific code", () => {
    const result = convertLocalTimeToUtc("2026-07-15T14:00", "Africa/Lagos");
    expect(result.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });
});

describe("T6 — UTC round-trips exactly", () => {
  it("a UTC-zoned local time equals the same instant verbatim", () => {
    const result = convertLocalTimeToUtc("2026-07-15T14:00", "UTC");
    expect(result.toISOString()).toBe("2026-07-15T14:00:00.000Z");
  });
});

describe("T7 — an invalid timezone is rejected cleanly", () => {
  it("throws ValidationError for a nonexistent zone name", () => {
    expect(() => convertLocalTimeToUtc("2026-07-15T14:00", "Not/AZone")).toThrow(ValidationError);
  });

  it("isValidIanaTimeZone returns false for garbage input", () => {
    expect(isValidIanaTimeZone("")).toBe(false);
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
  });
});

describe("T8 — legacy ambiguous abbreviations are rejected, not silently accepted", () => {
  it.each(["EST", "PST", "GMT", "BST", "CET"])("%s is not accepted as a valid scheduling timezone", (abbrev) => {
    expect(isValidIanaTimeZone(abbrev)).toBe(false);
    expect(() => convertLocalTimeToUtc("2026-07-15T14:00", abbrev)).toThrow(ValidationError);
  });

  it("UTC remains valid — the one unambiguous non-Region/City identifier", () => {
    expect(isValidIanaTimeZone("UTC")).toBe(true);
  });
});

describe("T9 — a malformed datetime string is rejected cleanly", () => {
  it("throws ValidationError for garbage input", () => {
    expect(() => convertLocalTimeToUtc("not-a-date", "UTC")).toThrow(ValidationError);
    expect(() => convertLocalTimeToUtc("", "UTC")).toThrow(ValidationError);
  });
});

describe("T10 — a calendar-impossible time is rejected cleanly", () => {
  it("throws ValidationError for hour 25", () => {
    expect(() => convertLocalTimeToUtc("2026-07-15T25:00", "UTC")).toThrow(ValidationError);
  });

  it("throws ValidationError for month 13", () => {
    expect(() => convertLocalTimeToUtc("2026-13-01T10:00", "UTC")).toThrow(ValidationError);
  });
});

describe("T11 — formatInTimeZone is display-only and never re-derives the instant", () => {
  it("the same UTC instant renders as different local wall-clock strings per zone", () => {
    const instant = new Date("2026-07-15T13:00:00.000Z");
    const london = formatInTimeZone(instant, "Europe/London");
    const newYork = formatInTimeZone(instant, "America/New_York");
    expect(london).not.toBe(newYork);
    expect(london).toContain("2026");
  });
});

describe("T12 — listSupportedTimeZones is a large, generic IANA list", () => {
  it("returns well over a hundred zones — not a hardcoded regional subset", () => {
    const zones = listSupportedTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain("Europe/London");
    expect(zones).toContain("America/New_York");
    expect(zones).toContain("Africa/Lagos");
  });
});
