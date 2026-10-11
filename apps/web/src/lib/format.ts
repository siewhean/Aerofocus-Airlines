import type { CabinClass, DisplayTime, FlightPhase, Instant } from "@aerofocus/core";
import { localParts, MINUTE, HOUR, DAY } from "@aerofocus/core";

/** "07:41:12" style countdown. Hours grow as needed; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "13h 05m" / "45m" for durations shown in tables and passes. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "2.5 h" for focus hour totals. */
export function formatHours(ms: number): string {
  const h = ms / HOUR;
  return h >= 10 ? `${Math.round(h)} h` : `${(Math.round(h * 10) / 10).toFixed(1)} h`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:32" in the user's time zone (FR-012). Accepts a DisplayTime or an instant plus zone. */
export function formatClock(time: DisplayTime | Instant, timeZone?: string): string {
  const { instant, tz } = normalise(time, timeZone);
  const p = localParts(instant, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Sun 12 Oct" in the user's time zone. */
export function formatDate(time: DisplayTime | Instant, timeZone?: string): string {
  const { instant, tz } = normalise(time, timeZone);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(instant);
}

/** "Sun 12 Oct, 14:32". */
export function formatDateTime(time: DisplayTime | Instant, timeZone?: string): string {
  return `${formatDate(time, timeZone)}, ${formatClock(time, timeZone)}`;
}

/** "today", "tomorrow", or a short date, relative to the user's local calendar. */
export function formatRelativeDay(time: DisplayTime | Instant, now: Instant, timeZone?: string): string {
  const { instant, tz } = normalise(time, timeZone);
  const a = localParts(instant, tz);
  const b = localParts(now, tz);
  const dayA = Date.UTC(a.year, a.month - 1, a.day);
  const dayB = Date.UTC(b.year, b.month - 1, b.day);
  const diff = Math.round((dayA - dayB) / DAY);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return formatDate(instant, tz);
}

function normalise(time: DisplayTime | Instant, timeZone?: string): { instant: Instant; tz: string } {
  if (typeof time === "number") return { instant: time, tz: timeZone ?? browserTimeZone() };
  return { instant: time.epochMs, tz: timeZone ?? time.timeZone };
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const PHASE_LABELS: Record<FlightPhase, string> = {
  taxi_out: "Taxiing to the runway",
  takeoff: "Taking off",
  climb: "Climbing",
  cruise: "Cruising",
  descent: "Descending",
  approach: "On approach",
  landing: "Landing",
  taxi_in: "Taxiing to the gate",
};

export function phaseLabel(phase: FlightPhase | null | undefined): string {
  return phase ? PHASE_LABELS[phase] : "At the gate";
}

const CABIN_LABELS: Record<CabinClass, string> = {
  economy: "Economy",
  premium_economy: "Premium Economy",
  business: "Business",
  first: "First",
  private: "Private",
};

export function cabinLabel(cabin: CabinClass | string): string {
  return (CABIN_LABELS as Record<string, string>)[cabin] ?? cabin;
}

export function modeLabel(mode: "community" | "depart_now" | "custom"): string {
  return mode === "community" ? "Community Flight" : mode === "depart_now" ? "Depart now" : "Custom departure";
}

export function altitudeLabel(ft: number): string {
  return ft <= 0 ? "On the ground" : `${Math.round(ft / 100) * 100} ft`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const MS = { MINUTE, HOUR, DAY };
