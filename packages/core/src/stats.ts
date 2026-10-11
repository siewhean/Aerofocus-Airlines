import type { SessionOutcome } from "./outcome";
import { addDaysToDate, localDate, type Instant } from "./time";

/** Finalised flight leg, as stored in history (FR-052). */
export interface FlightRecord {
  outcome: Exclude<SessionOutcome, "in_flight" | "awaiting_validation"> | "no_show";
  departure: Instant;
  arrival: Instant;
  blockMs: number;
  creditedFocusMs: number;
  breakMs: number;
  creditedFlightMs: number;
  origin: string;
  destination: string;
  destinationCountry: string;
  airline: string;
  aircraftType: string | null;
  distanceKm: number;
}

export interface UserStats {
  creditedFocusMs: number;
  /** Simulated flying time; not physical travel (FR-054). */
  simulatedFlightMs: number;
  completedFlights: number;
  airportsVisited: number;
  countriesCollected: number;
  /** Virtual distance; not physical travel (FR-054). */
  virtualDistanceKm: number;
  completionRate: number | null;
  focusToBreakRatio: number | null;
  longestCompletedFlightMs: number;
  currentStreakDays: number;
  airlineUsage: Record<string, number>;
  aircraftUsage: Record<string, number>;
}

/** Consecutive local days with credited focus, ending today or yesterday. */
export function studyStreakDays(records: readonly FlightRecord[], now: Instant, userTimeZone: string): number {
  const days = new Set(records.filter((r) => r.creditedFocusMs > 0).map((r) => localDate(r.arrival, userTimeZone)));
  const today = localDate(now, userTimeZone);
  let cursor = days.has(today) ? today : addDaysToDate(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDaysToDate(cursor, -1);
  }
  return streak;
}

export function computeStats(records: readonly FlightRecord[], now: Instant, userTimeZone: string): UserStats {
  const complete = records.filter((r) => r.outcome === "complete");
  const attempted = records.filter((r) => r.outcome !== "no_show");
  const focus = records.reduce((sum, r) => sum + r.creditedFocusMs, 0);
  const breaks = records.reduce((sum, r) => sum + r.breakMs, 0);
  const count = (key: (r: FlightRecord) => string | null): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of complete) {
      const k = key(r);
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  return {
    creditedFocusMs: focus,
    simulatedFlightMs: complete.reduce((sum, r) => sum + r.creditedFlightMs, 0),
    completedFlights: complete.length,
    airportsVisited: new Set(complete.flatMap((r) => [r.origin, r.destination])).size,
    countriesCollected: new Set(complete.map((r) => r.destinationCountry)).size,
    virtualDistanceKm: Math.round(complete.reduce((sum, r) => sum + r.distanceKm, 0)),
    completionRate: attempted.length > 0 ? complete.length / attempted.length : null,
    focusToBreakRatio: breaks > 0 ? focus / breaks : null,
    longestCompletedFlightMs: complete.reduce((max, r) => Math.max(max, r.blockMs), 0),
    currentStreakDays: studyStreakDays(records, now, userTimeZone),
    airlineUsage: count((r) => r.airline),
    aircraftUsage: count((r) => r.aircraftType),
  };
}
