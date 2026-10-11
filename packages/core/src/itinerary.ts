import {
  boardedTimes,
  boardingDecision,
  boardingWindow,
  isWithinBookingWindow,
  plannedTimes,
  type BoardedTimes,
  type BoardingDecision,
  type BoardingWindow,
  type BookingStatus,
  type BookingTimes,
  type DepartureMode,
  type PlannedTimes,
  type StudyWindow,
} from "./booking";
import type { SessionOutcome } from "./outcome";
import { blockDurationMs, type Airport, type ScheduleSnapshot } from "./schedule";
import { HOUR, MINUTE, type Instant } from "./time";

/*
 * Multi-leg itineraries and scheduled layovers (FR-041, FR-042, FR-044, FR-045).
 * Pure and deterministic: callers supply schedule snapshots, booking state and the current instant.
 */

/** Minimum connection time when every airport of both connecting flights is in one country. Provisional. */
export const MIN_CONNECTION_DOMESTIC_MS = 45 * MINUTE;
/** Minimum connection time for every other connection. Provisional. */
export const MIN_CONNECTION_INTERNATIONAL_MS = 60 * MINUTE;
/** Longest scheduled layover offered (FR-042). Provisional. */
export const MAX_LAYOVER_MS = 24 * HOUR;
/** At most two connections, i.e. three legs (FR-041). Provisional. */
export const MAX_CONNECTIONS = 2;
export const MAX_ITINERARY_LEGS = MAX_CONNECTIONS + 1;

export interface MinimumConnectionOverride {
  domesticMs?: number;
  internationalMs?: number;
}

/** Per-airport minimum connection time overrides, keyed by layover airport IATA. Empty for now. */
export const MIN_CONNECTION_OVERRIDES: Readonly<Record<string, MinimumConnectionOverride>> = {};

/** The parts of a flight a connection check needs. ScheduleSnapshot and planned leg times both fit. */
export interface ConnectionLeg {
  origin: string;
  destination: string;
  departure: Instant;
  arrival: Instant;
}

export type ConnectionError = "not_chained" | "unknown_airport" | "below_minimum_connection" | "layover_too_long";

export interface ConnectionCheck {
  ok: boolean;
  reason: ConnectionError | null;
  /** Next departure − previous arrival (FR-042). */
  layoverMs: number;
  minimumConnectionMs: number | null;
  /** Domestic when the previous origin, the layover airport and the next destination share a country. */
  domestic: boolean | null;
}

/** Layover between two legs: next leg departure instant − previous leg arrival instant (FR-042). */
export function publishedLayoverMs(prev: Pick<ConnectionLeg, "arrival">, next: Pick<ConnectionLeg, "departure">): number {
  return next.departure - prev.arrival;
}

/** Whether a connection is domestic, or null when an airport is unknown. */
export function isDomesticConnection(
  prev: Pick<ConnectionLeg, "origin" | "destination">,
  next: Pick<ConnectionLeg, "destination">,
  airportsByIata: ReadonlyMap<string, Airport>,
): boolean | null {
  const from = airportsByIata.get(prev.origin);
  const via = airportsByIata.get(prev.destination);
  const to = airportsByIata.get(next.destination);
  if (!from || !via || !to) return null;
  return from.country === via.country && to.country === via.country;
}

/** Minimum connection time at the layover airport, or null when an airport is unknown. */
export function minimumConnectionMs(
  prev: Pick<ConnectionLeg, "origin" | "destination">,
  next: Pick<ConnectionLeg, "destination">,
  airportsByIata: ReadonlyMap<string, Airport>,
  overrides: Readonly<Record<string, MinimumConnectionOverride>> = MIN_CONNECTION_OVERRIDES,
): number | null {
  const domestic = isDomesticConnection(prev, next, airportsByIata);
  if (domestic === null) return null;
  const override = overrides[prev.destination];
  return domestic
    ? (override?.domesticMs ?? MIN_CONNECTION_DOMESTIC_MS)
    : (override?.internationalMs ?? MIN_CONNECTION_INTERNATIONAL_MS);
}

