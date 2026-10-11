import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  BOARDING_SEQUENCE_MS,
  buildTravelMark,
  canAbandonItinerary,
  computeStats,
  connectionFeasibility,
  currentItineraryAirport,
  earnedAchievements,
  HOUR,
  itineraryLegBoardedTimes,
  itineraryLegBoardingDecision,
  itineraryLegBoardingWindow,
  itineraryNotificationPlan,
  itineraryPlannedTimes,
  itineraryStatus,
  layoverEventError,
  layoverFocus,
  layoverState,
  legBoardingBlock,
  legsToCancel,
  loungeAccess,
  MAX_LAYOVER_MS,
  MIN_CONNECTION_DOMESTIC_MS,
  MIN_CONNECTION_INTERNATIONAL_MS,
  MINUTE,
  minimumConnectionMs,
  nextVisitNumber,
  recomputeItineraryTimes,
  searchConnections,
  studyStreakDays,
  validateItinerary,
  type Airport,
  type BookingTimes,
  takeoffOffsetMs,
  buildPhasePlan,
  COMMUNITY_BOARDING_OPENS_MS,
  type FlightRecord,
  type ItineraryLegProgress,
  type ScheduleSnapshot,
} from "../src";
import { KUL, LHR, SIN, snapshot, T0 } from "./fixtures";

const ap = (iata: string, country: string, timeZone: string): Airport => ({
  iata, name: iata, city: iata, country, region: "asia", lat: 0, lon: 0, timeZone,
});
const AIRPORTS = new Map<string, Airport>(
  [
    SIN, LHR, KUL,
    ap("DOH", "QA", "Asia/Qatar"),
    ap("DXB", "AE", "Asia/Dubai"),
    ap("JFK", "US", "America/New_York"),
    ap("MEL", "AU", "Australia/Melbourne"),
    ap("SYD", "AU", "Australia/Sydney"),
    ap("BNE", "AU", "Australia/Brisbane"),
  ].map((a) => [a.iata, a]),
);

let seq = 0;
/** A leg departing `depH` hours after T0 with a block of `blockH` hours. */
function leg(origin: string, destination: string, depH: number, blockH: number, extra: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  seq++;
  return snapshot({
    id: `test:${origin}${destination}:${seq}`,
    flightNumber: String(seq),
    origin,
    destination,
    departure: T0 + depH * HOUR,
    arrival: T0 + (depH + blockH) * HOUR,
    ...extra,
  });
}

describe("connection rules (FR-041, FR-042)", () => {
  it("uses the domestic minimum only when every airport is in the layover airport's country", () => {
    const melSyd = leg("MEL", "SYD", 0, 1.5);
    const sydBne = leg("SYD", "BNE", 1.5 + 50 / 60, 1.5);
    expect(minimumConnectionMs(melSyd, sydBne, AIRPORTS)).toBe(MIN_CONNECTION_DOMESTIC_MS);
    const ok = connectionFeasibility(melSyd, sydBne, AIRPORTS);
    expect(ok).toMatchObject({ ok: true, domestic: true, layoverMs: 50 * MINUTE });

    // Same 50-minute layover, but the journey leaves the country: 60-minute minimum applies.
    const kulSin = leg("KUL", "SIN", 0, 1);
    const sinDoh = leg("SIN", "DOH", 1 + 50 / 60, 8);
    expect(minimumConnectionMs(kulSin, sinDoh, AIRPORTS)).toBe(MIN_CONNECTION_INTERNATIONAL_MS);
    expect(connectionFeasibility(kulSin, sinDoh, AIRPORTS)).toMatchObject({ ok: false, reason: "below_minimum_connection", domestic: false });
    expect(connectionFeasibility(kulSin, leg("SIN", "DOH", 2, 8), AIRPORTS).ok).toBe(true);
    // Per-airport override
    expect(connectionFeasibility(kulSin, sinDoh, AIRPORTS, { SIN: { internationalMs: 40 * MINUTE } }).ok).toBe(true);
  });

  it("enforces the maximum layover and chaining", () => {
    const a = leg("SIN", "DOH", 0, 8);
    expect(connectionFeasibility(a, leg("DOH", "LHR", 8 + 24, 7), AIRPORTS)).toMatchObject({ ok: true, layoverMs: MAX_LAYOVER_MS });
    expect(connectionFeasibility(a, leg("DOH", "LHR", 8 + 24.01, 7), AIRPORTS).reason).toBe("layover_too_long");
    expect(connectionFeasibility(a, leg("DXB", "LHR", 10, 7), AIRPORTS).reason).toBe("not_chained");
    expect(connectionFeasibility(a, leg("DOH", "XXX", 10, 7), AIRPORTS).reason).toBe("unknown_airport");
  });

  it("validates whole itineraries: revisits, leg count and booking window", () => {
    const sinDoh = leg("SIN", "DOH", 0, 8);
    const dohLhr = leg("DOH", "LHR", 10, 7);
    expect(validateItinerary([sinDoh, dohLhr], AIRPORTS)).toEqual([]);
    expect(validateItinerary([], AIRPORTS)).toEqual([{ legIndex: 0, error: "no_legs" }]);
    const back = leg("DOH", "SIN", 10, 8);
    expect(validateItinerary([sinDoh, back], AIRPORTS)).toEqual([{ legIndex: 1, error: "airport_revisited" }]);
    const four = [leg("KUL", "SIN", 0, 1), leg("SIN", "DXB", 2, 7), leg("DXB", "DOH", 10, 1), leg("DOH", "LHR", 12, 7)];
    expect(validateItinerary(four, AIRPORTS).map((e) => e.error)).toEqual(["too_many_legs"]);
    expect(validateItinerary([sinDoh, leg("DOH", "LHR", 8.5, 7)], AIRPORTS)).toEqual([{ legIndex: 1, error: "below_minimum_connection" }]);
    // 7-day booking window: a leg 9 days out is outside it.
    const late = leg("DOH", "LHR", 9 * 24, 7);
    expect(validateItinerary([sinDoh, late], AIRPORTS, { now: T0, userTimeZone: "UTC" }).map((e) => e.error)).toEqual(
      expect.arrayContaining(["outside_booking_window", "layover_too_long"]),
    );
  });

  it("checks every leg's planned departure against the booking window, incl. re-chained individual legs", () => {
    // T0 is Monday 00:00 UTC; the window ends at 00:00 UTC on day 8.
    const windowEnd = T0 + 8 * 24 * HOUR;
    const first = leg("SIN", "DOH", 7 * 24 + 10, 8);
    const second = leg("DOH", "LHR", 7 * 24 + 20, 7); // published departure 4 h before the window ends
    const opts = { now: T0, userTimeZone: "UTC" };
    expect(validateItinerary([first, second], AIRPORTS, opts)).toEqual([]);
    expect(validateItinerary([first, second], AIRPORTS, { ...opts, mode: "community" })).toEqual([]);
    // Individual: leg 1 departs at a chosen time 6 h later, so leg 2's chained departure falls outside.
    const chosen = first.departure + 6 * HOUR;
    expect(chosen + 8 * HOUR + 2 * HOUR).toBeGreaterThan(windowEnd);
    expect(validateItinerary([first, second], AIRPORTS, { ...opts, mode: "individual", chosenDeparture: chosen })).toEqual([
      { legIndex: 1, error: "outside_booking_window" },
    ]);
    // Individual departing now: both legs are early in the window.
    expect(validateItinerary([first, second], AIRPORTS, { ...opts, mode: "individual" })).toEqual([]);
  });
});

