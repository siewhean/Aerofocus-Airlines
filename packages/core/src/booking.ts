import { buildPhasePlan, takeoffOffsetMs } from "./phases";
import { blockDurationMs, offeredCabins, type CabinClass, type ScheduleSnapshot } from "./schedule";
import { addDaysToDate, localDate, MINUTE, SECOND, zonedToInstant, type Instant } from "./time";

/** Flights can be booked from today up to 7 days ahead (FR-002). */
export const BOOKING_WINDOW_DAYS = 7;
/** Community Flight boarding opens 15 minutes before published departure (FR-004). */
export const COMMUNITY_BOARDING_OPENS_MS = 15 * MINUTE;
/** Preflight boarding sequence length (FR-009: 60–120 seconds). */
export const BOARDING_SEQUENCE_MS = 90 * SECOND;

/**
 * community: departs at the published time, shared with every passenger on that flight number and date.
 * depart_now: individual flight starting right after boarding.
 * custom: individual flight departing at a time the user chooses.
 */
export type DepartureMode = "community" | "depart_now" | "custom";

export type BookingStatus = "booked" | "boarded" | "no_show" | "cancelled";

/** End of the booking window: midnight after the 7th day following today, in the user's time zone. */
export function bookingWindowEnd(now: Instant, userTimeZone: string): Instant {
  return zonedToInstant(addDaysToDate(localDate(now, userTimeZone), BOOKING_WINDOW_DAYS + 1), "00:00", userTimeZone);
}

export function isWithinBookingWindow(departure: Instant, now: Instant, userTimeZone: string): boolean {
  return departure < bookingWindowEnd(now, userTimeZone);
}

export interface StudyWindow {
  start: Instant;
  end: Instant;
}

export interface PlannedTimes {
  departure: Instant;
  arrival: Instant;
}

/** Planned block times for a booking. Individual flights keep the published duration (FR-004). */
export function plannedTimes(
  mode: DepartureMode,
  snapshot: ScheduleSnapshot,
  options: { now: Instant; chosenDeparture?: Instant | null },
): PlannedTimes {
  const block = blockDurationMs(snapshot);
  switch (mode) {
    case "community":
      return { departure: snapshot.departure, arrival: snapshot.arrival };
    case "depart_now": {
      const departure = options.now + BOARDING_SEQUENCE_MS;
      return { departure, arrival: departure + block };
    }
    case "custom": {
      if (options.chosenDeparture === undefined || options.chosenDeparture === null) {
        throw new RangeError("Custom Departure needs a chosen departure time");
      }
      return { departure: options.chosenDeparture, arrival: options.chosenDeparture + block };
    }
  }
}

/** Whether a flight fits a study window without compressing it (FR-006). */
export function fitsStudyWindow(planned: PlannedTimes, window: StudyWindow): boolean {
  return planned.departure >= window.start && planned.arrival <= window.end;
}

export interface BookingTimes {
  mode: DepartureMode;
  plannedDeparture: Instant;
  plannedArrival: Instant;
  createdAt: Instant;
}

export interface BoardingWindow {
  opensAt: Instant;
  /** After this the booking is a no-show. */
  closesAt: Instant;
}

/** Boarding windows per mode (FR-004). */
export function boardingWindow(b: BookingTimes): BoardingWindow {
  switch (b.mode) {
    case "community": {
      const takeoff = b.plannedDeparture + takeoffOffsetMs(buildPhasePlan(b.plannedArrival - b.plannedDeparture));
      return { opensAt: b.plannedDeparture - COMMUNITY_BOARDING_OPENS_MS, closesAt: takeoff };
    }
    case "custom":
      return { opensAt: b.plannedDeparture, closesAt: b.plannedArrival };
    case "depart_now":
      return { opensAt: b.createdAt, closesAt: b.plannedArrival };
  }
}

export type BoardingDecision = "too_early" | "open" | "late_join" | "no_show";

export function boardingDecision(b: BookingTimes, now: Instant): BoardingDecision {
  const window = boardingWindow(b);
  if (now < window.opensAt) return "too_early";
  if (now >= window.closesAt) return "no_show";
  if (b.mode === "community" && now > b.plannedDeparture) return "late_join";
  return "open";
}

export interface BoardedTimes {
  /** Actual block start. */
  departure: Instant;
  arrival: Instant;
  /** When focus credit starts (FR-013a). */
  focusStart: Instant;
}

/**
 * Times once the passenger boards. Community Flights keep published times; late passengers join in
 * progress. Individual flights depart when the boarding sequence ends, so a late Custom Departure
 * departs late and lands correspondingly later.
 */
export function boardedTimes(b: BookingTimes, boardedAt: Instant): BoardedTimes {
  const block = b.plannedArrival - b.plannedDeparture;
  if (b.mode === "community") {
    return {
      departure: b.plannedDeparture,
      arrival: b.plannedArrival,
      focusStart: Math.max(b.plannedDeparture, boardedAt),
    };
  }
  const departure = Math.max(boardedAt, b.mode === "custom" ? b.plannedDeparture : boardedAt) + BOARDING_SEQUENCE_MS;
  return { departure, arrival: departure + block, focusStart: departure };
}

export interface UnlockState {
  /** Highest airline tier unlocked (0 = budget airlines). */
  airlineTier: number;
  cabinClasses: readonly CabinClass[];
}

export interface BookingRequestCheck {
  mode: DepartureMode;
  snapshot: ScheduleSnapshot;
  cabin: CabinClass;
  now: Instant;
  userTimeZone: string;
  chosenDeparture?: Instant | null;
  studyWindow?: StudyWindow | null;
  unlocks: UnlockState;
  airlineTier: number;
  /** Random Flight draws may use locked airlines and classes (FR-005). */
  isRandomDraw?: boolean;
}

export type BookingError =
  | "outside_booking_window"
  | "departure_in_past"
  | "boarding_closed"
  | "cabin_not_offered"
  | "cabin_locked"
  | "airline_locked"
  | "missing_chosen_departure"
  | "does_not_fit_study_window"
  | "private_not_scheduled";

/** Validates a booking request. Returns an empty list when the booking is allowed. */
export function checkBookingRequest(req: BookingRequestCheck): BookingError[] {
  const errors: BookingError[] = [];
  if (req.cabin === "private") errors.push("private_not_scheduled");
  else if (!offeredCabins(req.snapshot).includes(req.cabin)) errors.push("cabin_not_offered");
  if (!req.isRandomDraw) {
    if (req.airlineTier > req.unlocks.airlineTier) errors.push("airline_locked");
    if (!req.unlocks.cabinClasses.includes(req.cabin)) errors.push("cabin_locked");
  }
  if (req.mode === "custom" && (req.chosenDeparture === undefined || req.chosenDeparture === null)) {
    errors.push("missing_chosen_departure");
    return errors;
  }
  const planned = plannedTimes(req.mode, req.snapshot, { now: req.now, chosenDeparture: req.chosenDeparture ?? null });
  if (!isWithinBookingWindow(planned.departure, req.now, req.userTimeZone)) errors.push("outside_booking_window");
  if (req.mode === "custom" && planned.departure < req.now) errors.push("departure_in_past");
  if (req.mode === "community") {
    const decision = boardingDecision(
      { mode: "community", plannedDeparture: planned.departure, plannedArrival: planned.arrival, createdAt: req.now },
      req.now,
    );
    if (decision === "no_show") errors.push("boarding_closed");
  }
  if (req.studyWindow && !fitsStudyWindow(planned, req.studyWindow)) errors.push("does_not_fit_study_window");
  return errors;
}
