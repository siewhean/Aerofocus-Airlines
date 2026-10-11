import { mergeSpans, overlapMs, unattendedSpans, type AttendanceSignal, type TimeSpan } from "./attendance";
import type { BookingStatus, BookingTimes } from "./booking";
import { isLegFailed, itineraryLegBoardingWindow } from "./itinerary";
import { validationDeadline, type SessionOutcome } from "./outcome";
import type { CabinClass } from "./schedule";
import { MINUTE, type Instant } from "./time";

/*
 * Airport terminal state between legs, lounges, layover focus and connecting-flight notifications
 * (FR-042, FR-043). Pure: callers pass stored state and the current instant.
 */

/**
 * not_started: the arriving leg has not landed yet.
 * deplaning: landed; until the arriving leg is validated or its validation window closes (FR-015).
 * in_terminal: waiting for the next leg's boarding window.
 * boarding_open: the next leg's boarding window is open (connecting legs board like Community
 *   Flights: 15 minutes before planned departure until takeoff; see itineraryLegBoardingWindow).
 * missed: the next leg's boarding window closed without boarding (no-show → itinerary incomplete).
 * departed: the next leg was boarded; the layover is over.
 * cancelled: the next leg was cancelled (abandoned or failed itinerary).
 */
export type LayoverPhase = "not_started" | "deplaning" | "in_terminal" | "boarding_open" | "missed" | "departed" | "cancelled";

export interface LayoverInput {
  /** Layover airport IATA. */
  airport: string;
  /** Actual (or planned, before boarding) arrival of the leg landing at the layover airport. */
  arrival: Instant;
  /** When the arriving leg was validated, if it was. */
  validatedAt: Instant | null;
  /** Booking times of the departing next leg. */
  next: BookingTimes;
  nextStatus: BookingStatus;
  nextBoardedAt: Instant | null;
  now: Instant;
}

export interface LayoverState {
  phase: LayoverPhase;
  airport: string;
  startsAt: Instant;
  /** Planned departure of the next leg. */
  departsAt: Instant;
  /** departsAt − startsAt (FR-042). */
  layoverMs: number;
  deplaningEndsAt: Instant;
  boardingOpensAt: Instant;
  boardingClosesAt: Instant;
  /** Gate countdowns, never negative. */
  msToBoardingOpen: number;
  msToBoardingClose: number;
  msToDeparture: number;
}

export function layoverState(input: LayoverInput): LayoverState {
  // The departing leg is always a connecting leg (index ≥ 1).
  const window = itineraryLegBoardingWindow(input.next, 1);
  const deplaningEndsAt = input.validatedAt ?? validationDeadline(input.arrival);
  const { now } = input;
  let phase: LayoverPhase;
  if (input.nextStatus === "cancelled") phase = "cancelled";
  else if (input.nextBoardedAt !== null || input.nextStatus === "boarded") phase = "departed";
  else if (now < input.arrival) phase = "not_started";
  else if (input.nextStatus === "no_show" || now >= window.closesAt) phase = "missed";
  else if (now >= window.opensAt) phase = "boarding_open";
  else if (now < deplaningEndsAt) phase = "deplaning";
  else phase = "in_terminal";
  return {
    phase,
    airport: input.airport,
    startsAt: input.arrival,
    departsAt: input.next.plannedDeparture,
    layoverMs: input.next.plannedDeparture - input.arrival,
    deplaningEndsAt,
    boardingOpensAt: window.opensAt,
    boardingClosesAt: window.closesAt,
    msToBoardingOpen: Math.max(0, window.opensAt - now),
    msToBoardingClose: Math.max(0, window.closesAt - now),
    msToDeparture: Math.max(0, input.next.plannedDeparture - now),
  };
}

// ---------------------------------------------------------------------------------------------
// Lounges (FR-043): presentation only, never an unlock and never locked by progression (FR-066).
// ---------------------------------------------------------------------------------------------

export type LoungeAccess = "premium" | "terminal";

