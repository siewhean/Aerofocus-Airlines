import type { AttendanceSignal, AttendanceSignalKind } from "./attendance";
import { isUnattendedAt } from "./attendance";
import { boardedTimes, boardingDecision, type BookingTimes, type DepartureMode } from "./booking";
import { nextAutoBreakAt, type BreakSchedule, type FocusEvent, type SegmentKind } from "./focus";
import { summarizeSession, validationDeadline, type SessionSummary } from "./outcome";
import type { CabinClass } from "./schedule";
import type { SeatAssignment } from "./seats";
import { createFlightPlan, flightStateAt, type FlightPlan, type FlightState } from "./simulation";
import type { Airport } from "./schedule";
import type { Instant } from "./time";

/** Persistable state of one flight leg in progress. The same shape is used by the server and guest mode. */
export interface FlightSessionData {
  mode: DepartureMode;
  snapshotId: string;
  cabin: CabinClass;
  seat: SeatAssignment;
  boardedAt: Instant;
  departure: Instant;
  arrival: Instant;
  focusStart: Instant;
  breakSchedule: BreakSchedule;
  events: FocusEvent[];
  signals: AttendanceSignal[];
  exitedAt: Instant | null;
  validatedAt: Instant | null;
  confirmedUnattendedStarts: Instant[];
  /** Individual flights only. Community Flight passengers are only counted (FR-058). Private by default. */
  isPublic: boolean;
  studyGoal: string | null;
  goalCompleted: boolean | null;
}

export type SessionAction =
  | { type: "break_start" }
  | { type: "break_end" }
  | { type: "back" }
  | { type: "signal"; kind: AttendanceSignalKind }
  | { type: "exit" }
  | { type: "validate"; confirmUnattendedStarts?: Instant[]; goalCompleted?: boolean | null }
  | { type: "set_visibility"; isPublic: boolean };

export type SessionActionError =
  | "flight_finished"
  | "flight_not_landed"
  | "validation_window_closed"
  | "already_validated"
  | "not_on_break"
  | "already_on_break"
  | "community_flights_are_shared";

export type ActionResult = { ok: true; session: FlightSessionData } | { ok: false; error: SessionActionError };

export interface BoardInput {
  booking: BookingTimes;
  snapshotId: string;
  cabin: CabinClass;
  seat: SeatAssignment;
  breakSchedule: BreakSchedule;
  studyGoal: string | null;
  isPublic: boolean;
  now: Instant;
}

export type BoardResult = { ok: true; session: FlightSessionData } | { ok: false; error: "too_early" | "no_show" };

export function boardFlight(input: BoardInput): BoardResult {
  const decision = boardingDecision(input.booking, input.now);
  if (decision === "too_early" || decision === "no_show") return { ok: false, error: decision };
  const times = boardedTimes(input.booking, input.now);
  return {
    ok: true,
    session: {
      mode: input.booking.mode,
      snapshotId: input.snapshotId,
      cabin: input.cabin,
      seat: input.seat,
      boardedAt: input.now,
      departure: times.departure,
      arrival: times.arrival,
      focusStart: times.focusStart,
      breakSchedule: input.breakSchedule,
      events: [],
      signals: [{ at: input.now, kind: "beat" }],
      exitedAt: null,
      validatedAt: null,
      confirmedUnattendedStarts: [],
      isPublic: input.booking.mode === "community" ? false : input.isPublic,
      studyGoal: input.studyGoal,
      goalCompleted: null,
    },
  };
}

export function summarize(session: FlightSessionData, now: Instant): SessionSummary {
  return summarizeSession(session, now);
}

function isClosed(session: FlightSessionData, now: Instant): boolean {
  const outcome = summarizeSession(session, now).outcome;
  return outcome !== "in_flight";
}

/** Applies a user action. Pure: returns a new session or a reason the action is not allowed. */
export function applySessionAction(session: FlightSessionData, action: SessionAction, now: Instant): ActionResult {
  const ok = (s: FlightSessionData): ActionResult => ({ ok: true, session: s });
  const fail = (error: SessionActionError): ActionResult => ({ ok: false, error });

  switch (action.type) {
    case "signal":
      if (isClosed(session, now)) return ok(session); // late signals are harmless; ignore them
      return ok({ ...session, signals: [...session.signals, { at: now, kind: action.kind }] });

    case "break_start":
    case "break_end":
    case "back": {
      if (isClosed(session, now)) return fail("flight_finished");
      const kind = summarizeSession(session, now).focusState;
      if (action.type === "break_start" && kind === "break") return fail("already_on_break");
      if (action.type === "break_end" && kind !== "break") return fail("not_on_break");
      if (action.type === "back" && kind === "focus") return fail("not_on_break");
      const event: FocusEvent = { type: action.type, at: now };
      // An action is also proof the app is open.
      return ok({
        ...session,
        events: [...session.events, event],
        signals: [...session.signals, { at: now, kind: "beat" }],
      });
    }

    case "exit":
      if (isClosed(session, now)) return fail("flight_finished");
      return ok({ ...session, exitedAt: now });

    case "validate": {
      if (session.validatedAt !== null) return fail("already_validated");
      if (session.exitedAt !== null) return fail("flight_finished");
      if (now < session.arrival) return fail("flight_not_landed");
      if (now > validationDeadline(session.arrival)) return fail("validation_window_closed");
      const unattended = summarizeSession(session, now).unattended.map((s) => s.start);
      const confirmed = (action.confirmUnattendedStarts ?? []).filter((start) => unattended.includes(start));
      return ok({
        ...session,
        validatedAt: now,
        confirmedUnattendedStarts: confirmed,
        goalCompleted: action.goalCompleted ?? null,
      });
    }

    case "set_visibility":
      if (session.mode === "community") return fail("community_flights_are_shared");
      if (isClosed(session, now)) return fail("flight_finished");
      return ok({ ...session, isPublic: action.isPublic });
  }
}

export type SessionPrompt = "confirm_back" | "validate" | null;

export interface SessionView {
  flight: FlightState;
  summary: SessionSummary;
  focusState: SegmentKind;
  nextBreakAt: Instant | null;
  /** What the interface should ask the user now (FR-040, FR-015). */
  prompt: SessionPrompt;
  unattendedNow: boolean;
}

export function planForSession(session: FlightSessionData, origin: Airport, destination: Airport): FlightPlan {
  return createFlightPlan({ origin, destination, departure: session.departure, blockMs: session.arrival - session.departure });
}

export function sessionView(session: FlightSessionData, plan: FlightPlan, now: Instant): SessionView {
  const summary = summarizeSession(session, now);
  const focusState = summary.focusState;
  return {
    flight: flightStateAt(plan, now),
    summary,
    focusState,
    nextBreakAt:
      summary.outcome === "in_flight"
        ? nextAutoBreakAt({ segments: summary.segments, current: focusState }, session.breakSchedule)
        : null,
    prompt:
      summary.outcome === "awaiting_validation"
        ? "validate"
        : summary.outcome === "in_flight" && focusState === "awaiting_return"
          ? "confirm_back"
          : null,
    unattendedNow: summary.outcome === "in_flight" && isUnattendedAt(session.signals, session.focusStart, now),
  };
}
