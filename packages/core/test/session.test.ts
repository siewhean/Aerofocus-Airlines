import { describe, expect, it } from "vitest";
import {
  applySessionAction,
  boardFlight,
  buildTravelMark,
  computeStats,
  createFlightPlan,
  DEFAULT_BREAK_SCHEDULE,
  GUEST_DATA_TTL_MS,
  HOUR,
  isGuestDataExpired,
  MINUTE,
  publicFlightPosition,
  seededRng,
  assignSeat,
  sessionView,
  summarize,
  validateGuestImport,
  type FlightRecord,
  type FlightSessionData,
  type GuestFlightImport,
} from "../src";
import { LHR, SIN, snapshot, T0 } from "./fixtures";

function boarded(mode: "community" | "depart_now" = "depart_now"): FlightSessionData {
  const result = boardFlight({
    booking: { mode, plannedDeparture: T0, plannedArrival: T0 + 2 * HOUR, createdAt: T0 - HOUR },
    snapshotId: "s1",
    cabin: "economy",
    seat: assignSeat(mode, "narrowbody", "economy", seededRng(1)),
    breakSchedule: DEFAULT_BREAK_SCHEDULE,
    studyGoal: "Finish chapter 3",
    isPublic: true,
    now: T0 - MINUTE,
  });
  if (!result.ok) throw new Error(result.error);
  return result.session;
}

function apply(session: FlightSessionData, action: Parameters<typeof applySessionAction>[1], now: number): FlightSessionData {
  const r = applySessionAction(session, action, now);
  if (!r.ok) throw new Error(r.error);
  return r.session;
}

describe("session engine", () => {
  it("refuses to board too early", () => {
    const r = boardFlight({
      booking: { mode: "community", plannedDeparture: T0, plannedArrival: T0 + HOUR, createdAt: T0 - HOUR },
      snapshotId: "s", cabin: "economy", seat: assignSeat("community", "narrowbody", "economy", seededRng(1)),
      breakSchedule: DEFAULT_BREAK_SCHEDULE, studyGoal: null, isPublic: false, now: T0 - HOUR,
    });
    expect(r).toEqual({ ok: false, error: "too_early" });
  });

  it("Community Flight passengers are never shared as individual aircraft", () => {
    const s = boarded("community");
    expect(s.isPublic).toBe(false);
    expect(applySessionAction(s, { type: "set_visibility", isPublic: true }, T0)).toEqual({
      ok: false,
      error: "community_flights_are_shared",
    });
  });

  it("prompts 'confirm back' after an automatic break and resumes on confirmation", () => {
    let s = boarded();
    const plan = createFlightPlan({ origin: SIN, destination: LHR, departure: s.departure, blockMs: s.arrival - s.departure });
    const afterBreak = s.focusStart + 61 * MINUTE;
    s = apply(s, { type: "signal", kind: "beat" }, afterBreak);
    expect(sessionView(s, plan, afterBreak).prompt).toBe("confirm_back");
    s = apply(s, { type: "back" }, afterBreak);
    expect(sessionView(s, plan, afterBreak).focusState).toBe("focus");
  });

  it("validates only between landing and 10 minutes after", () => {
    const s = boarded();
    expect(applySessionAction(s, { type: "validate" }, s.arrival - 1)).toEqual({ ok: false, error: "flight_not_landed" });
    expect(applySessionAction(s, { type: "validate" }, s.arrival + 11 * MINUTE)).toEqual({
      ok: false,
      error: "validation_window_closed",
    });
    const done = apply(s, { type: "validate", goalCompleted: true }, s.arrival + MINUTE);
    expect(summarize(done, s.arrival + HOUR).outcome).toBe("complete");
    expect(done.goalCompleted).toBe(true);
  });

  it("cannot take a break after exiting", () => {
    const s = apply(boarded(), { type: "exit" }, T0 + 30 * MINUTE);
    expect(applySessionAction(s, { type: "break_start" }, T0 + 31 * MINUTE)).toEqual({ ok: false, error: "flight_finished" });
  });
});

describe("passport, stats, community and guest", () => {
  it("travel marks use the arrival date in the user's time zone (FR-049)", () => {
    const s = snapshot();
    const mark = buildTravelMark({ snapshot: s, destinationCountry: "GB", arrival: Date.UTC(2026, 9, 12, 17, 0), userTimeZone: "Asia/Singapore", designs: [] });
    expect(mark).toMatchObject({ arrivalDate: "2026-10-13", designId: "generic-arrival", virtual: true, flightNumber: "SQ322" });
  });

  it("computes statistics from finalised records", () => {
    const base: FlightRecord = {
      outcome: "complete", departure: T0, arrival: T0 + HOUR, blockMs: HOUR, creditedFocusMs: 50 * MINUTE, breakMs: 10 * MINUTE,
      creditedFlightMs: HOUR, origin: "SIN", destination: "KUL", destinationCountry: "MY", airline: "TR", aircraftType: "32N", distanceKm: 300,
    };
    const stats = computeStats([base, { ...base, outcome: "invalid", creditedFocusMs: 0, creditedFlightMs: 0 }], T0 + 2 * HOUR, "UTC");
    expect(stats).toMatchObject({ completedFlights: 1, completionRate: 0.5, countriesCollected: 1, currentStreakDays: 1, creditedFocusMs: 50 * MINUTE });
  });

  it("public flight positions are computed by the viewer from shared data", () => {
    const position = publicFlightPosition(
      { id: "x", kind: "individual", origin: SIN, destination: LHR, departure: T0, blockMs: 845 * MINUTE },
      T0 + 6 * HOUR,
    );
    expect(position.lat).toBeGreaterThan(SIN.lat);
  });

  it("AC-34: guest data expires 2 weeks after the last flight", () => {
    expect(isGuestDataExpired(T0, T0, T0 + GUEST_DATA_TTL_MS - 1)).toBe(false);
    expect(isGuestDataExpired(T0, T0, T0 + GUEST_DATA_TTL_MS)).toBe(true);
  });

  it("AC-21: guest import accepts valid history and rejects tampered records", () => {
    const s = snapshot();
    const record: GuestFlightImport = {
      snapshotId: s.id, outcome: "complete", departure: s.departure, arrival: s.arrival, blockMs: s.arrival - s.departure,
      creditedFocusMs: 10 * HOUR, breakMs: HOUR, creditedFlightMs: s.arrival - s.departure, origin: "SIN", destination: "LHR",
      destinationCountry: "GB", airline: "SQ", aircraftType: "388", distanceKm: 10_880, validatedAt: s.arrival, studyGoal: null, goalCompleted: null,
    };
    const snapshots = new Map([[s.id, s]]);
    const result = validateGuestImport(
      [record, { ...record, departure: record.departure + MINUTE, arrival: record.arrival + MINUTE }, { ...record, snapshotId: "nope" }],
      snapshots,
      s.arrival + HOUR,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected.map((r) => r.reason).sort()).toEqual(["overlaps_another_flight", "unknown_snapshot"]);
    expect(validateGuestImport([record], snapshots, s.departure).rejected[0]?.reason).toBe("in_future");
  });
});
