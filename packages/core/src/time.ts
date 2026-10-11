/** Milliseconds since the Unix epoch (UTC). All instants are stored and computed in UTC (FR-012). */
export type Instant = number;

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: Instant, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of the time zone from UTC at the given instant, in milliseconds (e.g. +8h for Singapore). */
export function timeZoneOffsetMs(instant: Instant, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / SECOND) * SECOND;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function parseDate(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Invalid date "${date}", expected YYYY-MM-DD`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseTime(time: string): [number, number] {
  const m = TIME_RE.exec(time);
  if (!m) throw new RangeError(`Invalid time "${time}", expected HH:MM`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw new RangeError(`Invalid time "${time}"`);
  return [hh, mm];
}

/**
 * Converts a wall-clock date and time in a time zone to a UTC instant.
 * Daylight-saving aware. A non-existent local time (inside a spring-forward gap)
 * resolves to the instant just after the gap.
 */
export function zonedToInstant(date: string, time: string, timeZone: string): Instant {
  const [y, mo, d] = parseDate(date);
  const [hh, mm] = parseTime(time);
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const firstOffset = timeZoneOffsetMs(guess, timeZone);
  let result = guess - firstOffset;
  const secondOffset = timeZoneOffsetMs(result, timeZone);
  if (secondOffset !== firstOffset) result = guess - secondOffset;
  return result;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(instant: Instant, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** ISO-8601 string in the given time zone, with its UTC offset, e.g. 2026-10-11T14:05:00+08:00. */
export function toZonedIsoString(instant: Instant, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const offsetMinutes = Math.round(timeZoneOffsetMs(instant, timeZone) / MINUTE);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function addDaysToDate(date: string, days: number): string {
  const [y, mo, d] = parseDate(date);
  const shifted = new Date(Date.UTC(y, mo - 1, d + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole days from date a to date b (b - a). */
export function daysBetweenDates(a: string, b: string): number {
  const [ya, ma, da] = parseDate(a);
  const [yb, mb, db] = parseDate(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, mo, d] = parseDate(date);
  const js = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function startOfLocalDay(instant: Instant, timeZone: string): Instant {
  return zonedToInstant(localDate(instant, timeZone), "00:00", timeZone);
}

/** Represents an instant for API consumers: UTC epoch, UTC ISO and the user's local ISO time. */
export interface DisplayTime {
  epochMs: Instant;
  utc: string;
  local: string;
  timeZone: string;
}

export function displayTime(instant: Instant, userTimeZone: string): DisplayTime {
  return {
    epochMs: instant,
    utc: new Date(instant).toISOString(),
    local: toZonedIsoString(instant, userTimeZone),
    timeZone: userTimeZone,
  };
}
