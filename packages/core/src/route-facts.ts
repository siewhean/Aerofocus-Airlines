import { daylightEventsDuringFlight } from "./lighting";
import { flightStateAt, type FlightPlan } from "./simulation";
import { sunPosition } from "./solar";
import { HOUR, MINUTE } from "./time";

/** Facts about a flown route, used for achievements and history. All are simulated, not real travel. */
export interface RouteFacts {
  crossedEquator: boolean;
  /** Crossed the 180° meridian (where the International Date Line roughly runs). */
  crossedAntimeridian: boolean;
  /** The aircraft flew through at least one sunrise. */
  sawSunrise: boolean;
  /** At least 3 hours of the flight were in darkness (sun more than 6° below the horizon). */
  nightFlight: boolean;
}

export function routeFacts(plan: FlightPlan, stepMs = 10 * MINUTE): RouteFacts {
  const points = plan.route.points;
  let crossedEquator = false;
  let crossedAntimeridian = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (Math.sign(a.lat) !== Math.sign(b.lat) && a.lat !== 0) crossedEquator = true;
    if (Math.abs(b.lon - a.lon) > 180) crossedAntimeridian = true;
  }
  let darkMs = 0;
  for (let offset = 0; offset < plan.blockMs; offset += stepMs) {
    const t = plan.departure + offset;
    if (sunPosition(t, flightStateAt(plan, t).position).elevationDeg < -6) darkMs += Math.min(stepMs, plan.blockMs - offset);
  }
  return {
    crossedEquator,
    crossedAntimeridian,
    sawSunrise: daylightEventsDuringFlight(plan, stepMs).some((e) => e.type === "sunrise"),
    nightFlight: darkMs >= 3 * HOUR,
  };
}