/** Checks one connection: chaining, minimum connection time and maximum layover (FR-041, FR-042). */
export function connectionFeasibility(
  prev: ConnectionLeg,
  next: ConnectionLeg,
  airportsByIata: ReadonlyMap<string, Airport>,
  overrides: Readonly<Record<string, MinimumConnectionOverride>> = MIN_CONNECTION_OVERRIDES,
): ConnectionCheck {
  const layoverMs = publishedLayoverMs(prev, next);
  const domestic = isDomesticConnection(prev, next, airportsByIata);
  const minimum = minimumConnectionMs(prev, next, airportsByIata, overrides);
  const result = (reason: ConnectionError | null): ConnectionCheck => ({
    ok: reason === null,
    reason,
    layoverMs,
    minimumConnectionMs: minimum,
    domestic,
  });
  if (prev.destination !== next.origin) return result("not_chained");
  if (minimum === null) return result("unknown_airport");
  if (layoverMs < minimum) return result("below_minimum_connection");
  if (layoverMs > MAX_LAYOVER_MS) return result("layover_too_long");
  return result(null);
}

export type ItineraryError =
  | ConnectionError
  | "no_legs"
  | "too_many_legs"
  | "airport_revisited"
  | "outside_booking_window";

export interface ItineraryValidationError {
  /** Leg the problem was found on (for connections, the later leg). */
  legIndex: number;
  error: ItineraryError;
}

/**
 * Validates an itinerary's legs (FR-041): 1–3 legs, chained, no airport visited twice, feasible
 * connections and, when `now` and `userTimeZone` are given, every leg's planned departure within the
 * booking window (FR-002). Planned departures come from itineraryPlannedTimes, so later legs of an
 * individual itinerary are checked at their chained time, not the published one. Returns an empty
 * list when the itinerary is allowed. Per-leg booking rules (cabin, unlocks) are still checked with
 * checkBookingRequest.
 */
