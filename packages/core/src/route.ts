import { greatCircleDistanceKm, interpolateGreatCircle, type LatLon } from "./geo";
import type { Airport } from "./schedule";

/**
 * Expected trajectory of a flight. Phase 1 uses great-circle estimates; licensed planned routes
 * can replace them later without changing consumers (FR-018). Positions are always simulated.
 */
export interface RouteModel {
  kind: "great_circle" | "planned";
  estimated: true;
  points: LatLon[];
  /** Cumulative distance in km at each point. */
  cumulativeKm: number[];
  distanceKm: number;
}

export function buildRouteFromPoints(points: LatLon[], kind: RouteModel["kind"]): RouteModel {
  if (points.length < 2) throw new RangeError("A route needs at least two points");
  const cumulativeKm = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as LatLon;
    const curr = points[i] as LatLon;
    cumulativeKm.push((cumulativeKm[i - 1] ?? 0) + greatCircleDistanceKm(prev, curr));
  }
  return { kind, estimated: true, points, cumulativeKm, distanceKm: cumulativeKm[cumulativeKm.length - 1] ?? 0 };
}

export function buildGreatCircleRoute(origin: LatLon, destination: LatLon, samples = 64): RouteModel {
  const points: LatLon[] = [];
  for (let i = 0; i <= samples; i++) points.push(interpolateGreatCircle(origin, destination, i / samples));
  return buildRouteFromPoints(points, "great_circle");
}

/** Point at a fraction (0..1) of route distance. */
export function pointAtDistanceFraction(route: RouteModel, fraction: number): LatLon {
  const f = Math.min(1, Math.max(0, fraction));
  const target = f * route.distanceKm;
  for (let i = 1; i < route.points.length; i++) {
    const startKm = route.cumulativeKm[i - 1] ?? 0;
    const endKm = route.cumulativeKm[i] ?? 0;
    if (target <= endKm) {
      const span = endKm - startKm;
      const local = span > 0 ? (target - startKm) / span : 0;
      return interpolateGreatCircle(route.points[i - 1] as LatLon, route.points[i] as LatLon, local);
    }
  }
  return route.points[route.points.length - 1] as LatLon;
}

/** Distance fraction of the route point nearest to a tapped/clicked location (FR-017). */
export function nearestDistanceFraction(route: RouteModel, point: LatLon, refineSteps = 20): number {
  let bestIndex = 0;
  let bestKm = Number.POSITIVE_INFINITY;
  route.points.forEach((p, i) => {
    const d = greatCircleDistanceKm(p, point);
    if (d < bestKm) {
      bestKm = d;
      bestIndex = i;
    }
  });
  if (route.distanceKm <= 0) return 0;
  // Refine between neighbouring samples.
  const lo = route.cumulativeKm[Math.max(0, bestIndex - 1)] ?? 0;
  const hi = route.cumulativeKm[Math.min(route.points.length - 1, bestIndex + 1)] ?? route.distanceKm;
  let bestFraction = (route.cumulativeKm[bestIndex] ?? 0) / route.distanceKm;
  for (let s = 0; s <= refineSteps; s++) {
    const fraction = (lo + ((hi - lo) * s) / refineSteps) / route.distanceKm;
    const d = greatCircleDistanceKm(pointAtDistanceFraction(route, fraction), point);
    if (d < bestKm) {
      bestKm = d;
      bestFraction = fraction;
    }
  }
  return bestFraction;
}

/**
 * Human label for a location. Only names a place when an airport is genuinely close; otherwise
 * returns null so the interface shows coordinates or a broad region instead (FR-021).
 */
export function describeLocation(point: LatLon, airports: readonly Airport[], radiusKm = 60): string | null {
  let nearest: Airport | null = null;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (const airport of airports) {
    const d = greatCircleDistanceKm(point, airport);
    if (d < nearestKm) {
      nearestKm = d;
      nearest = airport;
    }
  }
  return nearest && nearestKm <= radiusKm ? `Near ${nearest.city}` : null;
}
