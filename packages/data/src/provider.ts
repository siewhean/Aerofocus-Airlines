import {
  addDaysToDate,
  isoWeekday,
  localDate,
  MINUTE,
  zonedToInstant,
  type Airport,
  type Instant,
  type ScheduleSnapshot,
} from "@aerofocus/core";
import { AIRPORTS_BY_IATA } from "./airports";
import { SAMPLE_PATTERNS, type WeeklyPattern } from "./sample-schedule";

export interface ScheduleQuery {
  /** Departures at or after this instant. */
  from: Instant;
  /** Departures before this instant. */
  to: Instant;
  origin?: string;
  destination?: string;
  airline?: string;
}

/**
 * Source of published schedules (FR-007). Implement this for a licensed provider; the rest of the
 * system only depends on this interface and on the snapshots it returns.
 */
export interface ScheduleProvider {
  readonly name: string;
  readonly dataVersion: string;
  listDepartures(query: ScheduleQuery): Promise<ScheduleSnapshot[]>;
  getSnapshot(id: string): Promise<ScheduleSnapshot | null>;
  /** All occurrences of one service between two operating dates (inclusive). */
  serviceOccurrences(airline: string, flightNumber: string, fromDate: string, toDate: string): Promise<ScheduleSnapshot[]>;
}

const SNAPSHOT_ID_RE = /^sample:([A-Z0-9]{2})(\d{1,4}):(\d{4}-\d{2}-\d{2}):(.+)$/;

/** Generates sample snapshots from weekly patterns. Every snapshot is marked sourceStatus "sample". */
export class SampleScheduleProvider implements ScheduleProvider {
  readonly name = "sample";
  readonly dataVersion: string;
  private readonly patterns: readonly WeeklyPattern[];
  private readonly airports: ReadonlyMap<string, Airport>;
  private readonly retrievedAt: Instant;

  constructor(options: { patterns?: readonly WeeklyPattern[]; dataVersion?: string; retrievedAt?: Instant } = {}) {
    this.patterns = options.patterns ?? SAMPLE_PATTERNS;
    this.dataVersion = options.dataVersion ?? "sample-2026.10";
    this.airports = AIRPORTS_BY_IATA;
    this.retrievedAt = options.retrievedAt ?? 0;
  }

  private occurrence(p: WeeklyPattern, operatingDate: string): ScheduleSnapshot | null {
    if (!p.days.includes(isoWeekday(operatingDate))) return null;
    const origin = this.airports.get(p.origin);
    if (!origin) throw new Error(`Unknown airport ${p.origin}`);
    const departure = zonedToInstant(operatingDate, p.departureLocal, origin.timeZone);
    return {
      id: `sample:${p.airline}${p.flightNumber}:${operatingDate}:${this.dataVersion}`,
      provider: this.name,
      dataVersion: this.dataVersion,
      retrievedAt: this.retrievedAt,
      sourceStatus: "sample",
      operatingAirline: p.airline,
      marketingAirline: null,
      flightNumber: p.flightNumber,
      origin: p.origin,
      destination: p.destination,
      operatingDate,
      departure,
      arrival: departure + p.blockMinutes * MINUTE,
      aircraftType: p.aircraft,
      cabinClasses: p.cabins ? [...p.cabins] : null,
    };
  }

  async listDepartures(query: ScheduleQuery): Promise<ScheduleSnapshot[]> {
    const results: ScheduleSnapshot[] = [];
    for (const p of this.patterns) {
      if (query.origin && p.origin !== query.origin) continue;
      if (query.destination && p.destination !== query.destination) continue;
      if (query.airline && p.airline !== query.airline) continue;
      const origin = this.airports.get(p.origin);
      if (!origin) continue;
      // Operating dates are local to the origin; pad by a day each side to cover the range.
      let date = addDaysToDate(localDate(query.from, origin.timeZone), -1);
      const lastDate = addDaysToDate(localDate(query.to, origin.timeZone), 1);
      while (date <= lastDate) {
        const occ = this.occurrence(p, date);
        if (occ && occ.departure >= query.from && occ.departure < query.to) results.push(occ);
        date = addDaysToDate(date, 1);
      }
    }
    return results.sort((a, b) => a.departure - b.departure);
  }

  async getSnapshot(id: string): Promise<ScheduleSnapshot | null> {
    const m = SNAPSHOT_ID_RE.exec(id);
    if (!m || m[4] !== this.dataVersion) return null;
    const pattern = this.patterns.find((p) => p.airline === m[1] && p.flightNumber === m[2]);
    return pattern ? this.occurrence(pattern, m[3] as string) : null;
  }

  async serviceOccurrences(airline: string, flightNumber: string, fromDate: string, toDate: string): Promise<ScheduleSnapshot[]> {
    const pattern = this.patterns.find((p) => p.airline === airline && p.flightNumber === flightNumber);
    if (!pattern) return [];
    const out: ScheduleSnapshot[] = [];
    for (let date = fromDate; date <= toDate; date = addDaysToDate(date, 1)) {
      const occ = this.occurrence(pattern, date);
      if (occ) out.push(occ);
    }
    return out;
  }
}
