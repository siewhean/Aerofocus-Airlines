import { mergeSpans, overlapMs, unattendedSpans, type AttendanceSignal, type TimeSpan } from "./attendance";
import {
  completedFocusSegments,
  deriveFocusTimeline,
  totalMs,
  type BreakSchedule,
  type FocusEvent,
  type Segment,
  type SegmentKind,
} from "./focus";
import { MINUTE, type Instant } from "./time";

/** Time allowed after landing to validate a flight (FR-015). */
export const VALIDATION_WINDOW_MS = 10 * MINUTE;

export type SessionOutcome = "in_flight" | "awaiting_validation" | "complete" | "invalid" | "ended_early";

export interface SessionTimeline {
  /** Block start of this flight. */
  departure: Instant;
  arrival: Instant;
  /** max(departure, boarding time). Late Community Flight passengers start here. */
  focusStart: Instant;
  breakSchedule: BreakSchedule;
  events: readonly FocusEvent[];
  signals: readonly AttendanceSignal[];
  exitedAt: Instant | null;
  validatedAt: Instant | null;
  /** Start instants of unattended spans the user confirmed as focus during validation. */
  confirmedUnattendedStarts: readonly Instant[];
}

export interface SessionSummary {
  outcome: SessionOutcome;
  validationDeadline: Instant;
  segments: Segment[];
  /** Focus state at the summary instant. */
  focusState: SegmentKind;
  unattended: TimeSpan[];
  focusMs: number;
  breakMs: number;
  awaitingReturnMs: number;
  /** Focus credited towards progression. 0 for invalid flights (FR-015). */
  creditedFocusMs: number;
  /** Flying time credited. Only complete flights earn flying hours. */
  creditedFlightMs: number;
}

/** Focus minus unattended time that overlaps it. */
function attendedFocusMs(focus: readonly Segment[], unattended: readonly TimeSpan[]): number {
  return focus.reduce((sum, s) => sum + (s.end - s.start) - overlapMs(unattended, s.start, s.end), 0);
}

export function validationDeadline(arrival: Instant): Instant {
  return arrival + VALIDATION_WINDOW_MS;
}

export function outcomeAt(t: Pick<SessionTimeline, "arrival" | "exitedAt" | "validatedAt">, now: Instant): SessionOutcome {
  const deadline = validationDeadline(t.arrival);
  if (t.exitedAt !== null && t.exitedAt < t.arrival) return "ended_early";
  if (t.validatedAt !== null) return t.validatedAt <= deadline ? "complete" : "invalid";
  if (now < t.arrival) return "in_flight";
  if (now <= deadline) return "awaiting_validation";
  return "invalid";
}

/** Deterministic summary of a flight session at an instant. Shared by server and guest mode. */
export function summarizeSession(t: SessionTimeline, now: Instant): SessionSummary {
  const outcome = outcomeAt(t, now);
  const deadline = validationDeadline(t.arrival);
  const until =
    outcome === "ended_early" ? (t.exitedAt as Instant) : outcome === "in_flight" ? Math.max(t.focusStart, now) : t.arrival;
  const timeline = deriveFocusTimeline({ focusStart: t.focusStart, until, schedule: t.breakSchedule, events: t.events });
  const segments = timeline.segments;
  const unattended = unattendedSpans(t.signals, t.focusStart, until);
  const focusSegments = segments.filter((s) => s.kind === "focus");
  const base = {
    outcome,
    validationDeadline: deadline,
    segments,
    focusState: timeline.current,
    unattended,
    focusMs: totalMs(segments, "focus"),
    breakMs: totalMs(segments, "break"),
    awaitingReturnMs: totalMs(segments, "awaiting_return"),
  };

  switch (outcome) {
    case "ended_early":
      // Only intervals completed by a break count, and unattended time inside them is discarded.
      return { ...base, creditedFocusMs: attendedFocusMs(completedFocusSegments(segments), unattended), creditedFlightMs: 0 };
    case "invalid":
      return { ...base, creditedFocusMs: 0, creditedFlightMs: 0 };
    case "complete": {
      const confirmed = new Set(t.confirmedUnattendedStarts);
      const remaining = mergeSpans(unattended.filter((s) => !confirmed.has(s.start)));
      return {
        ...base,
        creditedFocusMs: attendedFocusMs(focusSegments, remaining),
        creditedFlightMs: t.arrival - t.focusStart,
      };
    }
    case "in_flight":
    case "awaiting_validation":
      // Provisional figure shown while flying or before validation; nothing is awarded yet.
      return { ...base, creditedFocusMs: attendedFocusMs(focusSegments, unattended), creditedFlightMs: 0 };
  }
}
