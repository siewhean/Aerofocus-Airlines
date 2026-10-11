import { initialBearingDeg, type LatLon } from "./geo";
import { pointAtDistanceFraction } from "./route";
import type { SeatAssignment } from "./seats";
import type { FlightPlan } from "./simulation";
import { flightStateAt } from "./simulation";
import { daylightConditionFor, sunPosition, type DaylightCondition } from "./solar";
import type { Instant } from "./time";

export type WindowSide = "left" | "right";
/** Where the sun is relative to the aircraft's nose. */
export type SunSide = "ahead" | "behind" | "left" | "right" | "below_horizon";

export interface WindowLighting {
  condition: DaylightCondition;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  /** Aircraft track over the ground, degrees from north. */
  headingDeg: number;
  /** Sun bearing relative to the nose, -180..180 (positive = right). */
  sunRelativeBearingDeg: number;
  sunSide: SunSide;
  /** True when direct sunlight comes through the passenger's own window. */
  sunOnWindowSide: boolean;
  /**
   * Suggested exterior brightness 0..1 for rendering. Purely presentational; personal cabin
   * lighting preferences stay separate (FR-024).
   */
  exteriorBrightness: number;
}

/** Window seats on the left are lettered A; anything else on the window is treated as right. */
export function windowSideOf(seat: Pick<SeatAssignment, "letter" | "isWindow">): WindowSide | null {
  if (!seat.isWindow) return null;
  return seat.letter === "A" ? "left" : "right";
}

/** Ground track at the aircraft's current position, from the route geometry. */
export function headingAt(plan: FlightPlan, distanceFraction: number): number {
  const delta = 0.002;
  const a = pointAtDistanceFraction(plan.route, Math.max(0, Math.min(1 - delta, distanceFraction)));
  const b = pointAtDistanceFraction(plan.route, Math.min(1, Math.max(delta, distanceFraction + delta)));
  return initialBearingDeg(a, b);
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Lighting through the passenger's window: the sun at the aircraft's simulated position at the
 * current real time, relative to the aircraft's heading and the passenger's window side (FR-023).
 */
export function windowLightingAt(plan: FlightPlan, now: Instant, side: WindowSide | null): WindowLighting {
  const state = flightStateAt(plan, now);
  const sun = sunPosition(now, state.position);
  // On the ground (taxi phases) the aircraft points roughly along the departure track.
  const headingDeg = headingAt(plan, state.distanceFraction);
  const relative = ((sun.azimuthDeg - headingDeg + 540) % 360) - 180;
  const below = sun.elevationDeg < 0;
  const sunSide: SunSide = below
    ? "below_horizon"
    : Math.abs(relative) <= 30
      ? "ahead"
      : Math.abs(relative) >= 150
        ? "behind"
        : relative > 0
          ? "right"
          : "left";
  // Smooth ramp from deep twilight (-12°) to full day (+10°).
  const exteriorBrightness = clamp01((sun.elevationDeg + 12) / 22);
  return {
    condition: daylightConditionFor(sun.elevationDeg),
    sunElevationDeg: sun.elevationDeg,
    sunAzimuthDeg: sun.azimuthDeg,
    headingDeg,
    sunRelativeBearingDeg: relative,
    sunSide,
    sunOnWindowSide: side !== null && sunSide === side,
    exteriorBrightness,
  };
}

export interface DaylightEvent {
  type: "sunrise" | "sunset";
  instant: Instant;
  position: LatLon;
}

/**
 * Sunrises and sunsets the aircraft will pass through during the flight, found by sampling the sun
 * along the route (e.g. for overnight flights, FR-023). Accuracy is about the sample step.
 */
export function daylightEventsDuringFlight(plan: FlightPlan, stepMs = 5 * 60_000): DaylightEvent[] {
  const events: DaylightEvent[] = [];
  let prevAbove: boolean | null = null;
  for (let offset = 0; offset <= plan.blockMs; offset += stepMs) {
    const t = plan.departure + Math.min(offset, plan.blockMs);
    const position = flightStateAt(plan, t).position;
    const above = sunPosition(t, position).elevationDeg >= 0;
    if (prevAbove !== null && above !== prevAbove) events.push({ type: above ? "sunrise" : "sunset", instant: t, position });
    prevAbove = above;
  }
  return events;
}