export function validateItinerary(
  legs: readonly ScheduleSnapshot[],
  airportsByIata: ReadonlyMap<string, Airport>,
  options: {
    now?: Instant;
    userTimeZone?: string;
    /** Defaults to "community" (published times). */
    mode?: ItineraryMode;
    /** First-leg Custom Departure for individual itineraries; depart now when absent. */
    chosenDeparture?: Instant | null;
    overrides?: Readonly<Record<string, MinimumConnectionOverride>>;
  } = {},
): ItineraryValidationError[] {
  const errors: ItineraryValidationError[] = [];
  if (legs.length === 0) return [{ legIndex: 0, error: "no_legs" }];
  if (legs.length > MAX_ITINERARY_LEGS) errors.push({ legIndex: MAX_ITINERARY_LEGS, error: "too_many_legs" });
  const visited = new Set<string>([legs[0]!.origin]);
  const plans =
    options.now !== undefined && options.userTimeZone !== undefined
      ? itineraryPlannedTimes(options.mode ?? "community", legs, { now: options.now, chosenDeparture: options.chosenDeparture ?? null })
      : null;
  legs.forEach((leg, i) => {
    if (!airportsByIata.has(leg.origin) || !airportsByIata.has(leg.destination)) {
      errors.push({ legIndex: i, error: "unknown_airport" });
    }
    if (visited.has(leg.destination)) errors.push({ legIndex: i, error: "airport_revisited" });
    visited.add(leg.destination);
    if (plans && options.now !== undefined && options.userTimeZone !== undefined) {
      if (!isWithinBookingWindow((plans[i] as ItineraryLegPlan).departure, options.now, options.userTimeZone)) {
        errors.push({ legIndex: i, error: "outside_booking_window" });
      }
    }
    const prev = legs[i - 1];
    if (prev) {
      const check = connectionFeasibility(prev, leg, airportsByIata, options.overrides);
      if (check.reason && check.reason !== "unknown_airport") errors.push({ legIndex: i, error: check.reason });
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Connection search
// ---------------------------------------------------------------------------------------------

export interface ConnectionLayover {
  airport: string;
  layoverMs: number;
  minimumConnectionMs: number;
  domestic: boolean;
}

export interface ConnectionOption {
  legs: ScheduleSnapshot[];
  layovers: ConnectionLayover[];
  /** First leg published departure. */
  departure: Instant;
  /** Last leg published arrival. */
  arrival: Instant;
  /** Door-to-door journey time at published times. */
  totalMs: number;
  connections: number;
  direct: boolean;
}

export interface ConnectionSearchInput {
  /** Departures for the booking window, e.g. from ScheduleProvider.listDepartures. */
  departures: readonly ScheduleSnapshot[];
  origin: string;
  destination: string;
  airportsByIata: ReadonlyMap<string, Airport>;
  /** 0–2. Defaults to MAX_CONNECTIONS. */
  maxConnections?: number;
  /** Include direct flights (flagged direct: true). Default true. */
  includeDirect?: boolean;
  /**
   * Whole journey must fit inside the window at published times (FR-006). Meaningful for
   * community itineraries; individual itineraries shift with the first departure.
   */
  studyWindow?: StudyWindow | null;
  /** Skip first legs departing before this instant. */
  notBefore?: Instant;
  limit?: number;
  overrides?: Readonly<Record<string, MinimumConnectionOverride>>;
}

/** Index of the first element whose departure is >= t (arr is sorted by departure). */
function lowerBound(arr: readonly ScheduleSnapshot[], t: Instant): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arr[mid] as ScheduleSnapshot).departure < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Finds direct, 1-stop and 2-stop itineraries from origin to destination (FR-041). Departures are
 * indexed by origin and sorted, so each extension only scans the departures inside the feasible
 * layover range. Results are sorted by total journey time, then departure.
 */
export function searchConnections(input: ConnectionSearchInput): ConnectionOption[] {
  const maxConnections = Math.max(0, Math.min(MAX_CONNECTIONS, input.maxConnections ?? MAX_CONNECTIONS));
  const includeDirect = input.includeDirect ?? true;
  const window = input.studyWindow ?? null;
  const shortestMinimum = Math.min(
    MIN_CONNECTION_DOMESTIC_MS,
    MIN_CONNECTION_INTERNATIONAL_MS,
    ...Object.values(input.overrides ?? MIN_CONNECTION_OVERRIDES).flatMap((o) => [
      o.domesticMs ?? Number.POSITIVE_INFINITY,
      o.internationalMs ?? Number.POSITIVE_INFINITY,
    ]),
  );

  const byOrigin = new Map<string, ScheduleSnapshot[]>();
  for (const s of input.departures) {
    const list = byOrigin.get(s.origin) ?? [];
    list.push(s);
    byOrigin.set(s.origin, list);
  }
  for (const list of byOrigin.values()) list.sort((a, b) => a.departure - b.departure);

  const results: ConnectionOption[] = [];
  const path: ScheduleSnapshot[] = [];
  const layovers: ConnectionLayover[] = [];
  const visited = new Set<string>([input.origin]);

  const extend = (): void => {
    const last = path[path.length - 1] as ScheduleSnapshot;
    if (window && last.arrival > window.end) return;
    if (last.destination === input.destination) {
      if (path.length > 1 || includeDirect) {
        const first = path[0] as ScheduleSnapshot;
        results.push({
          legs: [...path],
          layovers: layovers.map((l) => ({ ...l })),
          departure: first.departure,
          arrival: last.arrival,
          totalMs: last.arrival - first.departure,
          connections: path.length - 1,
          direct: path.length === 1,
        });
      }
      return;
    }
    if (path.length > maxConnections) return;
    const candidates = byOrigin.get(last.destination);
    if (!candidates) return;
    for (let i = lowerBound(candidates, last.arrival + shortestMinimum); i < candidates.length; i++) {
      const next = candidates[i] as ScheduleSnapshot;
      if (next.departure - last.arrival > MAX_LAYOVER_MS) break;
      if (visited.has(next.destination)) continue;
      const check = connectionFeasibility(last, next, input.airportsByIata, input.overrides);
      if (!check.ok) continue;
      path.push(next);
      layovers.push({
        airport: next.origin,
        layoverMs: check.layoverMs,
        minimumConnectionMs: check.minimumConnectionMs as number,
        domestic: check.domestic as boolean,
      });
      visited.add(next.destination);
      extend();
      visited.delete(next.destination);
      layovers.pop();
      path.pop();
    }
  };

  for (const first of byOrigin.get(input.origin) ?? []) {
    if (input.notBefore !== undefined && first.departure < input.notBefore) continue;
    if (window && first.departure < window.start) continue;
    // Legs to or from airports missing from reference data cannot be shown or booked.
    if (!input.airportsByIata.has(first.origin) || !input.airportsByIata.has(first.destination)) continue;
    if (visited.has(first.destination)) continue;
    path.push(first);
    visited.add(first.destination);
    extend();
    visited.delete(first.destination);
    path.pop();
  }

  results.sort((a, b) => a.totalMs - b.totalMs || a.departure - b.departure || a.connections - b.connections);
  return input.limit !== undefined ? results.slice(0, Math.max(0, input.limit)) : results;
}

// ---------------------------------------------------------------------------------------------
// Planned times
// ---------------------------------------------------------------------------------------------

/**
 * community: every leg is a Community Flight at published times.
 * individual: leg 1 departs now or at a chosen time; each later leg departs at the previous leg's
 * actual arrival plus the published layover between the two scheduled flights.
 */
export type ItineraryMode = "community" | "individual";

export interface ItineraryLegPlan extends PlannedTimes {
  legIndex: number;
  /** Booking mode for this leg. Later individual legs are Custom Departures at the computed time. */
  mode: DepartureMode;
}

/** Planned times of every leg at booking time (FR-041, FR-042). */
export function itineraryPlannedTimes(
  mode: ItineraryMode,
  legs: readonly ScheduleSnapshot[],
  options: { now: Instant; firstLegMode?: "depart_now" | "custom"; chosenDeparture?: Instant | null },
): ItineraryLegPlan[] {
  if (mode === "community") {
    return legs.map((s, legIndex) => ({ legIndex, mode: "community", ...plannedTimes("community", s, { now: options.now }) }));
  }
  const firstMode =
    options.firstLegMode ?? (options.chosenDeparture !== undefined && options.chosenDeparture !== null ? "custom" : "depart_now");
  const plans: ItineraryLegPlan[] = [];
  legs.forEach((s, legIndex) => {
    if (legIndex === 0) {
      plans.push({ legIndex, mode: firstMode, ...plannedTimes(firstMode, s, { now: options.now, chosenDeparture: options.chosenDeparture ?? null }) });
      return;
    }
    const prevPlan = plans[legIndex - 1] as ItineraryLegPlan;
    const departure = prevPlan.arrival + publishedLayoverMs(legs[legIndex - 1] as ScheduleSnapshot, s);
    plans.push({ legIndex, mode: "custom", departure, arrival: departure + blockDurationMs(s) });
  });
  return plans;
}

/**
 * Recomputes planned times once a leg's actual block times are known (it was boarded). Individual
 * itineraries shift every later leg so the published layover is kept; community legs keep published
 * times. Pass the most recently boarded leg; legs after it must not be boarded yet.
 */
export function recomputeItineraryTimes(
  mode: ItineraryMode,
  legs: readonly ScheduleSnapshot[],
  plans: readonly ItineraryLegPlan[],
  actual: { legIndex: number; departure: Instant; arrival: Instant },
): ItineraryLegPlan[] {
  const out = plans.map((p) => ({ ...p }));
  const target = out[actual.legIndex];
  if (!target) throw new RangeError(`No leg ${actual.legIndex}`);
  target.departure = actual.departure;
  target.arrival = actual.arrival;
  if (mode === "community") return out;
  for (let i = actual.legIndex + 1; i < out.length; i++) {
    const prev = out[i - 1] as ItineraryLegPlan;
    const leg = out[i] as ItineraryLegPlan;
    leg.departure = prev.arrival + publishedLayoverMs(legs[i - 1] as ScheduleSnapshot, legs[i] as ScheduleSnapshot);
    leg.arrival = leg.departure + blockDurationMs(legs[i] as ScheduleSnapshot);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Itinerary status
// ---------------------------------------------------------------------------------------------

/** booked → in_progress → complete | incomplete | abandoned | cancelled (FR-044, FR-045). */
export type ItineraryStatus = "booked" | "in_progress" | "complete" | "incomplete" | "abandoned" | "cancelled";

export interface ItineraryLegProgress {
  bookingStatus: BookingStatus;
  /** Session outcome, or null when the leg has not been boarded. */
  outcome: SessionOutcome | null;
}

const FAILED_OUTCOMES: readonly SessionOutcome[] = ["invalid", "ended_early"];

export function isLegFailed(leg: ItineraryLegProgress): boolean {
  return leg.bookingStatus === "no_show" || (leg.outcome !== null && FAILED_OUTCOMES.includes(leg.outcome));
}

/**
 * Itinerary status from per-leg booking status and session outcome. Complete only when every leg's
 * outcome is "complete" (FR-045). Any failed leg (invalid, ended early, no-show) makes the itinerary
 * incomplete. Abandoning marks it abandoned, which counts as incomplete (FR-044).
 */
export function itineraryStatus(legs: readonly ItineraryLegProgress[], options: { abandoned?: boolean } = {}): ItineraryStatus {
  if (legs.length > 0 && legs.every((l) => l.outcome === "complete")) return "complete";
  if (options.abandoned) return "abandoned";
  if (legs.some(isLegFailed)) return "incomplete";
  const boarded = legs.some((l) => l.outcome !== null || l.bookingStatus === "boarded");
  if (legs.length === 0 || legs.every((l) => l.bookingStatus === "cancelled")) return "cancelled";
  if (legs.some((l) => l.bookingStatus === "cancelled")) return boarded ? "incomplete" : "cancelled";
  return boarded ? "in_progress" : "booked";
}

/** Statuses that never change again (FR-044, FR-045). */
export const CLOSED_ITINERARY_STATUSES: readonly ItineraryStatus[] = ["complete", "incomplete", "abandoned", "cancelled"];

/** Open itineraries reserve their whole journey (see the API's flight-conflict rule). */
export const OPEN_ITINERARY_STATUSES: readonly ItineraryStatus[] = ["booked", "in_progress"];

export function isItineraryClosed(status: ItineraryStatus): boolean {
  return CLOSED_ITINERARY_STATUSES.includes(status);
}

/**
 * An itinerary can be abandoned while it is open and at least one leg is still booked and not
 * boarded (FR-044). With nothing left to cancel (e.g. only the final leg in flight) abandoning would
 * have no effect and would let the status move from "abandoned" back to "complete" once that leg
 * lands, so it is refused.
 */
export function canAbandonItinerary(legs: readonly ItineraryLegProgress[], options: { abandoned?: boolean } = {}): boolean {
  if (isItineraryClosed(itineraryStatus(legs, options))) return false;
  return legs.some((l) => l.bookingStatus === "booked" && l.outcome === null);
}

/**
 * Legs to cancel: once an itinerary is incomplete, abandoned or cancelled, every later leg that has
 * not been boarded. A leg in flight is never cancelled; legs already flown keep their rewards (FR-044).
 */
export function legsToCancel(legs: readonly ItineraryLegProgress[], status: ItineraryStatus): number[] {
  if (status !== "incomplete" && status !== "abandoned" && status !== "cancelled") return [];
  const out: number[] = [];
  legs.forEach((l, i) => {
    if (l.bookingStatus === "booked" && l.outcome === null) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Connecting-leg boarding. Every leg after the first boards like a Community Flight regardless of
// itinerary mode: boarding opens 15 minutes before planned departure (COMMUNITY_BOARDING_OPENS_MS)
// and closes at takeoff (planned departure + taxi-out end). After that the connection is missed
// (no-show). A connecting passenger who boards after planned departure but before takeoff joins in
// progress, like a late Community Flight passenger: the leg keeps its planned (re-chained) times and
// focus is credited from boarding. Provisional.
// ---------------------------------------------------------------------------------------------

/** Booking times used for boarding rules: the first leg keeps its own mode, later legs board as Community Flights. */
export function legBoardingTimes(b: BookingTimes, legIndex: number): BookingTimes {
  return legIndex > 0 ? { ...b, mode: "community" } : b;
}

/** Boarding window of an itinerary leg (FR-004 for the first leg; community-style for connecting legs). */
export function itineraryLegBoardingWindow(b: BookingTimes, legIndex: number): BoardingWindow {
  return boardingWindow(legBoardingTimes(b, legIndex));
}

/** Boarding decision of an itinerary leg; "no_show" for a connecting leg is a missed connection. */
export function itineraryLegBoardingDecision(b: BookingTimes, legIndex: number, now: Instant): BoardingDecision {
  return boardingDecision(legBoardingTimes(b, legIndex), now);
}

/** Times once an itinerary leg is boarded; late connecting passengers join in progress. */
export function itineraryLegBoardedTimes(b: BookingTimes, legIndex: number, boardedAt: Instant): BoardedTimes {
  return boardedTimes(legBoardingTimes(b, legIndex), boardedAt);
}

export type LegBoardingBlock = "itinerary_closed" | "previous_leg_not_boarded" | "previous_leg_not_landed" | "previous_leg_failed";

/**
 * Whether leg `legIndex` may be boarded yet: the previous leg must have been flown and landed (its
 * validation may still be pending). Returns null when nothing blocks boarding; the leg's own
 * boarding window is still checked with boardingDecision.
 */
export function legBoardingBlock(
  legs: readonly (ItineraryLegProgress & { arrival: Instant | null })[],
  legIndex: number,
  now: Instant,
  options: { abandoned?: boolean } = {},
): LegBoardingBlock | null {
  if (isItineraryClosed(itineraryStatus(legs, options))) return "itinerary_closed";
  const prev = legs[legIndex - 1];
  if (!prev) return null;
  if (isLegFailed(prev)) return "previous_leg_failed";
  if (prev.outcome === null || prev.arrival === null) return "previous_leg_not_boarded";
  if (now < prev.arrival) return "previous_leg_not_landed";
  return null;
}

/**
 * Where the passenger is now, for rebooking (FR-044): the destination of the last completed leg, or
 * the itinerary origin if no leg was completed.
 */
export function currentItineraryAirport(
  origin: string,
  legs: readonly { destination: string; outcome: SessionOutcome | null }[],
): string {
  let airport = origin;
  for (const leg of legs) {
    if (leg.outcome !== "complete") break;
    airport = leg.destination;
  }
  return airport;
}
