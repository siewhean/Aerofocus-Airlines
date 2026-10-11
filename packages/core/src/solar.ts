import type { LatLon } from "./geo";
import { DAY, MINUTE, type Instant } from "./time";

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/**
 * Solar elevation angle in degrees at a position and instant (NOAA solar calculator equations,
 * without atmospheric refraction). Used for exterior daylight (FR-023).
 */
export function solarElevationDeg(instant: Instant, position: LatLon): number {
  const julianDay = instant / DAY + 2440587.5;
  const jc = (julianDay - 2451545) / 36525;

  const meanLong = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccent = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const eqCenter =
    Math.sin(rad(meanAnom)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * jc) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;
  const trueLong = meanLong + eqCenter;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliqCorr)) * Math.sin(rad(appLong))));

  const y = Math.tan(rad(obliqCorr / 2)) ** 2;
  const eqTimeMinutes =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * eccent * Math.sin(rad(meanAnom)) +
        4 * eccent * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom)),
    );

  const minutesUtc = (((instant % DAY) + DAY) % DAY) / MINUTE;
  const trueSolarTime = (((minutesUtc + eqTimeMinutes + 4 * position.lon) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const cosZenith =
    Math.sin(rad(position.lat)) * Math.sin(rad(declination)) +
    Math.cos(rad(position.lat)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle));
  const zenith = deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
  return 90 - zenith;
}

export type DaylightCondition = "night" | "twilight" | "golden_hour" | "day";

export interface Daylight {
  elevationDeg: number;
  condition: DaylightCondition;
}

/** Sky condition at the aircraft's simulated position at the current real time (FR-023). */
export function daylightAt(instant: Instant, position: LatLon): Daylight {
  const elevationDeg = solarElevationDeg(instant, position);
  const condition: DaylightCondition =
    elevationDeg < -6 ? "night" : elevationDeg < 0 ? "twilight" : elevationDeg < 6 ? "golden_hour" : "day";
  return { elevationDeg, condition };
}
