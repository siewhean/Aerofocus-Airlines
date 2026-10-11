import type { LatLon } from "./geo";
import {
  altitudeFtAt,
  buildPhasePlan,
  cruiseAltitudeFtFor,
  distanceFractionAt,
  offsetAtDistanceFraction,
  phaseAt,
  type FlightPhase,
  type PhaseOverrides,
  type PhaseSegment,
} from "./phases";
import { buildGreatCircleRoute, nearestDistanceFraction, pointAtDistanceFraction, type RouteModel } from "./route";
import type { Airport } from "./schedule";
import { daylightAt, type Daylight } from "./solar";
import { toZonedIsoString, type Instant } from "./time";

/** Everything needed to compute a flight's state deterministically at any instant. */
export interface FlightPlan {
  origin: Airport;
  destination: Airport;
  /** Actual block start (pushback) for this flight. */
  departure: Instant;
  blockMs: number;
  phases: PhaseSegment[];
  route: RouteModel;
  cruiseAltitudeFt: number;
}

export interface CreateFlightPlanInput {
  origin: Airport;
  destination: Airport;
  departure: Instant;
  blockMs: number;
  phaseOverrides?: PhaseOverrides;
  route?: RouteModel;
}

export function createFlightPlan(input: CreateFlightPlanInput): FlightPlan {
  return {
    origin: input.origin,
    destination: input.destination,
    departure: input.departure,
    blockMs: input.blockMs,
    phases: buildPhasePlan(input.blockMs, input.phaseOverrides),
    route: input.route ?? buildGreatCircleRoute(input.origin, input.destination),
    cruiseAltitudeFt: cruiseAltitudeFtFor(input.blockMs),
  };
}

export function arrivalOf(plan: FlightPlan): Instant {
  return plan.departure + plan.blockMs;
}

export type FlightStatus = "scheduled" | "in_flight" | "arrived";

export interface FlightState {
  status: FlightStatus;
  /** null before pushback. After arrival the final phase (taxi_in) is reported. */
  phase: FlightPhase | null;
  elapsedMs: number;
  remainingMs: number;
  /** Elapsed share of block time, 0..1. */
  timeProgress: number;
  /** Share of route distance covered, 0..1. */
  distanceFraction: number;
  position: LatLon;
  altitudeFt: number;
  arrival: Instant;
  daylight: Daylight;
  /** Positions are always estimates, never live aircraft data (FR-018). */
  estimated: true;
}

/** Flight state at an instant. Pure: it only depends on the plan and the given time (NFR-001). */
export function flightStateAt(plan: FlightPlan, now: Instant): FlightState {
  const offset = now - plan.departure;
  const clamped = Math.min(plan.blockMs, Math.max(0, offset));
  const status: FlightStatus = offset < 0 ? "scheduled" : offset >= plan.blockMs ? "arrived" : "in_flight";
  const distanceFraction = distanceFractionAt(plan.phases, clamped);
  const position = pointAtDistanceFraction(plan.route, distanceFraction);
  return {
    status,
    phase: status === "scheduled" ? null : phaseAt(plan.phases, clamped).phase,
    elapsedMs: clamped,
    remainingMs: plan.blockMs - clamped,
    timeProgress: clamped / plan.blockMs,
    distanceFraction,
    position,
    altitudeFt: status === "in_flight" ? altitudeFtAt(plan.phases, clamped, plan.cruiseAltitudeFt) : 0,
    arrival: arrivalOf(plan),
    daylight: daylightAt(now, position),
    estimated: true,
  };
}

export interface InspectionPoint {
  offsetMs: number;
  instant: Instant;
  /** Expected clock time at that point, in the user's own time zone (FR-012, FR-017). */
  localTime: string;
  elapsedMs: number;
  remainingMs: number;
  phase: FlightPhase;
  position: LatLon;
  distanceFraction: number;
  progressPercent: number;
  estimated: true;
}

/**
 * Route inspection by time offset from pushback. Never mutates or depends on the live flight
 * state, so inspecting does not move the aircraft or the countdown (FR-019).
 */
export function inspectAtOffset(plan: FlightPlan, offsetMs: number, userTimeZone: string): InspectionPoint {
  const offset = Math.min(plan.blockMs, Math.max(0, offsetMs));
  const distanceFraction = distanceFractionAt(plan.phases, offset);
  const instant = plan.departure + offset;
  return {
    offsetMs: offset,
    instant,
    localTime: toZonedIsoString(instant, userTimeZone),
    elapsedMs: offset,
    remainingMs: plan.blockMs - offset,
    phase: phaseAt(plan.phases, offset).phase,
    position: pointAtDistanceFraction(plan.route, distanceFraction),
    distanceFraction,
    progressPercent: Math.round((offset / plan.blockMs) * 1000) / 10,
    estimated: true,
  };
}

/** Route inspection by distance along the path (slider or keyboard control, FR-017). */
export function inspectAtDistanceFraction(plan: FlightPlan, fraction: number, userTimeZone: string): InspectionPoint {
  return inspectAtOffset(plan, offsetAtDistanceFraction(plan.phases, fraction), userTimeZone);
}

/** Route inspection at the path point nearest a tapped or clicked location (FR-017). */
export function inspectNearestPoint(plan: FlightPlan, point: LatLon, userTimeZone: string): InspectionPoint {
  return inspectAtDistanceFraction(plan, nearestDistanceFraction(plan.route, point), userTimeZone);
}
