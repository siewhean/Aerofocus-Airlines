import type { LatLon } from "@aerofocus/core";
import { geoBounds, geoContains } from "d3-geo";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countriesTopology from "world-atlas/countries-50m.json";

/**
 * Country outlines from Natural Earth 1:50m (public domain) via world-atlas. Coastlines at this
 * scale are accurate to a few kilometres, which is plenty for simulated window scenery.
 */
interface CountryShape {
  name: string;
  /** ISO 3166-1 numeric code. */
  id: string;
  feature: Feature<Polygon | MultiPolygon>;
  /** [[west, south], [east, north]]; west > east when the shape crosses the antimeridian. */
  bounds: [[number, number], [number, number]];
}

let shapes: CountryShape[] | null = null;

function loadShapes(): CountryShape[] {
  if (shapes) return shapes;
  const topology = countriesTopology as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const collection = feature(topology, topology.objects.countries) as FeatureCollection<Polygon | MultiPolygon, { name: string }>;
  shapes = collection.features.map((f) => ({
    name: f.properties.name,
    id: String(f.id ?? ""),
    feature: f,
    bounds: geoBounds(f) as [[number, number], [number, number]],
  }));
  return shapes;
}

function boundsContain([[west, south], [east, north]]: CountryShape["bounds"], p: LatLon): boolean {
  if (p.lat < south - 0.01 || p.lat > north + 0.01) return false;
  return west <= east ? p.lon >= west - 0.01 && p.lon <= east + 0.01 : p.lon >= west || p.lon <= east;
}

export interface CountryHit {
  name: string;
  isoNumeric: string;
}

/** Country whose territory contains the point, or null over water. */
export function countryAt(p: LatLon): CountryHit | null {
  const point: [number, number] = [p.lon, p.lat];
  for (const shape of loadShapes()) {
    if (boundsContain(shape.bounds, p) && geoContains(shape.feature, point)) return { name: shape.name, isoNumeric: shape.id };
  }
  return null;
}

export function isLand(p: LatLon): boolean {
  return countryAt(p) !== null;
}
