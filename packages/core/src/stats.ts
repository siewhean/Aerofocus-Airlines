import type { DepartureMode } from "./booking";
import type { ItineraryStatus } from "./itinerary";
import type { SessionOutcome } from "./outcome";
import type { RouteFacts } from "./route-facts";
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
  /** Present for server-side records; used by route achievements. */
  mode?: DepartureMode;
  facts?: RouteFacts;
  /** Multi-leg itinerary fields (FR-041, FR-050). Absent or null for single bookings. */
  itineraryId?: string | null;
  legIndex?: number | null;
  /** Number of legs in the itinerary. */
  itineraryLegs?: number | null;
  /** Current status of the whole itinerary. */
  itineraryStatus?: ItineraryStatus | null;
  /** True when this leg lands at an intermediate (layover) airport. */
  isTransit?: boolean;
  /** Layover spent at this leg's destination before the next leg departed; null until the next leg is boarded. */
  layoverMs?: number | null;
  /** Whether that layover had premium lounge access (FR-043). */
  premiumLounge?: boolean;
  /**
   * Final credited layover focus spent at this leg's destination (FR-043 optional focus session).
   * Counts towards credited focus (stats, levels) but not towards this leg's own flight credit.
   */
  layoverFocusMs?: number | null;
}

export interface CountryVisits {
  transit: number;
  final: number;
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
  /** Itineraries (any leg count) whose every leg completed (FR-045). */
  itinerariesCompleted: number;
  /** Completed itineraries with 2 or more legs. */
  multiLegItinerariesCompleted: number;
  /** Completed / finished (complete, incomplete, abandoned) multi-leg itineraries; null if none finished. */
  multiLegCompletionRate: number | null;
  /** Most legs in one completed itinerary (0 when none). */
  longestCompletedItineraryLegs: number;
  /** Distinct airports transited on completed legs (FR-050). */
  transitAirports: number;
  /** Distinct airports reached as a final destination (single flights included). */
  finalDestinations: number;
  /** Country → completed transit and final arrivals (FR-050). */
  countryVisits: Record<string, CountryVisits>;
  /** Time spent in completed layovers. Virtual; not physical travel (FR-054). */
  totalLayoverMs: number;
  /** Longest door-to-door time of a completed itinerary. */
  longestJourneyMs: number;
  /** Completed layovers with premium lounge access. */
  premiumLoungeLayovers: number;
}

/** Credited focus of a record including layover focus at its destination (FR-043). */
export function recordFocusMs(r: FlightRecord): number {
  return r.creditedFocusMs + (r.layoverFocusMs ?? 0);
}

/** Consecutive local days with credited focus (layover focus included), ending today or yesterday. */
export function studyStreakDays(records: readonly FlightRecord[], now: Instant, userTimeZone: string): number {
  const days = new Set(records.filter((r) => recordFocusMs(r) > 0).map((r) => localDate(r.arrival, userTimeZone)));
  const today = localDate(now, userTimeZone);
  let cursor = days.has(today) ? today : addDaysToDate(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDaysToDate(cursor, -1);
  }
  return streak;
}

interface ItinerarySummary {
  legCount: number;
  /** Whether any record carried itineraryLegs; without it the leg count is only a lower bound. */
  legCountKnown: boolean;
  status: ItineraryStatus | null;
  completedLegs: Set<number>;
  failed: boolean;
  departure: Instant;
  arrival: Instant;
}

/**
 * Groups records by itinerary. Status comes from the records; otherwise it is derived from leg
 * outcomes, but "complete" only when the itinerary's leg count (itineraryLegs) is known, because
 * missing later legs would otherwise look like a finished journey.
 */
function summarizeItineraries(records: readonly FlightRecord[]): ItinerarySummary[] {
  const groups = new Map<string, ItinerarySummary>();
  for (const r of records) {
    if (r.itineraryId === undefined || r.itineraryId === null) continue;
    const g = groups.get(r.itineraryId) ?? {
      legCount: 0,
      legCountKnown: false,
      status: null,
      completedLegs: new Set<number>(),
      failed: false,
      departure: r.departure,
      arrival: r.arrival,
    };
    g.legCount = Math.max(g.legCount, r.itineraryLegs ?? 0, (r.legIndex ?? 0) + 1);
    if (r.itineraryLegs !== undefined && r.itineraryLegs !== null) g.legCountKnown = true;
    g.status = g.status ?? r.itineraryStatus ?? null;
    if (r.outcome === "complete") g.completedLegs.add(r.legIndex ?? 0);
    else g.failed = true;
    g.departure = Math.min(g.departure, r.departure);
    g.arrival = Math.max(g.arrival, r.arrival);
    groups.set(r.itineraryId, g);
  }
  for (const g of groups.values()) {
    if (g.status === null) {
      if (g.legCountKnown && g.completedLegs.size >= g.legCount) g.status = "complete";
      else if (g.failed) g.status = "incomplete";
    }
  }
  return [...groups.values()];
}

export function computeStats(records: readonly FlightRecord[], now: Instant, userTimeZone: string): UserStats {
  const complete = records.filter((r) => r.outcome === "complete");
  const attempted = records.filter((r) => r.outcome !== "no_show");
  const focus = records.reduce((sum, r) => sum + recordFocusMs(r), 0);
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
    ...itineraryStats(records, complete),
  };
}

type ItineraryStats = Pick<
  UserStats,
  | "itinerariesCompleted"
  | "multiLegItinerariesCompleted"
  | "multiLegCompletionRate"
  | "longestCompletedItineraryLegs"
  | "transitAirports"
  | "finalDestinations"
  | "countryVisits"
  | "totalLayoverMs"
  | "longestJourneyMs"
  | "premiumLoungeLayovers"
>;

/** Multi-leg statistics (FR-050, FR-054). */
function itineraryStats(records: readonly FlightRecord[], complete: readonly FlightRecord[]): ItineraryStats {
  const itineraries = summarizeItineraries(records);
  const done = itineraries.filter((i) => i.status === "complete");
  const multi = itineraries.filter((i) => i.legCount >= 2);
  const multiDone = multi.filter((i) => i.status === "complete");
  const multiFinished = multi.filter((i) => i.status === "complete" || i.status === "incomplete" || i.status === "abandoned");
  const countryVisits: Record<string, CountryVisits> = {};
  for (const r of complete) {
    const v = (countryVisits[r.destinationCountry] ??= { transit: 0, final: 0 });
    if (r.isTransit) v.transit++;
    else v.final++;
  }
  const layovers = complete.filter((r) => r.isTransit && r.layoverMs !== undefined && r.layoverMs !== null);
  return {
    itinerariesCompleted: done.length,
    multiLegItinerariesCompleted: multiDone.length,
    multiLegCompletionRate: multiFinished.length > 0 ? multiDone.length / multiFinished.length : null,
    longestCompletedItineraryLegs: done.reduce((max, i) => Math.max(max, i.legCount), 0),
    transitAirports: new Set(complete.filter((r) => r.isTransit).map((r) => r.destination)).size,
    finalDestinations: new Set(complete.filter((r) => !r.isTransit).map((r) => r.destination)).size,
    countryVisits,
    totalLayoverMs: layovers.reduce((sum, r) => sum + (r.layoverMs as number), 0),
    longestJourneyMs: done.reduce((max, i) => Math.max(max, i.arrival - i.departure), 0),
    premiumLoungeLayovers: layovers.filter((r) => r.premiumLounge).length,
  };
}
