import type { LatLon } from "./geo";
import { headingAt } from "./lighting";
import { distanceFractionAt, type FlightPhase } from "./phases";
import { pointAtDistanceFraction, type RouteModel } from "./route";
import { flightStateAt, type FlightPlan } from "./simulation";
import type { Instant } from "./time";

/** Minimal GeoJSON types (RFC 7946); positions are [lon, lat]. */
export type Position = [number, number];
export interface PointGeometry {
  type: "Point";
  coordinates: Position;
}
export interface MultiLineStringGeometry {
  type: "MultiLineString";
  coordinates: Position[][];
}
export interface Feature<G = PointGeometry | MultiLineStringGeometry, P = Record<string, unknown>> {
  type: "Feature";
  geometry: G;
  properties: P;
}
export interface FeatureCollection<F = Feature> {
  type: "FeatureCollection";
  features: F[];
}

const toPosition = (p: LatLon): Position => [p.lon, p.lat];

/**
 * Splits a line where it crosses the antimeridian, so map libraries do not draw it across the
 * whole world. The crossing latitude is interpolated.
 */
export function splitAtAntimeridian(points: readonly LatLon[]): Position[][] {
  const parts: Position[][] = [];
  let current: Position[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as LatLon;
    const prev = points[i - 1];
    if (prev && Math.abs(p.lon - prev.lon) > 180) {
      const sign = prev.lon > 0 ? 1 : -1;
      const unwrappedLon = p.lon + sign * 360;
      const t = (sign * 180 - prev.lon) / (unwrappedLon - prev.lon);
      const lat = prev.lat + (p.lat - prev.lat) * t;
      current.push([sign * 180, lat]);
      parts.push(current);
      current = [[-sign * 180, lat]];
    }
    current.push(toPosition(p));
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

/** Route points between two distance fractions, with interpolated end points. */
export function routeSlice(route: RouteModel, from: number, to: number): LatLon[] {
  const f0 = Math.max(0, Math.min(1, from));
  const f1 = Math.max(f0, Math.min(1, to));
  const points: LatLon[] = [pointAtDistanceFraction(route, f0)];
  for (let i = 0; i < route.points.length; i++) {
    const f = route.distanceKm > 0 ? (route.cumulativeKm[i] ?? 0) / route.distanceKm : 0;
    if (f > f0 && f < f1) points.push(route.points[i] as LatLon);
  }
  points.push(pointAtDistanceFraction(route, f1));
  return points;
}

export type RouteFeatureKind = "completed" | "remaining" | "phase" | "origin" | "destination" | "aircraft";

export interface RouteFeatureProperties {
  kind: RouteFeatureKind;
  phase?: FlightPhase;
  iata?: string;
  headingDeg?: number;
  /** Positions are always simulated estimates (FR-018). */
  estimated: true;
}

/**
 * GeoJSON for drawing a flight (FR-016): completed and remaining route, per-phase segments for
 * advanced rendering, airports and the aircraft with its heading. Pass `now` to split
 * completed/remaining; omit it for a preview.
 */
export function routeGeometry(plan: FlightPlan, now?: Instant): FeatureCollection<Feature<PointGeometry | MultiLineStringGeometry, RouteFeatureProperties>> {
  const features: Feature<PointGeometry | MultiLineStringGeometry, RouteFeatureProperties>[] = [];
  const line = (kind: RouteFeatureKind, pts: LatLon[], extra: Partial<RouteFeatureProperties> = {}) => {
    if (pts.length < 2) return;
    features.push({
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: splitAtAntimeridian(pts) },
      properties: { kind, estimated: true, ...extra },
    });
  };
  const point = (kind: RouteFeatureKind, p: LatLon, extra: Partial<RouteFeatureProperties> = {}) => {
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: toPosition(p) }, properties: { kind, estimated: true, ...extra } });
  };

  const fraction = now === undefined ? 0 : flightStateAt(plan, now).distanceFraction;
  line("completed", routeSlice(plan.route, 0, fraction));
  line("remaining", routeSlice(plan.route, fraction, 1));
  for (const segment of plan.phases) {
    const a = distanceFractionAt(plan.phases, segment.startMs);
    const b = distanceFractionAt(plan.phases, segment.endMs);
    if (b - a > 1e-6) line("phase", routeSlice(plan.route, a, b), { phase: segment.phase });
  }
  point("origin", plan.origin, { iata: plan.origin.iata });
  point("destination", plan.destination, { iata: plan.destination.iata });
  if (now !== undefined) {
    const state = flightStateAt(plan, now);
    point("aircraft", state.position, { headingDeg: headingAt(plan, state.distanceFraction), ...(state.phase ? { phase: state.phase } : {}) });
  }
  return { type: "FeatureCollection", features };
}
