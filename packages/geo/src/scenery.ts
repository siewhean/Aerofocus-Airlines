import {
  daylightAt,
  greatCircleDistanceKm,
  interpolateGreatCircle,
  type Airport,
  type Daylight,
  type FlightPhase,
  type Instant,
  type LatLon,
} from "@aerofocus/core";
import { countryAt } from "./world";

export type Surface = "ocean" | "land" | "coast";

/** Destination point given a start, bearing (degrees) and distance (km). */
function offsetPoint(p: LatLon, bearingDeg: number, km: number): LatLon {
  const R = 6371.0088;
  const d = km / R;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (p.lat * Math.PI) / 180;
  const lon1 = (p.lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI + 540) % 360) - 180) };
}

/**
 * Land, ocean or coast under a point. "coast" means land and water are both within `radiusKm`
 * (roughly what a passenger can see from cruise altitude).
 */
export function surfaceAt(p: LatLon, radiusKm = 40): { surface: Surface; country: string | null } {
  const here = countryAt(p);
  const land = here !== null;
  for (let bearing = 0; bearing < 360; bearing += 45) {
    if ((countryAt(offsetPoint(p, bearing, radiusKm)) !== null) !== land) return { surface: "coast", country: here?.name ?? null };
  }
  return { surface: land ? "land" : "ocean", country: here?.name ?? null };
}

/**
 * Human-readable location label (FR-021): "Near Singapore", "Over Malaysia", "Off the coast of
 * India" or "Over the ocean". Never invents a more precise place than the data supports.
 */
export function describePosition(p: LatLon, airports: readonly Airport[], nearAirportKm = 50): string {
  for (const airport of airports) if (greatCircleDistanceKm(p, airport) <= nearAirportKm) return `Near ${airport.city}`;
  const { surface, country } = surfaceAt(p);
  if (country) return `Over ${country}`;
  if (surface === "coast") {
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const nearby = countryAt(offsetPoint(p, bearing, 40));
      if (nearby) return `Off the coast of ${nearby.name}`;
    }
  }
  return "Over the ocean";
}

export type CloudLayer = "clear" | "scattered" | "broken" | "overcast";

/** Deterministic 0..1 hash for a lattice cell. */
function hash(a: number, b: number, c: number, seed: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Simulated cloud cover: smooth value noise over a 2° grid that drifts every 3 hours. It is
 * decorative and deterministic so every viewer of a flight sees the same sky. NOT real weather.
 */
export function cloudCoverAt(p: LatLon, instant: Instant, seed = 0): { coverage: number; layer: CloudLayer } {
  const cell = 2;
  const slot = Math.floor(instant / (3 * 3_600_000));
  const x = (p.lon + 180) / cell;
  const y = (p.lat + 90) / cell;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = smooth(x - x0), ty = smooth(y - y0);
  const v = (dx: number, dy: number): number => hash(x0 + dx, y0 + dy, slot, seed);
  const top = v(0, 0) * (1 - tx) + v(1, 0) * tx;
  const bottom = v(0, 1) * (1 - tx) + v(1, 1) * tx;
  const coverage = Math.round((top * (1 - ty) + bottom * ty) * 100) / 100;
  const layer: CloudLayer = coverage < 0.25 ? "clear" : coverage < 0.5 ? "scattered" : coverage < 0.8 ? "broken" : "overcast";
  return { coverage, layer };
}

export type AltitudeBand = "ground" | "low" | "cruise";

export interface Scenery {
  surface: Surface;
  country: string | null;
  placeLabel: string;
  nearAirport: string | null;
  altitudeBand: AltitudeBand;
  daylight: Daylight;
  clouds: { coverage: number; layer: CloudLayer };
  /** Everything here is simulated; never present it as live footage or real weather (FR-022). */
  simulated: true;
}

/** What the window should show at a position (FR-022, FR-023). */
export function sceneryAt(input: {
  position: LatLon;
  instant: Instant;
  phase: FlightPhase | null;
  altitudeFt: number;
  airports: readonly Airport[];
  /** Per-flight seed so different flights get different skies. */
  seed?: number;
}): Scenery {
  const { position, instant, phase, altitudeFt, airports } = input;
  let nearAirport: string | null = null;
  for (const airport of airports) {
    if (greatCircleDistanceKm(position, airport) <= 50) {
      nearAirport = airport.iata;
      break;
    }
  }
  const { surface, country } = surfaceAt(position);
  const onGround = phase === null || phase === "taxi_out" || phase === "taxi_in" || altitudeFt <= 0;
  return {
    surface,
    country,
    placeLabel: describePosition(position, airports),
    nearAirport,
    altitudeBand: onGround ? "ground" : altitudeFt < 10_000 ? "low" : "cruise",
    daylight: daylightAt(instant, position),
    clouds: cloudCoverAt(position, instant, input.seed ?? 0),
    simulated: true,
  };
}

/** Samples scenery along a great-circle segment, e.g. to preload window assets for a route. */
export function sceneryAlong(a: LatLon, b: LatLon, samples: number): { position: LatLon; surface: Surface; country: string | null }[] {
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const position = interpolateGreatCircle(a, b, i / samples);
    out.push({ position, ...surfaceAt(position) });
  }
  return out;
}
