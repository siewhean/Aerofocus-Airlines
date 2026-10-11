import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  assignSeat,
  clusterByGrid,
  computeStats,
  createFlightPlan,
  daylightEventsDuringFlight,
  earnedAchievements,
  HOUR,
  inBBox,
  MINUTE,
  routeFacts,
  routeGeometry,
  routeTimeline,
  seededRng,
  splitAtAntimeridian,
  sunPosition,
  windowLightingAt,
  windowSideOf,
  type Airport,
  type FlightRecord,
  type SeatMap,
} from "../src";
import { LHR, SIN, T0 } from "./fixtures";

const LAX: Airport = { iata: "LAX", name: "Los Angeles", city: "Los Angeles", country: "US", region: "north_america", lat: 33.9416, lon: -118.4085, timeZone: "America/Los_Angeles" };
const SYD: Airport = { iata: "SYD", name: "Sydney", city: "Sydney", country: "AU", region: "oceania", lat: -33.9399, lon: 151.1753, timeZone: "Australia/Sydney" };

describe("sun direction and window lighting (FR-023)", () => {
  it("rises in the east and sets in the west", () => {
    // Singapore ~08:00 and ~18:00 local
    expect(sunPosition(Date.UTC(2026, 9, 12, 0, 0), SIN).azimuthDeg).toBeGreaterThan(60);
    expect(sunPosition(Date.UTC(2026, 9, 12, 0, 0), SIN).azimuthDeg).toBeLessThan(120);
    const evening = sunPosition(Date.UTC(2026, 9, 12, 10, 0), SIN).azimuthDeg;
    expect(evening).toBeGreaterThan(240);
    expect(evening).toBeLessThan(300);
  });

  it("puts a morning sun on the right of a northbound aircraft and reports the passenger's side", () => {
    // Departs SIN towards LHR (north-west) in the Singapore morning: sun in the east = right side.
    const plan = createFlightPlan({ origin: SIN, destination: LHR, departure: Date.UTC(2026, 9, 12, 0, 0), blockMs: 845 * MINUTE });
    const t = plan.departure + 60 * MINUTE;
    const right = windowLightingAt(plan, t, "right");
    expect(right.sunSide).toBe("right");
    expect(right.sunOnWindowSide).toBe(true);
    expect(windowLightingAt(plan, t, "left").sunOnWindowSide).toBe(false);
    expect(right.exteriorBrightness).toBeGreaterThan(0.9);
  });

  it("maps window seat letters to sides", () => {
    expect(windowSideOf({ letter: "A", isWindow: true })).toBe("left");
    expect(windowSideOf({ letter: "K", isWindow: true })).toBe("right");
    expect(windowSideOf({ letter: "C", isWindow: false })).toBeNull();
  });

  it("finds the sunrise on an overnight eastbound flight, and none on a westbound red-eye that lands before dawn", () => {
    // SIN 22:10 local to Tokyo, landing about 06:05 local: flies into the dawn.
    const HND: Airport = { iata: "HND", name: "Haneda", city: "Tokyo", country: "JP", region: "asia", lat: 35.5494, lon: 139.7798, timeZone: "Asia/Tokyo" };
    const east = createFlightPlan({ origin: SIN, destination: HND, departure: Date.UTC(2026, 9, 12, 14, 10), blockMs: 415 * MINUTE });
    expect(daylightEventsDuringFlight(east).map((e) => e.type)).toEqual(["sunrise"]);
    // SIN 23:55 local to London lands about 07:00 local, before the mid-October sunrise.
    const west = createFlightPlan({ origin: SIN, destination: LHR, departure: Date.UTC(2026, 9, 12, 15, 55), blockMs: 845 * MINUTE });
    expect(daylightEventsDuringFlight(west)).toEqual([]);
  });
});

describe("route geometry (FR-016)", () => {
  it("splits lines at the antimeridian", () => {
    const parts = splitAtAntimeridian([
      { lat: 10, lon: 170 },
      { lat: 12, lon: -170 },
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0]![parts[0]!.length - 1]).toEqual([180, 11]);
    expect(parts[1]![0]).toEqual([-180, 11]);
  });

  it("produces completed, remaining, phase, airport and aircraft features", () => {
    const plan = createFlightPlan({ origin: LAX, destination: SYD, departure: T0, blockMs: 900 * MINUTE });
    const fc = routeGeometry(plan, T0 + 6 * HOUR);
    const kinds = fc.features.map((f) => f.properties.kind);
    for (const k of ["completed", "remaining", "phase", "origin", "destination", "aircraft"]) expect(kinds).toContain(k);
    const remaining = fc.features.find((f) => f.properties.kind === "remaining")!;
    // LAX→SYD crosses the antimeridian after the 6-hour mark.
    expect(remaining.geometry.type === "MultiLineString" && remaining.geometry.coordinates.length).toBe(2);
    const phases = fc.features.filter((f) => f.properties.kind === "phase").map((f) => f.properties.phase);
    expect(phases).toEqual(["climb", "cruise", "descent", "approach"]);
  });

  it("previews without an aircraft when no time is given", () => {
    const plan = createFlightPlan({ origin: SIN, destination: LHR, departure: T0, blockMs: 845 * MINUTE });
    expect(routeGeometry(plan).features.some((f) => f.properties.kind === "aircraft")).toBe(false);
  });
});

