import {
  assignAirlineTiers,
  cabinAvailabilityWarnings,
  ensureStarterCoverage,
  HOUR,
  type ScheduleSnapshot,
} from "@aerofocus/core";
import { AIRLINES } from "./airlines";
import { AIRPORTS_BY_IATA } from "./airports";

export * from "./airports";
export * from "./airlines";
export * from "./sample-schedule";
export * from "./provider";
export * from "./travel-marks";

export interface AirlineTierTable {
  tiers: ReadonlyMap<string, number>;
  promotedToStarter: string[];
  uncovered: { region: string; bucket: string }[];
  warnings: string[];
}

/**
 * Builds the airline unlock tiers from Skytrax order, then applies starter coverage (FR-067) and
 * cabin availability checks (FR-065) against a representative week of the catalogue.
 */
export function buildAirlineTierTable(catalogueWeek: readonly ScheduleSnapshot[]): AirlineTierTable {
  const base = assignAirlineTiers(AIRLINES);
  const coverage = ensureStarterCoverage(base, AIRLINES, catalogueWeek, AIRPORTS_BY_IATA);
  return {
    tiers: coverage.tiers,
    promotedToStarter: coverage.promoted,
    uncovered: coverage.uncovered,
    warnings: cabinAvailabilityWarnings(coverage.tiers, catalogueWeek),
  };
}

export const ONE_WEEK_MS = 7 * 24 * HOUR;