describe("connection search", () => {
  const direct = leg("SIN", "LHR", 1, 14);
  const sinDoh = leg("SIN", "DOH", 0, 8);
  const dohLhrShort = leg("DOH", "LHR", 8.5, 7); // 30 min: below minimum
  const dohLhr = leg("DOH", "LHR", 10, 7); // 2 h
  const dohLhrLate = leg("DOH", "LHR", 15, 7); // 7 h
  const sinDxb = leg("SIN", "DXB", 0.5, 7);
  const dxbDoh = leg("DXB", "DOH", 9, 1); // 1.5 h layover
  const dohSin = leg("DOH", "SIN", 9, 8); // revisit: must never be used
  const sinLhrNoUse = leg("SIN", "JFK", 30, 18);
  const departures = [direct, sinDoh, dohLhrShort, dohLhr, dohLhrLate, sinDxb, dxbDoh, dohSin, sinLhrNoUse];

  it("finds direct, 1-stop and 2-stop itineraries sorted by journey time", () => {
    const results = searchConnections({ departures, origin: "SIN", destination: "LHR", airportsByIata: AIRPORTS });
    const routes = results.map((r) => r.legs.map((l) => `${l.origin}-${l.destination}@${(l.departure - T0) / HOUR}`).join(" "));
    expect(routes).toEqual([
      "SIN-LHR@1",
      "SIN-DOH@0 DOH-LHR@10",
      // DOH-LHR@10 leaves as DXB-DOH lands, so only the later departure connects.
      "SIN-DXB@0.5 DXB-DOH@9 DOH-LHR@15",
      "SIN-DOH@0 DOH-LHR@15",
    ]);
    expect(results[0]).toMatchObject({ direct: true, connections: 0, totalMs: 14 * HOUR });
    expect(results[1]!.layovers).toEqual([{ airport: "DOH", layoverMs: 2 * HOUR, minimumConnectionMs: MIN_CONNECTION_INTERNATIONAL_MS, domestic: false }]);
    for (const r of results) {
      const airports = [r.legs[0]!.origin, ...r.legs.map((l) => l.destination)];
      expect(new Set(airports).size).toBe(airports.length);
    }
  });

  it("honours includeDirect, maxConnections, limit and the study window", () => {
    const base = { departures, origin: "SIN", destination: "LHR", airportsByIata: AIRPORTS };
    expect(searchConnections({ ...base, includeDirect: false }).every((r) => !r.direct)).toBe(true);
    expect(searchConnections({ ...base, maxConnections: 1 }).every((r) => r.connections <= 1)).toBe(true);
    expect(searchConnections({ ...base, maxConnections: 0 }).map((r) => r.direct)).toEqual([true]);
    expect(searchConnections({ ...base, limit: 2 })).toHaveLength(2);
    const windowed = searchConnections({ ...base, studyWindow: { start: T0, end: T0 + 17 * HOUR } });
    expect(windowed.map((r) => r.legs.length)).toEqual([1, 2]);
    expect(windowed.every((r) => r.arrival <= T0 + 17 * HOUR && r.departure >= T0)).toBe(true);
    expect(searchConnections({ ...base, notBefore: T0 + 0.25 * HOUR }).every((r) => r.departure >= T0 + 0.25 * HOUR)).toBe(true);
  });

  it("skips direct legs to or from airports missing from reference data", () => {
    const unknownDest = leg("SIN", "LHR", 2, 14);
    const known = new Map(AIRPORTS);
    known.delete("LHR");
    expect(searchConnections({ departures: [unknownDest], origin: "SIN", destination: "LHR", airportsByIata: known })).toEqual([]);
    const unknownOrigin = new Map(AIRPORTS);
    unknownOrigin.delete("SIN");
    expect(searchConnections({ departures: [unknownDest], origin: "SIN", destination: "LHR", airportsByIata: unknownOrigin })).toEqual([]);
    expect(searchConnections({ departures: [unknownDest], origin: "SIN", destination: "LHR", airportsByIata: AIRPORTS })).toHaveLength(1);
  });
});