/** Cabins whose passengers see the premium lounge during a layover. Provisional. */
export const PREMIUM_LOUNGE_CABINS: readonly CabinClass[] = ["business", "first"];

/** Premium lounge when the arriving or the departing leg is booked in business or first. */
export function loungeAccess(arrivingCabin: CabinClass, departingCabin: CabinClass): LoungeAccess {
  return PREMIUM_LOUNGE_CABINS.includes(arrivingCabin) || PREMIUM_LOUNGE_CABINS.includes(departingCabin) ? "premium" : "terminal";
}

// ---------------------------------------------------------------------------------------------
// Layover focus (FR-043 optional focus session)
// ---------------------------------------------------------------------------------------------

export type LayoverEventType = "focus_start" | "focus_stop" | "beat";

export interface LayoverEvent {
  type: LayoverEventType;
  at: Instant;
}

export interface LayoverFocusSummary {
  /** Whether a layover focus session is running at `now`. */
  focusing: boolean;
  focusSpans: TimeSpan[];
  unattended: TimeSpan[];
  focusMs: number;
  /**
   * Attended focus inside the layover window (FR-013a 5-minute unattended rule), minus any time that
   * overlaps `exclude` (other flight sessions), so the same time is never credited twice.
   */
  creditedMs: number;
  /** True once the window has ended (next leg boarded or itinerary ended); credit is then final. */
  final: boolean;
}

/**
 * Layover focus credit. Only attended focus inside [window.start, window.end) counts; window.end is
 * when the next leg was boarded or the itinerary ended. A running session is cut at window.end.
 * Every layover event is proof the app is open, like a heartbeat. Time inside `exclude` (the
 * passenger's other flight sessions) is never credited.
 */
export function layoverFocus(
  events: readonly LayoverEvent[],
  window: TimeSpan,
  now: Instant,
  exclude: readonly TimeSpan[] = [],
): LayoverFocusSummary {
  const until = Math.min(window.end, now);
  const sorted = events.filter((e) => e.at >= window.start && e.at <= until).sort((a, b) => a.at - b.at);
  const focusSpans: TimeSpan[] = [];
  let openAt: Instant | null = null;
  for (const e of sorted) {
    if (e.type === "focus_start" && openAt === null) openAt = e.at;
    else if (e.type === "focus_stop" && openAt !== null) {
      if (e.at > openAt) focusSpans.push({ start: openAt, end: e.at });
      openAt = null;
    }
  }
  if (openAt !== null && until > openAt) focusSpans.push({ start: openAt, end: until });

  const signals: AttendanceSignal[] = sorted.map((e) => ({ at: e.at, kind: "beat" }));
  const unattended: TimeSpan[] = [];
  let focusMs = 0;
  let creditedMs = 0;
  for (const span of focusSpans) {
    const gaps = unattendedSpans(signals, span.start, span.end);
    unattended.push(...gaps);
    const length = span.end - span.start;
    focusMs += length;
    creditedMs += length - overlapMs(mergeSpans([...gaps, ...exclude]), span.start, span.end);
  }
  return { focusing: openAt !== null && now < window.end, focusSpans, unattended, focusMs, creditedMs, final: now >= window.end };
}

export type LayoverEventError = "outside_layover" | "already_focusing" | "not_focusing";

