export interface LatLon {
  lat: number;
  lon: number;
}

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Central angle between two points, in radians (haversine). */
function centralAngle(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function greatCircleDistanceKm(a: LatLon, b: LatLon): number {
  return EARTH_RADIUS_KM * centralAngle(a, b);
}

/** Point at fraction f (0..1) along the great circle from a to b. */
export function interpolateGreatCircle(a: LatLon, b: LatLon, f: number): LatLon {
  const delta = centralAngle(a, b);
  if (delta < 1e-12) return { lat: a.lat, lon: a.lon };
  const t = Math.min(1, Math.max(0, f));
  const sinDelta = Math.sin(delta);
  const wa = Math.sin((1 - t) * delta) / sinDelta;
  const wb = Math.sin(t * delta) / sinDelta;
  const [la, lo1, lb, lo2] = [toRad(a.lat), toRad(a.lon), toRad(b.lat), toRad(b.lon)];
  const x = wa * Math.cos(la) * Math.cos(lo1) + wb * Math.cos(lb) * Math.cos(lo2);
  const y = wa * Math.cos(la) * Math.sin(lo1) + wb * Math.cos(lb) * Math.sin(lo2);
  const z = wa * Math.sin(la) + wb * Math.sin(lb);
  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lon: normalizeLon(toDeg(Math.atan2(y, x))),
  };
}

/** Initial bearing from a to b in degrees (0 = north, clockwise). */
export function initialBearingDeg(a: LatLon, b: LatLon): number {
  const [la, lb] = [toRad(a.lat), toRad(b.lat)];
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