describe("itinerary planned times (FR-041, FR-042)", () => {
  const legs = [leg("SIN", "DOH", 2, 8), leg("DOH", "LHR", 12, 7)]; // 2 h published layover

  it("community legs keep published times", () => {
    const plans = itineraryPlannedTimes("community", legs, { now: T0 });
    expect(plans.map((p) => [p.mode, p.departure, p.arrival])).toEqual([
      ["community", legs[0]!.departure, legs[0]!.arrival],
      ["community", legs[1]!.departure, legs[1]!.arrival],
    ]);
    // Actual times never move community legs.
    expect(recomputeItineraryTimes("community", legs, plans, { legIndex: 0, departure: legs[0]!.departure, arrival: legs[0]!.arrival + HOUR })[1]).toEqual(plans[1]);
  });

  it("individual legs chain from the previous arrival plus the published layover", () => {
    const now = T0;
    const plans = itineraryPlannedTimes("individual", legs, { now });
    expect(plans[0]).toMatchObject({ mode: "depart_now", departure: now + BOARDING_SEQUENCE_MS, arrival: now + BOARDING_SEQUENCE_MS + 8 * HOUR });
    expect(plans[1]).toMatchObject({ mode: "custom", departure: plans[0]!.arrival + 2 * HOUR });
    expect(plans[1]!.arrival - plans[1]!.departure).toBe(7 * HOUR);

    const custom = itineraryPlannedTimes("individual", legs, { now, chosenDeparture: T0 + 5 * HOUR });
    expect(custom[0]).toMatchObject({ mode: "custom", departure: T0 + 5 * HOUR });
    expect(custom[1]!.departure).toBe(T0 + 5 * HOUR + 8 * HOUR + 2 * HOUR);
  });

  it("recomputes later legs after a late first leg", () => {
    const plans = itineraryPlannedTimes("individual", legs, { now: T0, chosenDeparture: T0 + HOUR });
    const lateDeparture = T0 + HOUR + 40 * MINUTE;
    const updated = recomputeItineraryTimes("individual", legs, plans, { legIndex: 0, departure: lateDeparture, arrival: lateDeparture + 8 * HOUR });
    expect(updated[0]!.departure).toBe(lateDeparture);
    expect(updated[1]!.departure).toBe(lateDeparture + 8 * HOUR + 2 * HOUR);
    expect(updated[1]!.arrival).toBe(updated[1]!.departure + 7 * HOUR);
    expect(plans[1]!.departure).toBe(T0 + HOUR + 10 * HOUR); // input untouched
  });
});

