import type { LatLon } from "./geo";
import { DAY, daysBetweenDates, type Instant } from "./time";

export type CabinClass = "economy" | "premium_economy" | "business" | "first" | "private";

/** Cabin classes that can appear on scheduled airline services, in ascending order. */
export const SCHEDULED_CABIN_CLASSES = ["economy", "premium_economy", "business", "first"] as const;

export type Region =
  | "asia"
  | "oceania"
  | "middle_east"
  | "europe"
  | "africa"
  | "north_america"
  | "south_america";

export interface Airport extends LatLon {
  iata: string;
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  region: Region;
  /** IANA time zone */
  timeZone: string;
}

export type DataSourceStatus = "verified" | "sample";

export interface Airline {
  iata: string;
  name: string;
  type: "budget" | "full_service";
  /** Skytrax World Airline Awards position (1 = best). null = not ranked. */
  skytraxRank: number | null;
  rankSource: DataSourceStatus;
}

export type AircraftFamily = "narrowbody" | "widebody_twin" | "widebody_quad";

export interface AircraftType {
  code: string;
  name: string;
  family: AircraftFamily;
}

/**
 * Immutable copy of one operating date of a published flight service (FR-007).
 * A booking binds to exactly one snapshot, so a booked flight survives provider outages (NFR-010).
 */
export interface ScheduleSnapshot {
  id: string;
  provider: string;
  dataVersion: string;
  retrievedAt: Instant;
  sourceStatus: DataSourceStatus;
  operatingAirline: string;
  /** Present only for codeshares. */
  marketingAirline: string | null;
  flightNumber: string;
  origin: string;
  destination: string;
  /** Operating date, local to the origin airport. */
  operatingDate: string;
  /** Published departure instant. */
  departure: Instant;
  /** Published arrival instant. */
  arrival: Instant;
  /** null when the aircraft assignment is unknown; it must be labelled, never invented. */
  aircraftType: string | null;
  /** null when the source does not confirm cabin classes; only Economy is then offered (FR-029). */
  cabinClasses: CabinClass[] | null;
}

/** Published arrival instant − published departure instant (FR-003). */
export function blockDurationMs(snapshot: Pick<ScheduleSnapshot, "departure" | "arrival">): number {
  const block = snapshot.arrival - snapshot.departure;
  if (!(block > 0)) throw new RangeError("Schedule arrival must be after departure");
  return block;
}

export function serviceKey(s: Pick<ScheduleSnapshot, "operatingAirline" | "flightNumber">): string {
  return `${s.operatingAirline}${s.flightNumber}`;
}

/** Cabin classes a service may be sold in. Unverified services offer Economy only (FR-029). */
export function offeredCabins(snapshot: ScheduleSnapshot): CabinClass[] {
  return snapshot.cabinClasses && snapshot.cabinClasses.length > 0 ? snapshot.cabinClasses : ["economy"];
}

/**
 * Picks the occurrence of a service whose operating date matches the requested date, or failing
 * that, the nearest operating date (FR-003). Ties prefer the earlier date.
 */
export function resolveOperatingSnapshot(
  occurrences: readonly ScheduleSnapshot[],
  date: string,
  maxDistanceDays = 7,
): ScheduleSnapshot | null {
  let best: ScheduleSnapshot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const occ of occurrences) {
    const distance = Math.abs(daysBetweenDates(date, occ.operatingDate));
    if (distance > maxDistanceDays) continue;
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && occ.operatingDate < best.operatingDate)
    ) {
      best = occ;
      bestDistance = distance;
    }
  }
  return best;
}

export interface DurationBucket {
  id: string;
  minMs: number;
  maxMs: number;
}

/** Supported duration ranges used for starter-airline coverage (FR-067). */
export const DURATION_BUCKETS: readonly DurationBucket[] = [
  { id: "under_1h", minMs: 0, maxMs: DAY / 24 },
  { id: "1h_to_2h", minMs: DAY / 24, maxMs: DAY / 12 },
  { id: "2h_to_4h", minMs: DAY / 12, maxMs: DAY / 6 },
  { id: "4h_to_8h", minMs: DAY / 6, maxMs: DAY / 3 },
  { id: "over_8h", minMs: DAY / 3, maxMs: Number.POSITIVE_INFINITY },
];

export function durationBucketFor(blockMs: number): DurationBucket {
  const bucket = DURATION_BUCKETS.find((b) => blockMs >= b.minMs && blockMs < b.maxMs);
  if (!bucket) throw new RangeError(`No duration bucket for ${blockMs}ms`);
  return bucket;
}
