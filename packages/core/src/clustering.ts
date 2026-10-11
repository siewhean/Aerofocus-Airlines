import type { LatLon } from "./geo";

/** [west, south, east, north] in degrees. west > east means the box crosses the antimeridian. */
export type BBox = [number, number, number, number];

export function inBBox(p: LatLon, [west, south, east, north]: BBox): boolean {
  if (p.lat < south || p.lat > north) return false;
  return west <= east ? p.lon >= west && p.lon <= east : p.lon >= west || p.lon <= east;
}

export type ClusterResult<T> =
  | { type: "item"; position: LatLon; item: T }
  | { type: "cluster"; position: LatLon; count: number; /** Up to 5 example ids for "zoom to" interactions. */ sampleIds: string[] };

const MAX_MERCATOR_LAT = 85.05112878;

function toTile(p: LatLon): [number, number] {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, p.lat));
  const x = (p.lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return [x, y];
}

/**
 * Grid clustering in Web Mercator space so the community map stays responsive with many aircraft
 * (FR-062, AC-19). At zoom z there are 2^z × cellsPerTile cells across the world.
 */
export function clusterByGrid<T>(
  items: readonly T[],
  position: (item: T) => LatLon,
  id: (item: T) => string,
  options: { zoom: number; bbox?: BBox; cellsPerTile?: number; minClusterSize?: number },
): ClusterResult<T>[] {
  const n = 2 ** Math.max(0, Math.min(22, Math.floor(options.zoom))) * (options.cellsPerTile ?? 4);
  const minSize = options.minClusterSize ?? 2;
  const cells = new Map<string, T[]>();
  for (const item of items) {
    const p = position(item);
    if (options.bbox && !inBBox(p, options.bbox)) continue;
    const [x, y] = toTile(p);
    const key = `${Math.min(n - 1, Math.floor(x * n))}:${Math.min(n - 1, Math.floor(y * n))}`;
    const cell = cells.get(key);
    if (cell) cell.push(item);
    else cells.set(key, [item]);
  }
  const results: ClusterResult<T>[] = [];
  for (const members of cells.values()) {
    if (members.length < minSize) {
      for (const item of members) results.push({ type: "item", position: position(item), item });
      continue;
    }
    // Centroid on the unit sphere avoids errors near the antimeridian.
    let x = 0, y = 0, z = 0;
    for (const m of members) {
      const p = position(m);
      const lat = (p.lat * Math.PI) / 180;
      const lon = (p.lon * Math.PI) / 180;
      x += Math.cos(lat) * Math.cos(lon);
      y += Math.cos(lat) * Math.sin(lon);
      z += Math.sin(lat);
    }
    const centroid: LatLon = {
      lat: (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI,
      lon: (Math.atan2(y, x) * 180) / Math.PI,
    };
    results.push({ type: "cluster", position: centroid, count: members.length, sampleIds: members.slice(0, 5).map(id) });
  }
  return results;
}