describe("itinerary status (FR-044, FR-045)", () => {
  const L = (bookingStatus: ItineraryLegProgress["bookingStatus"], outcome: ItineraryLegProgress["outcome"]): ItineraryLegProgress => ({ bookingStatus, outcome });

  it("moves booked → in_progress → complete only when every leg completes", () => {
    expect(itineraryStatus([L("booked", null), L("booked", null)])).toBe("booked");
    expect(itineraryStatus([L("boarded", "in_flight"), L("booked", null)])).toBe("in_progress");
    expect(itineraryStatus([L("boarded", "complete"), L("booked", null)])).toBe("in_progress");
    expect(itineraryStatus([L("boarded", "complete"), L("boarded", "awaiting_validation")])).toBe("in_progress");
    expect(itineraryStatus([L("boarded", "complete"), L("boarded", "complete")])).toBe("complete");
  });

  it("any failed leg makes the itinerary incomplete and cancels later unboarded legs", () => {
    for (const failed of [L("boarded", "invalid"), L("boarded", "ended_early"), L("no_show", null)]) {
      const legs = [L("boarded", "complete"), failed, L("booked", null)];
      const status = itineraryStatus(legs);
      expect(status).toBe("incomplete");
      expect(legsToCancel(legs, status)).toEqual([2]);
    }
  });

  it("abandon keeps the in-flight leg and completed legs, cancels the rest", () => {
    const legs = [L("boarded", "complete"), L("boarded", "in_flight"), L("booked", null)];
    expect(canAbandonItinerary(legs)).toBe(true);
    const status = itineraryStatus(legs, { abandoned: true });
    expect(status).toBe("abandoned");
    expect(legsToCancel(legs, status)).toEqual([2]);
    expect(canAbandonItinerary(legs, { abandoned: true })).toBe(false);
    // Status stays abandoned once the in-flight leg completes (the cancelled leg never flies).
    expect(itineraryStatus([L("boarded", "complete"), L("boarded", "complete"), L("cancelled", null)], { abandoned: true })).toBe("abandoned");
    expect(itineraryStatus([L("cancelled", null), L("cancelled", null)])).toBe("cancelled");
    expect(legsToCancel([L("booked", null)], "in_progress")).toEqual([]);
  });

  it("refuses abandoning when no booked, unboarded leg remains", () => {
    // Only the final leg is left and it is in flight: nothing to cancel, so abandoning is refused,
    // otherwise the status would move from abandoned to complete when it lands.
    expect(canAbandonItinerary([L("boarded", "complete"), L("boarded", "in_flight")])).toBe(false);
    expect(canAbandonItinerary([L("boarded", "complete"), L("boarded", "awaiting_validation")])).toBe(false);
    expect(canAbandonItinerary([L("boarded", "complete"), L("boarded", "complete")])).toBe(false);
    expect(canAbandonItinerary([L("booked", null), L("booked", null)])).toBe(true);
  });

  it("refuses boarding a later leg before the previous leg lands", () => {
    const arrival = T0 + 8 * HOUR;
    const legs = [
      { ...L("boarded", "in_flight" as const), arrival },
      { ...L("booked", null), arrival: null },
    ];
    expect(legBoardingBlock(legs, 0, T0)).toBeNull();
    expect(legBoardingBlock(legs, 1, arrival - 1)).toBe("previous_leg_not_landed");
    expect(legBoardingBlock([{ ...legs[0]!, outcome: "awaiting_validation" }, legs[1]!], 1, arrival)).toBeNull();
    expect(legBoardingBlock([{ ...L("booked", null), arrival: null }, legs[1]!], 1, arrival)).toBe("previous_leg_not_boarded");
    expect(legBoardingBlock(legs, 1, arrival, { abandoned: true })).toBe("itinerary_closed");
  });

  it("finds the rebooking airport", () => {
    expect(currentItineraryAirport("SIN", [{ destination: "DOH", outcome: "complete" }, { destination: "LHR", outcome: null }])).toBe("DOH");
    expect(currentItineraryAirport("SIN", [{ destination: "DOH", outcome: "invalid" }, { destination: "LHR", outcome: null }])).toBe("SIN");
  });
});

