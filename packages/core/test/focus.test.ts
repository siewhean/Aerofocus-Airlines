import { describe, expect, it } from "vitest";
import {
  deriveSegments,
  HOUR,
  MINUTE,
  summarizeSession,
  unattendedSpans,
  VALIDATION_WINDOW_MS,
  type BreakSchedule,
  type SessionTimeline,
} from "../src";
import { T0 } from "./fixtures";

const hourly: BreakSchedule = { mode: "auto", focusMinutes: 50, breakMinutes: 10, longBreakEvery: 0, longBreakMinutes: 30 };
const manual: BreakSchedule = { ...hourly, mode: "manual" };

/** Heartbeats every minute between two instants. */
function beats(from: number, to: number): { at: number; kind: "beat" }[] {
  const out: { at: number; kind: "beat" }[] = [];
  for (let t = from; t <= to; t += MINUTE) out.push({ at: t, kind: "beat" });
  return out;
}

function timeline(overrides: Partial<SessionTimeline> = {}): SessionTimeline {
  return {
    departure: T0,
    arrival: T0 + 5 * HOUR,
    focusStart: T0,
    breakSchedule: manual,
    events: [],
    signals: beats(T0, T0 + 5 * HOUR),
    exitedAt: null,
    validatedAt: null,
    confirmedUnattendedStarts: [],
    ...overrides,
  };
}

describe("focus timeline", () => {
  it("focus is on by default from the start of the flight (FR-013a)", () => {
    const segs = deriveSegments({ focusStart: T0, until: T0 + HOUR, schedule: manual, events: [] });
    expect(segs).toEqual([{ kind: "focus", start: T0, end: T0 + HOUR }]);
  });

  it("automatic breaks end in 'awaiting return' until the user confirms they are back (FR-040)", () => {
    const segs = deriveSegments({
      focusStart: T0,
      until: T0 + 2 * HOUR,
      schedule: hourly,
      events: [{ type: "back", at: T0 + 65 * MINUTE }],
    });
    expect(segs.map((s) => [s.kind, (s.end - s.start) / MINUTE])).toEqual([
      ["focus", 50],
      ["break", 10],
      ["awaiting_return", 5],
      ["focus", 50],
      ["break", 5],
    ]);
  });

  it("manual breaks resume focus immediately on break_end", () => {
    const segs = deriveSegments({
      focusStart: T0,
      until: T0 + HOUR,
      schedule: manual,
      events: [
        { type: "break_start", at: T0 + 20 * MINUTE },
        { type: "break_end", at: T0 + 30 * MINUTE },
      ],
    });
    expect(segs.map((s) => s.kind)).toEqual(["focus", "break", "focus"]);
  });

  it("long rests apply every Nth automatic break", () => {
    const schedule: BreakSchedule = { mode: "auto", focusMinutes: 30, breakMinutes: 5, longBreakEvery: 2, longBreakMinutes: 20 };
    const segs = deriveSegments({
      focusStart: T0,
      until: T0 + 3 * HOUR,
      schedule,
      events: [
        { type: "back", at: T0 + 35 * MINUTE },
        { type: "back", at: T0 + 85 * MINUTE },
      ],
    });
    const breaks = segs.filter((s) => s.kind === "break").map((s) => (s.end - s.start) / MINUTE);
    expect(breaks.slice(0, 2)).toEqual([5, 20]);
  });
});

describe("attendance (FR-013a)", () => {
  it("AC-09: an app running in the background keeps sending beats, so focus is not ended", () => {
    expect(unattendedSpans(beats(T0, T0 + HOUR), T0, T0 + HOUR)).toEqual([]);
  });

  it("AC-25: a laptop sleeping 30 minutes is unattended", () => {
    const signals = [...beats(T0, T0 + 10 * MINUTE), ...beats(T0 + 40 * MINUTE, T0 + HOUR)];
    expect(unattendedSpans(signals, T0, T0 + HOUR)).toEqual([{ start: T0 + 10 * MINUTE, end: T0 + 40 * MINUTE }]);
  });

  it("a paused phone app (background → resume) counts as attended", () => {
    const signals = [
      { at: T0 + MINUTE, kind: "background" as const },
      { at: T0 + 40 * MINUTE, kind: "resume" as const },
      ...beats(T0 + 41 * MINUTE, T0 + HOUR),
    ];
    expect(unattendedSpans(signals, T0, T0 + HOUR)).toEqual([]);
  });

  it("reopening a closed app makes the gap unattended", () => {
    const signals = [...beats(T0, T0 + 2 * MINUTE), { at: T0 + 4 * MINUTE, kind: "reopen" as const }];
    expect(unattendedSpans(signals, T0, T0 + 5 * MINUTE)).toEqual([{ start: T0 + 2 * MINUTE, end: T0 + 4 * MINUTE }]);
  });

  it("gaps up to 5 minutes are tolerated", () => {
    const signals = [{ at: T0, kind: "beat" as const }, { at: T0 + 5 * MINUTE, kind: "beat" as const }];
    expect(unattendedSpans(signals, T0, T0 + 5 * MINUTE)).toEqual([]);
  });
});