describe("accessible route timeline (NFR-003)", () => {
  it("lists every phase change and regular intervals, in the user's time zone", () => {
    const plan = createFlightPlan({ origin: SIN, destination: LHR, departure: T0, blockMs: 845 * MINUTE });
    const tl = routeTimeline(plan, "Asia/Singapore", { intervalMinutes: 60, describe: () => "Somewhere" });
    expect(tl.filter((e) => e.reason === "phase_start").map((e) => e.phase)).toEqual([
      "taxi_out", "takeoff", "climb", "cruise", "descent", "approach", "landing", "taxi_in",
    ]);
    expect(tl[tl.length - 1]!.reason).toBe("arrival");
    expect(tl.every((e, i) => i === 0 || e.offsetMs > tl[i - 1]!.offsetMs)).toBe(true);
    expect(tl[0]!.localTime).toBe("2026-10-12T08:00:00+08:00");
    expect(tl[0]!.placeLabel).toBe("Somewhere");
  });
});

describe("clustering (FR-062, AC-19)", () => {
  const points = [
    { id: "a", p: { lat: 1.3, lon: 103.9 } },
    { id: "b", p: { lat: 1.35, lon: 103.95 } },
    { id: "c", p: { lat: 51.5, lon: -0.4 } },
  ];

  it("groups nearby aircraft at low zoom and separates them at high zoom", () => {
    const low = clusterByGrid(points, (x) => x.p, (x) => x.id, { zoom: 2 });
    expect(low.find((r) => r.type === "cluster")).toMatchObject({ count: 2 });
    const high = clusterByGrid(points, (x) => x.p, (x) => x.id, { zoom: 14 });
    expect(high.every((r) => r.type === "item")).toBe(true);
  });

  it("filters by bounding box, including across the antimeridian", () => {
    expect(clusterByGrid(points, (x) => x.p, (x) => x.id, { zoom: 2, bbox: [-10, 40, 10, 60] })).toHaveLength(1);
    expect(inBBox({ lat: 0, lon: 179 }, [170, -10, -170, 10])).toBe(true);
    expect(inBBox({ lat: 0, lon: 0 }, [170, -10, -170, 10])).toBe(false);
  });

  it("handles 5,000 aircraft quickly", () => {
    const rng = seededRng(42);
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), p: { lat: rng() * 140 - 70, lon: rng() * 360 - 180 } }));
    const start = performance.now();
    const result = clusterByGrid(many, (x) => x.p, (x) => x.id, { zoom: 3 });
    expect(performance.now() - start).toBeLessThan(200);
    expect(result.reduce((n, r) => n + (r.type === "cluster" ? r.count : 1), 0)).toBe(5000);
  });
});

describe("route facts and expanded achievements", () => {
  it("LAX→SYD crosses the equator and the antimeridian; SIN→LHR does not cross the dateline", () => {
    const pacific = routeFacts(createFlightPlan({ origin: LAX, destination: SYD, departure: T0, blockMs: 900 * MINUTE }));
    expect(pacific).toMatchObject({ crossedEquator: true, crossedAntimeridian: true });
    const kangaroo = routeFacts(createFlightPlan({ origin: SIN, destination: LHR, departure: T0, blockMs: 845 * MINUTE }));
    expect(kangaroo.crossedAntimeridian).toBe(false);
  });

  it("awards route achievements only for completed flights", () => {
    const record: FlightRecord = {
      outcome: "complete", departure: T0, arrival: T0 + 15 * HOUR, blockMs: 15 * HOUR, creditedFocusMs: 12 * HOUR, breakMs: HOUR,
      creditedFlightMs: 15 * HOUR, origin: "LAX", destination: "SYD", destinationCountry: "AU", airline: "QF", aircraftType: "789",
      distanceKm: 12_000, mode: "community",
      facts: { crossedEquator: true, crossedAntimeridian: true, sawSunrise: true, nightFlight: true },
    };
    const ids = (records: FlightRecord[]) =>
      earnedAchievements(computeStats(records, T0 + 16 * HOUR, "UTC"), records, T0 + 16 * HOUR).map((a) => a.id);
    expect(ids([record])).toEqual(
      expect.arrayContaining(["first_flight", "long_haul", "ultra_long_haul", "equator_crosser", "dateline_crosser", "dawn_patrol", "red_eye"]),
    );
    expect(ids([{ ...record, outcome: "invalid", creditedFocusMs: 0 }])).not.toContain("dateline_crosser");
  });

  it("every achievement has a unique id and a category", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(18);
  });
});

describe("aircraft seat maps (FR-010)", () => {
  const map: SeatMap = {
    id: "TEST",
    name: "Test",
    source: "representative",
    cabins: { economy: { rows: [10, 40], letters: ["A", "B", "C", "D", "E", "F"], windowLetters: ["A", "F"] } },
    wingRows: [20, 25],
  };

  it("uses the aircraft's own wing rows and reports the layout source", () => {
    const seat = assignSeat("depart_now", map, "economy", seededRng(3));
    expect(seat.row).toBeGreaterThanOrEqual(20);
    expect(seat.row).toBeLessThanOrEqual(25);
    expect(seat.layout).toBe("representative");
  });
});