describe("layover state, lounge and layover focus (FR-042, FR-043)", () => {
  const arrival = T0 + 8 * HOUR;
  const next: BookingTimes = { mode: "community", plannedDeparture: arrival + 2 * HOUR, plannedArrival: arrival + 9 * HOUR, createdAt: T0 };
  const at = (now: number, extra: Partial<Parameters<typeof layoverState>[0]> = {}) =>
    layoverState({ airport: "DOH", arrival, validatedAt: null, next, nextStatus: "booked", nextBoardedAt: null, now, ...extra });

  it("moves through deplaning, terminal, boarding and missed with gate countdowns", () => {
    expect(at(arrival - 1).phase).toBe("not_started");
    expect(at(arrival + 2 * MINUTE).phase).toBe("deplaning");
    expect(at(arrival + 2 * MINUTE, { validatedAt: arrival + MINUTE }).phase).toBe("in_terminal");
    expect(at(arrival + 11 * MINUTE).phase).toBe("in_terminal");
    const s = at(arrival + HOUR);
    expect(s).toMatchObject({ layoverMs: 2 * HOUR, msToDeparture: HOUR, msToBoardingOpen: 45 * MINUTE, airport: "DOH" });
    expect(at(next.plannedDeparture - 15 * MINUTE).phase).toBe("boarding_open");
    expect(at(next.plannedDeparture + MINUTE).phase).toBe("boarding_open"); // late join until takeoff
    expect(at(s.boardingClosesAt).phase).toBe("missed");
    expect(at(s.boardingClosesAt).msToBoardingClose).toBe(0);
    expect(at(next.plannedDeparture, { nextStatus: "boarded", nextBoardedAt: next.plannedDeparture - 10 * MINUTE }).phase).toBe("departed");
    expect(at(arrival + HOUR, { nextStatus: "cancelled" }).phase).toBe("cancelled");
  });

  it("connecting individual legs board like Community Flights: 15 min before until takeoff", () => {
    const individualNext: BookingTimes = { ...next, mode: "custom" };
    const takeoff = individualNext.plannedDeparture + takeoffOffsetMs(buildPhasePlan(individualNext.plannedArrival - individualNext.plannedDeparture));
    const s = at(arrival + HOUR, { next: individualNext });
    expect(s.boardingOpensAt).toBe(individualNext.plannedDeparture - COMMUNITY_BOARDING_OPENS_MS);
    expect(s.boardingClosesAt).toBe(takeoff);
    expect(at(takeoff - 1, { next: individualNext }).phase).toBe("boarding_open");
    expect(at(takeoff, { next: individualNext }).phase).toBe("missed");

    // First leg keeps its own mode; later legs use the community-style window.
    expect(itineraryLegBoardingWindow(individualNext, 0)).toEqual({ opensAt: individualNext.plannedDeparture, closesAt: individualNext.plannedArrival });
    expect(itineraryLegBoardingWindow(individualNext, 1)).toEqual({ opensAt: individualNext.plannedDeparture - 15 * MINUTE, closesAt: takeoff });
    expect(itineraryLegBoardingDecision(individualNext, 1, individualNext.plannedDeparture - 16 * MINUTE)).toBe("too_early");
    expect(itineraryLegBoardingDecision(individualNext, 1, individualNext.plannedDeparture - 5 * MINUTE)).toBe("open");
    expect(itineraryLegBoardingDecision(individualNext, 1, individualNext.plannedDeparture + MINUTE)).toBe("late_join");
    expect(itineraryLegBoardingDecision(individualNext, 1, takeoff)).toBe("no_show");
    expect(itineraryLegBoardingDecision(individualNext, 0, takeoff)).toBe("open"); // custom first leg: open until planned arrival

    // Late connecting passenger joins in progress: planned times kept, focus from boarding.
    const late = individualNext.plannedDeparture + 2 * MINUTE;
    expect(itineraryLegBoardedTimes(individualNext, 1, late)).toEqual({
      departure: individualNext.plannedDeparture,
      arrival: individualNext.plannedArrival,
      focusStart: late,
    });
    // On time: focus from planned departure, no boarding-sequence delay.
    expect(itineraryLegBoardedTimes(individualNext, 1, individualNext.plannedDeparture - 10 * MINUTE).focusStart).toBe(individualNext.plannedDeparture);
  });

  it("premium lounge only when either leg is business or first; never locked otherwise", () => {
    expect(loungeAccess("business", "economy")).toBe("premium");
    expect(loungeAccess("economy", "first")).toBe("premium");
    expect(loungeAccess("premium_economy", "economy")).toBe("terminal");
  });

  it("credits attended layover focus only inside the window", () => {
    const window = { start: arrival, end: arrival + 2 * HOUR };
    const events = [
      { type: "focus_start" as const, at: arrival - 10 * MINUTE }, // before the layover: ignored
      { type: "focus_start" as const, at: arrival + 10 * MINUTE },
      { type: "beat" as const, at: arrival + 14 * MINUTE },
      // 20-minute gap → unattended from +14 to +34
      { type: "beat" as const, at: arrival + 34 * MINUTE },
      { type: "focus_stop" as const, at: arrival + 38 * MINUTE },
      { type: "focus_start" as const, at: arrival + HOUR },
      { type: "beat" as const, at: arrival + HOUR + 4 * MINUTE },
    ];
    const provisional = layoverFocus(events, window, arrival + HOUR + 5 * MINUTE);
    expect(provisional.focusing).toBe(true);
    expect(provisional.final).toBe(false);
    expect(provisional.creditedMs).toBe((28 - 20 + 5) * MINUTE);

    // Session left running; the next leg is boarded at window end. Unattended after the last beat.
    const final = layoverFocus(events, window, arrival + 5 * HOUR);
    expect(final.final).toBe(true);
    expect(final.focusing).toBe(false);
    expect(final.focusMs).toBe(28 * MINUTE + HOUR);
    expect(final.unattended).toEqual([
      { start: arrival + 14 * MINUTE, end: arrival + 34 * MINUTE },
      { start: arrival + HOUR + 4 * MINUTE, end: window.end },
    ]);
    expect(final.creditedMs).toBe(8 * MINUTE + 4 * MINUTE);

    expect(layoverEventError(events, "focus_start", window, arrival + HOUR + 5 * MINUTE)).toBe("already_focusing");
    expect(layoverEventError(events, "focus_stop", window, arrival + 50 * MINUTE)).toBe("not_focusing");
    expect(layoverEventError(events, "beat", window, window.end)).toBe("outside_layover");
  });

  it("never credits layover focus that overlaps another flight session", () => {
    const window = { start: arrival, end: arrival + 2 * HOUR };
    const events = [
      { type: "focus_start" as const, at: arrival + 10 * MINUTE },
      ...[14, 18, 22, 26, 30, 34, 38].map((m) => ({ type: "beat" as const, at: arrival + m * MINUTE })),
      { type: "focus_stop" as const, at: arrival + 40 * MINUTE },
    ];
    expect(layoverFocus(events, window, window.end).creditedMs).toBe(30 * MINUTE);
    const other = [{ start: arrival + 5 * MINUTE, end: arrival + 20 * MINUTE }, { start: arrival + 35 * MINUTE, end: arrival + 3 * HOUR }];
    const summary = layoverFocus(events, window, window.end, other);
    expect(summary.focusMs).toBe(30 * MINUTE);
    expect(summary.creditedMs).toBe((30 - 10 - 5) * MINUTE);
    // Overlapping exclusions and unattended gaps are not subtracted twice.
    const gappy = [{ type: "focus_start" as const, at: arrival }, { type: "beat" as const, at: arrival + 20 * MINUTE }, { type: "focus_stop" as const, at: arrival + 20 * MINUTE }];
    expect(layoverFocus(gappy, window, window.end, [{ start: arrival, end: arrival + 10 * MINUTE }]).creditedMs).toBe(0);
  });
});

