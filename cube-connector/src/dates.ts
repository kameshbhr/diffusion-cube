import { TIME_ZONE } from "./config.js";

/** Minutes east of UTC for `zone` at the instant `at`. */
function zoneOffsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Start of a calendar day (yyyy-mm-dd) in the team's time zone. */
function startOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  const offset = zoneOffsetMinutes(utcMidnight, TIME_ZONE);
  return new Date(utcMidnight.getTime() - offset * 60000);
}

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

/**
 * Reads a date input: "today", "yesterday", "N days ago", a plain date
 * (yyyy-mm-dd, read as the start of that day in the team's time zone), or a
 * full ISO date-time. Throws a plain-language error otherwise.
 */
export function parseDateInput(value: string, field: string): Date {
  const input = value.trim().toLowerCase();
  const today = startOfDay(todayYmd());
  const dayMs = 24 * 60 * 60 * 1000;

  if (input === "today") return today;
  if (input === "yesterday") return new Date(today.getTime() - dayMs);
  const ago = /^(\d{1,4})\s*(d|days?)(\s+ago)?$/.exec(input);
  if (ago) return new Date(today.getTime() - Number(ago[1]) * dayMs);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    // Reject impossible dates (2026-02-31) instead of rolling them over.
    const [y, m, d] = input.split("-").map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) {
      return startOfDay(input);
    }
  }
  // Full date-times must carry a zone (Z or +05:30), so they can't be misread.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})$/i.test(input)) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error(
    `${field} must be a date like 2026-11-13, an ISO date-time with a zone (2026-11-13T10:00:00+05:30), "today", "yesterday" or "7 days ago".`,
  );
}

export const DATE_INPUT_HELP =
  'A date like 2026-11-13 (read as the start of that day, team time), an ISO date-time with a zone, "today", "yesterday" or "7 days ago". "until" excludes that moment, so to include all of a day pass the next day.';
