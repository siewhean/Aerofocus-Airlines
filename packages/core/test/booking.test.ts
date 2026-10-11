import { describe, expect, it } from "vitest";
import {
  assignAirlineTiers,
  assignSeat,
  BOARDING_SEQUENCE_MS,
  boardedTimes,
  boardingDecision,
  bookingWindowEnd,
  cabinAvailabilityWarnings,
  checkBookingRequest,
  COMMUNITY_BOARDING_OPENS_MS,
  DAY,
  fitsStudyWindow,
  HOUR,
  levelFor,
  MINUTE,
  nextLevelProgress,
  pickRandomFlight,
  plannedTimes,
  seededRng,
  unlockStateFor,
  type Airline,
  type BookingTimes,
} from "../src";
import { snapshot, T0 } from "./fixtures";

const starter = { airlineTier: 0, cabinClasses: ["economy"] as const };

describe("booking window (FR-002)", () => {
  it("AC-26: refuses bookings more than 7 days ahead", () => {
    const now = Date.UTC(2026, 9, 12, 4, 0); // 12:00 in Singapore
    const end = bookingWindowEnd(now, "Asia/Singapore");
    expect(end).toBe(Date.UTC(2026, 9, 19, 16, 0)); // midnight starting 20 Oct, Singapore time
    const tooFar = snapshot({ departure: end + MINUTE, arrival: end + 2 * HOUR });
    const errors = checkBookingRequest({
      mode: "community", snapshot: tooFar, cabin: "economy", now, userTimeZone: "Asia/Singapore",
      unlocks: starter, airlineTier: 0,
    });
    expect(errors).toContain("outside_booking_window");
  });
});

describe("departure modes (FR-004)", () => {
  const s = snapshot();
  const block = s.arrival - s.departure;

  it("AC-02: Depart Now keeps the published duration", () => {
    const p = plannedTimes("depart_now", s, { now: T0 });
    expect(p.arrival - p.departure).toBe(block);
    expect(p.departure).toBe(T0 + BOARDING_SEQUENCE_MS);
  });

  it("AC-03: Custom Departure recalculates arrival from the chosen time", () => {
    const chosen = T0 + 3 * DAY;
    expect(plannedTimes("custom", s, { now: T0, chosenDeparture: chosen })).toEqual({ departure: chosen, arrival: chosen + block });
  });

  it("AC-04: Community Flights keep published times", () => {
    expect(plannedTimes("community", s, { now: T0 })).toEqual({ departure: s.departure, arrival: s.arrival });
  });

  it("AC-23: study windows never compress a flight", () => {
    const window = { start: T0, end: T0 + 2 * HOUR };
    expect(fitsStudyWindow({ departure: T0, arrival: T0 + 2 * HOUR }, window)).toBe(true);
    expect(fitsStudyWindow({ departure: T0, arrival: T0 + 14 * HOUR }, window)).toBe(false);
  });
});

describe("boarding (FR-004)", () => {
  const community: BookingTimes = { mode: "community", plannedDeparture: T0, plannedArrival: T0 + 5 * HOUR, createdAt: T0 - DAY };

  it("Community Flight boarding opens 15 minutes before departure", () => {
    expect(boardingDecision(community, T0 - COMMUNITY_BOARDING_OPENS_MS - 1)).toBe("too_early");
    expect(boardingDecision(community, T0 - COMMUNITY_BOARDING_OPENS_MS)).toBe("open");
  });

  it("AC-29: late passengers may join until takeoff, then it is a no-show", () => {
    expect(boardingDecision(community, T0 + 10 * MINUTE)).toBe("late_join");
    expect(boardingDecision(community, T0 + 15 * MINUTE)).toBe("no_show");
    const times = boardedTimes(community, T0 + 10 * MINUTE);
    expect(times.departure).toBe(T0);
    expect(times.focusStart).toBe(T0 + 10 * MINUTE);
  });

  it("AC-35: a late Custom Departure departs when boarding ends and lands correspondingly later", () => {
    const custom: BookingTimes = { mode: "custom", plannedDeparture: T0, plannedArrival: T0 + 2 * HOUR, createdAt: T0 - DAY };
    expect(boardingDecision(custom, T0 - MINUTE)).toBe("too_early");
    const times = boardedTimes(custom, T0 + 10 * MINUTE);
    expect(times.departure).toBe(T0 + 10 * MINUTE + BOARDING_SEQUENCE_MS);
    expect(times.arrival - times.departure).toBe(2 * HOUR);
    expect(boardingDecision(custom, T0 + 2 * HOUR)).toBe("no_show");
  });
});