describe("connecting-flight notification plan", () => {
  it("orders landing, validation, layover, lounge and boarding events per leg", () => {
    const a1 = T0 + 8 * HOUR;
    const legs = [
      { times: { mode: "community" as const, plannedDeparture: T0, plannedArrival: a1, createdAt: T0 }, cabin: "business" as const, status: "boarded" as const },
      { times: { mode: "community" as const, plannedDeparture: a1 + 2 * HOUR, plannedArrival: a1 + 9 * HOUR, createdAt: T0 }, cabin: "economy" as const, status: "booked" as const },
    ];
    const plan = itineraryNotificationPlan(legs);
    expect(plan.map((n) => `${n.type}:${n.legIndex}`)).toEqual([
      "leg_landed:0",
      "layover_started:0",
      "lounge_available:0",
      "validate_reminder:0",
      "boarding_open:1",
      "boarding_closing:1",
      "connection_missed:1",
      "leg_landed:1",
      "validate_reminder:1",
    ]);
    expect(plan.find((n) => n.type === "validate_reminder")!.at).toBe(a1 + 5 * MINUTE);
    expect(plan.find((n) => n.type === "boarding_open")!.at).toBe(a1 + 2 * HOUR - 15 * MINUTE);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.at).toBeGreaterThanOrEqual(plan[i - 1]!.at);

    // After boarding leg 2, conditional boarding events disappear; `after` drops past events.
    const boarded = itineraryNotificationPlan([legs[0]!, { ...legs[1]!, status: "boarded" as const }], { after: a1 + HOUR });
    expect(boarded.map((n) => n.type)).toEqual(["leg_landed", "validate_reminder"]);
    // itinerary_complete only once the final leg is validated.
    const validatedAt = a1 + 9 * HOUR + 2 * MINUTE;
    const done = itineraryNotificationPlan([legs[0]!, { ...legs[1]!, status: "boarded" as const, validatedAt }], { after: a1 + HOUR });
    expect(done).toEqual([
      { type: "leg_landed", at: a1 + 9 * HOUR, legIndex: 1 },
      { type: "itinerary_complete", at: validatedAt, legIndex: 1 },
    ]);
    // Economy both ways: no lounge notification. Cancelled next leg: no layover events.
    expect(itineraryNotificationPlan([{ ...legs[0]!, cabin: "economy" }, legs[1]!]).some((n) => n.type === "lounge_available")).toBe(false);
    expect(itineraryNotificationPlan([legs[0]!, { ...legs[1]!, status: "cancelled" as const }]).map((n) => n.type)).toEqual(["leg_landed", "validate_reminder"]);
  });

  it("drops landing, layover and boarding events once a leg has failed", () => {
    const a1 = T0 + 8 * HOUR;
    const a2 = a1 + 9 * HOUR;
    const legs = [
      { times: { mode: "community" as const, plannedDeparture: T0, plannedArrival: a1, createdAt: T0 }, cabin: "business" as const, status: "boarded" as const },
      { times: { mode: "community" as const, plannedDeparture: a1 + 2 * HOUR, plannedArrival: a2, createdAt: T0 }, cabin: "economy" as const, status: "booked" as const },
      { times: { mode: "community" as const, plannedDeparture: a2 + 2 * HOUR, plannedArrival: a2 + 5 * HOUR, createdAt: T0 }, cabin: "economy" as const, status: "booked" as const },
    ];
    expect(itineraryNotificationPlan(legs).some((n) => n.legIndex === 2)).toBe(true);
    for (const outcome of ["invalid", "ended_early"] as const) {
      expect(itineraryNotificationPlan([{ ...legs[0]!, outcome }, legs[1]!, legs[2]!])).toEqual([]);
    }
    // Leg 2 failed in flight: leg 1's events stay, nothing for legs 2 and 3.
    const plan = itineraryNotificationPlan([{ ...legs[0]!, outcome: "complete", validatedAt: a1 + MINUTE }, { ...legs[1]!, status: "boarded", outcome: "ended_early" }, legs[2]!]);
    expect(plan.map((n) => `${n.type}:${n.legIndex}`)).toEqual(["leg_landed:0", "layover_started:0", "lounge_available:0"]);
    // A missed connection (no-show) ends the plan too.
    expect(itineraryNotificationPlan([legs[0]!, { ...legs[1]!, status: "no_show" }, legs[2]!]).map((n) => n.type)).toEqual(["leg_landed", "validate_reminder"]);
  });

  it("uses the connecting-leg boarding window for individual later legs", () => {
    const a1 = T0 + 8 * HOUR;
    const next = { mode: "custom" as const, plannedDeparture: a1 + 2 * HOUR, plannedArrival: a1 + 9 * HOUR, createdAt: T0 };
    const takeoff = next.plannedDeparture + takeoffOffsetMs(buildPhasePlan(next.plannedArrival - next.plannedDeparture));
    const plan = itineraryNotificationPlan([
      { times: { mode: "depart_now" as const, plannedDeparture: T0, plannedArrival: a1, createdAt: T0 }, cabin: "economy", status: "boarded" },
      { times: next, cabin: "economy", status: "booked" },
    ]);
    expect(plan.find((n) => n.type === "boarding_open")!.at).toBe(next.plannedDeparture - 15 * MINUTE);
    expect(plan.find((n) => n.type === "connection_missed")!.at).toBe(takeoff);
    expect(plan.find((n) => n.type === "boarding_closing")!.at).toBe(takeoff - 5 * MINUTE);
  });
});