describe("session outcomes", () => {
  it("FR-013: 90-minute flight with 15 minutes of breaks credits 75 minutes and 90 minutes of flight", () => {
    const t = timeline({
      arrival: T0 + 90 * MINUTE,
      signals: beats(T0, T0 + 90 * MINUTE),
      events: [
        { type: "break_start", at: T0 + 30 * MINUTE },
        { type: "break_end", at: T0 + 45 * MINUTE },
      ],
      validatedAt: T0 + 92 * MINUTE,
    });
    const s = summarizeSession(t, T0 + 95 * MINUTE);
    expect(s.outcome).toBe("complete");
    expect(s.creditedFocusMs).toBe(75 * MINUTE);
    expect(s.breakMs).toBe(15 * MINUTE);
    expect(s.creditedFlightMs).toBe(90 * MINUTE);
  });

  it("AC-11 / FR-014: early exit keeps only focus completed before the last break (4h of 5)", () => {
    const events = [1, 2, 3, 4].flatMap((h) => [
      { type: "break_start" as const, at: T0 + h * HOUR },
      { type: "break_end" as const, at: T0 + h * HOUR },
    ]);
    // Zero-length breaks keep the arithmetic exact: four completed 1-hour intervals.
    const s = summarizeSession(timeline({ events, exitedAt: T0 + 4.5 * HOUR }), T0 + 4.5 * HOUR);
    expect(s.outcome).toBe("ended_early");
    expect(s.creditedFocusMs).toBe(4 * HOUR);
    expect(s.creditedFlightMs).toBe(0);
  });

  it("early exit during a break credits every completed interval", () => {
    const events = [{ type: "break_start" as const, at: T0 + HOUR }];
    const s = summarizeSession(timeline({ events, exitedAt: T0 + 70 * MINUTE }), T0 + 70 * MINUTE);
    expect(s.creditedFocusMs).toBe(HOUR);
  });

  it("awaits validation for 10 minutes after landing, then becomes invalid with no focus credit (AC-24)", () => {
    const t = timeline();
    expect(summarizeSession(t, t.arrival + 5 * MINUTE).outcome).toBe("awaiting_validation");
    const invalid = summarizeSession(t, t.arrival + VALIDATION_WINDOW_MS + 1);
    expect(invalid.outcome).toBe("invalid");
    expect(invalid.creditedFocusMs).toBe(0);
    expect(invalid.creditedFlightMs).toBe(0);
  });

  it("validation after the deadline is invalid", () => {
    const t = timeline({ validatedAt: T0 + 5 * HOUR + VALIDATION_WINDOW_MS + 1 });
    expect(summarizeSession(t, T0 + 6 * HOUR).outcome).toBe("invalid");
  });

  it("AC-25: unattended time is credited only when the user confirms it", () => {
    const signals = [...beats(T0, T0 + HOUR), ...beats(T0 + 90 * MINUTE, T0 + 5 * HOUR)];
    const base = timeline({ signals, validatedAt: T0 + 5 * HOUR + MINUTE });
    expect(summarizeSession(base, T0 + 6 * HOUR).creditedFocusMs).toBe(5 * HOUR - 30 * MINUTE);
    const confirmed = { ...base, confirmedUnattendedStarts: [T0 + HOUR] };
    expect(summarizeSession(confirmed, T0 + 6 * HOUR).creditedFocusMs).toBe(5 * HOUR);
  });

  it("AC-08: breaks pause focus credit while the flight continues", () => {
    const t = timeline({ events: [{ type: "break_start", at: T0 + HOUR }] });
    const s = summarizeSession(t, T0 + 2 * HOUR);
    expect(s.outcome).toBe("in_flight");
    expect(s.creditedFocusMs).toBe(HOUR);
  });

  it("late Community Flight passengers earn focus and flight time only from boarding", () => {
    const t = timeline({ focusStart: T0 + 10 * MINUTE, signals: beats(T0 + 10 * MINUTE, T0 + 5 * HOUR), validatedAt: T0 + 5 * HOUR });
    const s = summarizeSession(t, T0 + 5 * HOUR);
    expect(s.creditedFocusMs).toBe(5 * HOUR - 10 * MINUTE);
    expect(s.creditedFlightMs).toBe(5 * HOUR - 10 * MINUTE);
  });
});