describe("unlocks (FR-065 to FR-067)", () => {
  it("starts with Economy on budget airlines", () => {
    const u = unlockStateFor({ creditedFocusMs: 0, completedFlights: 0, countries: 0, specialAchievements: 0 });
    expect(u).toEqual({ airlineTier: 0, cabinClasses: ["economy"] });
  });

  it("unlocks classes and airline tiers with progress", () => {
    const stats = { creditedFocusMs: 35 * HOUR, completedFlights: 12, countries: 4, specialAchievements: 0 };
    expect(levelFor(stats).id).toBe("silver");
    expect(unlockStateFor(stats).cabinClasses).toEqual(["economy", "premium_economy", "business"]);
    expect(nextLevelProgress(stats)?.missing.countries).toBe(11);
  });

  it("AC-27: locked airlines and classes cannot be booked", () => {
    const errors = checkBookingRequest({
      mode: "community", snapshot: snapshot(), cabin: "business", now: T0, userTimeZone: "UTC",
      unlocks: starter, airlineTier: 6,
    });
    expect(errors).toEqual(expect.arrayContaining(["airline_locked", "cabin_locked"]));
  });

  it("orders airlines budget first, then full-service from lower- to higher-ranked", () => {
    const airlines: Airline[] = [
      { iata: "B1", name: "Budget", type: "budget", skytraxRank: null, rankSource: "sample" },
      ...Array.from({ length: 12 }, (_, i) => ({
        iata: `F${i + 1}`, name: `Full ${i + 1}`, type: "full_service" as const, skytraxRank: i + 1, rankSource: "sample" as const,
      })),
    ];
    const tiers = assignAirlineTiers(airlines);
    expect(tiers.get("B1")).toBe(0);
    expect(tiers.get("F1")).toBe(6);
    expect(tiers.get("F12")).toBe(1);
    expect(tiers.get("F12")! <= tiers.get("F5")!).toBe(true);
  });

  it("warns when a cabin unlocks before any unlocked airline sells it", () => {
    const tiers = new Map([["SQ", 6]]);
    expect(cabinAvailabilityWarnings(tiers, [snapshot()])).toHaveLength(3);
  });
});

describe("Random Flight (FR-005)", () => {
  const candidates = [
    snapshot({ id: "short", arrival: snapshot().departure + 55 * MINUTE }),
    snapshot({ id: "fit", arrival: snapshot().departure + 85 * MINUTE }),
    snapshot({ id: "long", arrival: snapshot().departure + 14 * HOUR }),
  ];

  it("AC-33: picks a real flight that fits the study duration", () => {
    const pick = pickRandomFlight(candidates, 90 * MINUTE, seededRng(1));
    expect(pick?.snapshot.id).toBe("fit");
  });

  it("makes Business and First rare but possible", () => {
    const rng = seededRng("odds");
    const counts: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) {
      const cabin = pickRandomFlight(candidates, 90 * MINUTE, rng)?.cabin ?? "none";
      counts[cabin] = (counts[cabin] ?? 0) + 1;
    }
    expect(counts.economy!).toBeGreaterThan(3000);
    expect(counts.first!).toBeGreaterThan(50);
    expect(counts.first!).toBeLessThan(400);
  });

  it("random draws bypass unlocks", () => {
    const errors = checkBookingRequest({
      mode: "depart_now", snapshot: snapshot(), cabin: "first", now: T0, userTimeZone: "UTC",
      unlocks: starter, airlineTier: 6, isRandomDraw: true,
    });
    expect(errors).toEqual([]);
  });

  it("returns null when nothing fits", () => {
    expect(pickRandomFlight(candidates, 30 * MINUTE, seededRng(1))).toBeNull();
  });
});

describe("seats (FR-010)", () => {
  it("individual flights always get a window seat with a wing view, even in First", () => {
    const rng = seededRng(3);
    for (const cabin of ["economy", "business", "first"] as const) {
      const seat = assignSeat("depart_now", "widebody_quad", cabin, rng);
      expect(seat.isWindow).toBe(true);
      expect(seat.wingView).toBe(true);
    }
  });

  it("Community Flight seats can be anywhere in the cabin", () => {
    const rng = seededRng(9);
    const seats = Array.from({ length: 200 }, () => assignSeat("community", "narrowbody", "economy", rng));
    expect(seats.some((s) => !s.isWindow)).toBe(true);
    expect(seats.some((s) => s.isWindow && !s.wingView)).toBe(true);
  });
});