/** Whether a layover event may be recorded now. Beats are accepted any time inside the window. */
export function layoverEventError(
  events: readonly LayoverEvent[],
  type: LayoverEventType,
  window: TimeSpan,
  now: Instant,
): LayoverEventError | null {
  if (now < window.start || now >= window.end) return "outside_layover";
  if (type === "beat") return null;
  const focusing = layoverFocus(events, window, now).focusing;
  if (type === "focus_start" && focusing) return "already_focusing";
  if (type === "focus_stop" && !focusing) return "not_focusing";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Connecting-flight notifications. The server does not push; the client schedules local
// notifications from this plan and drops conditional ones (boarding_*, connection_missed) once the
// next leg is boarded.
// ---------------------------------------------------------------------------------------------

/** Reminder to validate after landing (FR-015 window is 10 minutes). Provisional. */
export const VALIDATE_REMINDER_AFTER_MS = 5 * MINUTE;
/** Warning before a connecting flight's boarding closes. Provisional. */
export const BOARDING_CLOSING_NOTICE_MS = 5 * MINUTE;

export type ItineraryNotificationType =
  | "leg_landed"
  | "validate_reminder"
  | "layover_started"
  | "lounge_available"
  | "boarding_open"
  | "boarding_closing"
  | "connection_missed"
  | "itinerary_complete";

const NOTIFICATION_ORDER: readonly ItineraryNotificationType[] = [
  "leg_landed",
  "validate_reminder",
  "layover_started",
  "lounge_available",
  "boarding_open",
  "boarding_closing",
  "connection_missed",
  "itinerary_complete",
];

export interface ItineraryNotification {
  type: ItineraryNotificationType;
  at: Instant;
  /** Leg the event belongs to: the landing leg for landing/layover events, the departing leg for boarding events. */
  legIndex: number;
}

export interface NotificationLegInput {
  times: BookingTimes;
  cabin: CabinClass;
  status: BookingStatus;
  /** Actual arrival once boarded; planned arrival is used otherwise. */
  arrival?: Instant | null;
  boardedAt?: Instant | null;
  validatedAt?: Instant | null;
  /** Session outcome once boarded. A failed leg (invalid, ended early) ends the plan. */
  outcome?: SessionOutcome | null;
}

/**
 * Ordered notification plan for an itinerary. Events before `after` (if given) are dropped.
 * itinerary_complete appears only once the final leg is validated (at its validation instant),
 * because completion is not known before then (FR-045). Once a leg has failed (no-show, invalid or
 * ended early, see isLegFailed) the itinerary is incomplete, so that leg and every later leg get no
 * landing, validation, layover or boarding events. Boarding events for a connecting leg use the
 * connecting-leg boarding window (itineraryLegBoardingWindow).
 */
export function itineraryNotificationPlan(
  legs: readonly NotificationLegInput[],
  options: { after?: Instant } = {},
): ItineraryNotification[] {
  const out: ItineraryNotification[] = [];
  const push = (type: ItineraryNotificationType, at: Instant, legIndex: number): void => {
    out.push({ type, at, legIndex });
  };
  let failed = false;
  legs.forEach((leg, i) => {
    if (failed) return;
    if (isLegFailed({ bookingStatus: leg.status, outcome: leg.outcome ?? null })) {
      failed = true;
      return;
    }
    if (leg.status === "cancelled") return;
    const arrival = leg.arrival ?? leg.times.plannedArrival;
    push("leg_landed", arrival, i);
    if (leg.validatedAt === null || leg.validatedAt === undefined) push("validate_reminder", arrival + VALIDATE_REMINDER_AFTER_MS, i);
    const next = legs[i + 1];
    if (!next) {
      if (leg.validatedAt !== null && leg.validatedAt !== undefined) push("itinerary_complete", leg.validatedAt, i);
      return;
    }
    if (next.status === "cancelled" || next.status === "no_show") return;
    push("layover_started", arrival, i);
    if (loungeAccess(leg.cabin, next.cabin) === "premium") push("lounge_available", arrival, i);
    const boarded = (next.boardedAt ?? null) !== null || next.status === "boarded";
    if (boarded) return;
    const window = itineraryLegBoardingWindow(next.times, i + 1);
    push("boarding_open", Math.max(window.opensAt, arrival), i + 1);
    push("boarding_closing", Math.max(window.closesAt - BOARDING_CLOSING_NOTICE_MS, arrival), i + 1);
    push("connection_missed", window.closesAt, i + 1);
  });
  return out
    .filter((n) => options.after === undefined || n.at >= options.after)
    .sort(
      (a, b) =>
        a.at - b.at ||
        a.legIndex - b.legIndex ||
        NOTIFICATION_ORDER.indexOf(a.type) - NOTIFICATION_ORDER.indexOf(b.type),
    );
}