describe("transit marks, stats and journey achievements (FR-048–FR-050, FR-045)", () => {
  it("builds transit and final marks with visit numbers", () => {
    const s = snapshot({ destination: "DOH" });
    const transit = buildTravelMark({ snapshot: s, destinationCountry: "QA", arrival: T0, userTimeZone: "UTC", designs: [], isTransit: true, visitNumber: 2 });
    expect(transit).toMatchObject({ isTransit: true, visitNumber: 2, designId: "generic-arrival", virtual: true });
    const plain = buildTravelMark({ snapshot: s, destinationCountry: "QA", arrival: T0, userTimeZone: "UTC", designs: [] });
    expect(plain).toMatchObject({ isTransit: false, visitNumber: 1 });
    expect(nextVisitNumber([{ country: "QA" }, { country: "GB" }, { country: "QA" }], "QA")).toBe(3);
    expect(nextVisitNumber([], "QA")).toBe(1);
  });

  const rec = (o: Partial<FlightRecord>): FlightRecord => ({
    outcome: "complete", departure: T0, arrival: T0 + HOUR, blockMs: HOUR, creditedFocusMs: 50 * MINUTE, breakMs: 10 * MINUTE,
    creditedFlightMs: HOUR, origin: "SIN", destination: "LHR", destinationCountry: "GB", airline: "SQ", aircraftType: "359", distanceKm: 1000,
    ...o,
  });
  /** A completed 2-leg itinerary via `via`, departing `startH` hours after T0. */
  const twoLeg = (id: string, via: string, viaCountry: string, startH: number, premium = false, status: FlightRecord["itineraryStatus"] = "complete"): FlightRecord[] => [
    rec({ itineraryId: id, legIndex: 0, itineraryLegs: 2, itineraryStatus: status, isTransit: true, layoverMs: 2 * HOUR, premiumLounge: premium,
      origin: "SIN", destination: via, destinationCountry: viaCountry, departure: T0 + startH * HOUR, arrival: T0 + (startH + 8) * HOUR }),
    rec({ itineraryId: id, legIndex: 1, itineraryLegs: 2, itineraryStatus: status, origin: via, destination: "LHR",
      outcome: status === "complete" ? "complete" : "invalid", departure: T0 + (startH + 10) * HOUR, arrival: T0 + (startH + 17) * HOUR }),
  ];

  it("computes itinerary statistics without changing existing fields", () => {
    const records = [
      ...twoLeg("a", "DOH", "QA", 0, true),
      ...twoLeg("b", "DXB", "AE", 24, false),
      ...twoLeg("c", "DOH", "QA", 48, false, "incomplete"),
      rec({ itineraryId: "d", legIndex: 0, itineraryLegs: 2, itineraryStatus: "abandoned", isTransit: true, destination: "HKG", destinationCountry: "HK" }),
      rec({ destination: "KUL", destinationCountry: "MY" }), // single booking
    ];
    const stats = computeStats(records, T0 + 70 * HOUR, "UTC");
    expect(stats.completedFlights).toBe(7);
    expect(stats).toMatchObject({
      itinerariesCompleted: 2,
      multiLegItinerariesCompleted: 2,
      multiLegCompletionRate: 0.5,
      longestCompletedItineraryLegs: 2,
      transitAirports: 4 - 1, // DOH, DXB, HKG
      finalDestinations: 2, // LHR, KUL
      totalLayoverMs: 2 * HOUR * 3, // a, b, c (c's transit leg completed and leg 2 was boarded)
      longestJourneyMs: 17 * HOUR,
      premiumLoungeLayovers: 1,
    });
    expect(stats.countryVisits).toEqual({ QA: { transit: 2, final: 0 }, AE: { transit: 1, final: 0 }, HK: { transit: 1, final: 0 }, GB: { transit: 0, final: 2 }, MY: { transit: 0, final: 1 } });
    expect(computeStats([], T0, "UTC")).toMatchObject({ itinerariesCompleted: 0, multiLegCompletionRate: null, longestJourneyMs: 0, countryVisits: {} });
    // Final layover focus counts towards credited focus.
    const withLayoverFocus = computeStats([rec({ layoverFocusMs: 20 * MINUTE })], T0, "UTC");
    expect(withLayoverFocus.creditedFocusMs).toBe(50 * MINUTE + 20 * MINUTE);
  });

  it("counts layover focus towards the study streak and Marathon Week like credited focus", () => {
    // A failed leg with no flight focus but layover focus still makes a study day.
    const layoverOnly = rec({ outcome: "invalid", creditedFocusMs: 0, layoverFocusMs: 30 * MINUTE, arrival: T0 + HOUR });
    expect(studyStreakDays([layoverOnly], T0 + 2 * HOUR, "UTC")).toBe(1);
    expect(studyStreakDays([{ ...layoverOnly, layoverFocusMs: null }], T0 + 2 * HOUR, "UTC")).toBe(0);
    expect(computeStats([layoverOnly], T0 + 2 * HOUR, "UTC").currentStreakDays).toBe(1);

    const marathon = (layoverFocusMs: number) =>
      earnedAchievements(computeStats([rec({ creditedFocusMs: 19 * HOUR, layoverFocusMs })], T0 + 2 * HOUR, "UTC"),
        [rec({ creditedFocusMs: 19 * HOUR, layoverFocusMs })], T0 + 2 * HOUR).some((a) => a.id === "marathon_week");
    expect(marathon(0)).toBe(false);
    expect(marathon(HOUR)).toBe(true);
  });

  it("derives itinerary completion from leg outcomes only when the leg count is known", () => {
    const partial = [rec({ itineraryId: "x", legIndex: 0, itineraryLegs: 2, isTransit: true })];
    expect(computeStats(partial, T0, "UTC").itinerariesCompleted).toBe(0);
    const full = [...partial, rec({ itineraryId: "x", legIndex: 1, itineraryLegs: 2 })];
    expect(computeStats(full, T0, "UTC").itinerariesCompleted).toBe(1);
    // Without itineraryLegs or itineraryStatus a completed first leg must not look like a finished journey.
    const unknown = [rec({ itineraryId: "y", legIndex: 0, isTransit: true })];
    expect(computeStats(unknown, T0, "UTC")).toMatchObject({ itinerariesCompleted: 0, multiLegCompletionRate: null });
    const unknownBoth = [...unknown, rec({ itineraryId: "y", legIndex: 1 })];
    expect(computeStats(unknownBoth, T0, "UTC").itinerariesCompleted).toBe(0);
    // A stored status still counts.
    expect(computeStats([rec({ itineraryId: "z", legIndex: 0, itineraryStatus: "complete" })], T0, "UTC").itinerariesCompleted).toBe(1);
  });

  it("awards the journey achievements", () => {
    const ids = (records: FlightRecord[]) => earnedAchievements(computeStats(records, T0, "UTC"), records, T0).map((a) => a.id);
    const journey = ACHIEVEMENTS.filter((a) => a.category === "journey").map((a) => a.id);
    expect(journey).toEqual(["first_connection", "three_leg_journey", "hub_hopper", "smooth_operator", "lounge_regular"]);
    expect(ACHIEVEMENTS.filter((a) => a.category === "journey" && a.special).map((a) => a.id)).toEqual(["hub_hopper", "smooth_operator"]);

    expect(ids([rec({})]).filter((id) => journey.includes(id))).toEqual([]);
    expect(ids(twoLeg("a", "DOH", "QA", 0))).toContain("first_connection");
    expect(ids(twoLeg("a", "DOH", "QA", 0, false, "incomplete"))).not.toContain("first_connection");

    const three = [
      rec({ itineraryId: "t", legIndex: 0, itineraryLegs: 3, isTransit: true, destination: "SIN", layoverMs: HOUR }),
      rec({ itineraryId: "t", legIndex: 1, itineraryLegs: 3, isTransit: true, destination: "DOH", layoverMs: HOUR }),
      rec({ itineraryId: "t", legIndex: 2, itineraryLegs: 3, destination: "LHR" }),
    ];
    expect(ids(three)).toEqual(expect.arrayContaining(["first_connection", "three_leg_journey"]));

    const hubs = ["DOH", "DXB", "HKG", "ICN", "HND"];
    const many = hubs.flatMap((h, i) => twoLeg(`h${i}`, h, h, i * 24, true));
    expect(ids(many)).toEqual(expect.arrayContaining(["hub_hopper", "smooth_operator", "lounge_regular"]));
    expect(ids(many.slice(0, 8))).not.toContain("smooth_operator");
  });
});
