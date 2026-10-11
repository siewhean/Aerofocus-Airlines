import { describe, expect, it } from "vitest";
import {
  buildPhasePlan,
  createFlightPlan,
  daylightAt,
  distanceFractionAt,
  flightStateAt,
  greatCircleDistanceKm,
  HOUR,
  inspectAtDistanceFraction,
  inspectAtOffset,
  inspectNearestPoint,
  MIN_CRUISE_SHARE,
  MINUTE,
  offsetAtDistanceFraction,
  solarElevationDeg,
  takeoffOffsetMs,
} from "../src";
import { KUL, LHR, SIN, T0 } from "./fixtures";

describe("phase model (FR-011a)", () => {
  it("uses default durations with cruise taking the remainder", () => {
    const plan = buildPhasePlan(845 * MINUTE);
    const byPhase = Object.fromEntries(plan.map((s) => [s.phase, (s.endMs - s.startMs) / MINUTE]));
    expect(byPhase).toMatchObject({ taxi_out: 15, takeoff: 1, climb: 20, descent: 25, approach: 8, landing: 1, taxi_in: 7 });
    expect(byPhase.cruise).toBeCloseTo(845 - 77);
    expect(plan[plan.length - 1]?.endMs).toBe(845 * MINUTE);
  });

  it("scales non-cruise phases so cruise is 15% of short flights", () => {
    const block = 35 * MINUTE;
    const plan = buildPhasePlan(block);
    const cruise = plan.find((s) => s.phase === "cruise");
    expect(cruise && (cruise.endMs - cruise.startMs) / block).toBeCloseTo(MIN_CRUISE_SHARE);
    expect(plan[plan.length - 1]?.endMs).toBe(block);
  });

  it("phases are contiguous and ordered", () => {
    const plan = buildPhasePlan(70 * MINUTE);
    for (let i = 1; i < plan.length; i++) expect(plan[i]?.startMs).toBe(plan[i - 1]?.endMs);
  });

  it("distance and time map are inverse; no distance is covered while taxiing", () => {
    const plan = buildPhasePlan(845 * MINUTE);
    expect(distanceFractionAt(plan, 10 * MINUTE)).toBe(0);
    expect(distanceFractionAt(plan, takeoffOffsetMs(plan))).toBe(0);
    for (const f of [0.1, 0.5, 0.9]) expect(distanceFractionAt(plan, offsetAtDistanceFraction(plan, f))).toBeCloseTo(f, 6);
    expect(distanceFractionAt(plan, 840 * MINUTE)).toBe(1);
  });

  it("does not assume constant speed: halfway in time is not halfway in distance on short flights", () => {
    const plan = buildPhasePlan(60 * MINUTE);
    expect(distanceFractionAt(plan, 30 * MINUTE)).not.toBeCloseTo(0.5, 2);
  });
});

describe("flight state", () => {
  const plan = createFlightPlan({ origin: SIN, destination: LHR, departure: T0, blockMs: 845 * MINUTE });

  it("is scheduled before pushback, in flight during, arrived after", () => {
    expect(flightStateAt(plan, T0 - MINUTE).status).toBe("scheduled");
    const mid = flightStateAt(plan, T0 + 6 * HOUR);
    expect(mid.status).toBe("in_flight");
    expect(mid.phase).toBe("cruise");
    expect(mid.altitudeFt).toBeGreaterThan(30_000);
    const end = flightStateAt(plan, T0 + 900 * MINUTE);
    expect(end.status).toBe("arrived");
    expect(end.remainingMs).toBe(0);
  });

  it("AC-10: state is recomputed from timestamps alone, so a refresh restores remaining time", () => {
    const t = T0 + 123 * MINUTE + 7_000;
    const fresh = createFlightPlan({ origin: SIN, destination: LHR, departure: T0, blockMs: 845 * MINUTE });
    expect(flightStateAt(fresh, t).remainingMs).toBe(845 * MINUTE - 123 * MINUTE - 7_000);
  });

  it("sits at the origin airport during taxi-out", () => {
    const s = flightStateAt(plan, T0 + 5 * MINUTE);
    expect(greatCircleDistanceKm(s.position, SIN)).toBeLessThan(1);
    expect(s.phase).toBe("taxi_out");
  });
});

describe("route inspection (FR-017, FR-019)", () => {
  const plan = createFlightPlan({ origin: SIN, destination: LHR, departure: T0, blockMs: 845 * MINUTE });

  it("AC-05: shows location, phase and the user's local clock time for a future point", () => {
    const p = inspectAtOffset(plan, 10 * HOUR, "Asia/Singapore");
    expect(p.instant).toBe(T0 + 10 * HOUR);
    expect(p.localTime).toBe("2026-10-12T18:00:00+08:00");
    expect(p.phase).toBe("cruise");
    expect(p.remainingMs).toBe(845 * MINUTE - 10 * HOUR);
    expect(p.estimated).toBe(true);
  });

  it("AC-31: times follow the user's time zone, not origin or destination", () => {
    expect(inspectAtOffset(plan, 0, "America/New_York").localTime).toBe("2026-10-11T20:00:00-04:00");
  });

  it("AC-06: inspecting does not change the live flight state", () => {
    const before = flightStateAt(plan, T0 + 2 * HOUR);
    inspectAtOffset(plan, 12 * HOUR, "UTC");
    inspectAtDistanceFraction(plan, 0.1, "UTC");
    expect(flightStateAt(plan, T0 + 2 * HOUR)).toEqual(before);
  });

  it("AC-07: a tapped location maps to the nearest point on the path", () => {
    const target = inspectAtDistanceFraction(plan, 0.6, "UTC");
    const tapped = inspectNearestPoint(plan, { lat: target.position.lat + 0.05, lon: target.position.lon }, "UTC");
    expect(tapped.distanceFraction).toBeCloseTo(0.6, 2);
  });

  it("clamps offsets outside the flight", () => {
    expect(inspectAtOffset(plan, -5, "UTC").offsetMs).toBe(0);
    expect(inspectAtOffset(plan, 10 ** 12, "UTC").remainingMs).toBe(0);
  });
});

describe("daylight (FR-023)", () => {
  it("is daytime at Singapore around local noon and night at local midnight", () => {
    expect(solarElevationDeg(Date.UTC(2026, 9, 12, 5, 0), SIN)).toBeGreaterThan(60);
    expect(daylightAt(Date.UTC(2026, 9, 12, 17, 0), SIN).condition).toBe("night");
  });

  it("follows the aircraft's position at the current time", () => {
    const t = Date.UTC(2026, 9, 12, 5, 0);
    expect(daylightAt(t, KUL).condition).toBe("day");
    expect(daylightAt(t, LHR).condition).toBe("night");
  });
});
