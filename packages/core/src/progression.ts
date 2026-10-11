import type { UnlockState } from "./booking";
import {
  blockDurationMs,
  durationBucketFor,
  offeredCabins,
  type Airline,
  type Airport,
  type CabinClass,
  type Region,
  type ScheduleSnapshot,
} from "./schedule";
import { HOUR } from "./time";

export type LevelId = "traveller" | "explorer" | "frequent_flyer" | "silver" | "gold" | "platinum" | "global_voyager";

export interface LevelRequirement {
  focusHours?: number;
  flights?: number;
  countries?: number;
  specialAchievements?: number;
}

export interface LevelDef {
  id: LevelId;
  name: string;
  requirement: LevelRequirement;
  unlocksCabin: CabinClass | null;
  /** Airline tier unlocked at this level (0 = budget airlines). */
  airlineTier: number;
}

/** Progression levels (FR-065). Thresholds are provisional. */
export const LEVELS: readonly LevelDef[] = [
  { id: "traveller", name: "Traveller", requirement: {}, unlocksCabin: "economy", airlineTier: 0 },
  { id: "explorer", name: "Explorer", requirement: { focusHours: 5 }, unlocksCabin: "premium_economy", airlineTier: 1 },
  { id: "frequent_flyer", name: "Frequent Flyer", requirement: { focusHours: 15, flights: 5 }, unlocksCabin: null, airlineTier: 2 },
  { id: "silver", name: "Silver", requirement: { focusHours: 30, flights: 10 }, unlocksCabin: "business", airlineTier: 3 },
  { id: "gold", name: "Gold", requirement: { focusHours: 80, countries: 15 }, unlocksCabin: "first", airlineTier: 4 },
  { id: "platinum", name: "Platinum", requirement: { focusHours: 150, countries: 25 }, unlocksCabin: "private", airlineTier: 5 },
  {
    id: "global_voyager",
    name: "Global Voyager",
    requirement: { focusHours: 300, specialAchievements: 3 },
    unlocksCabin: null,
    airlineTier: 6,
  },
];

export const TOP_AIRLINE_TIER = 6;

export interface ProgressStats {
  creditedFocusMs: number;
  completedFlights: number;
  countries: number;
  specialAchievements: number;
}

function meets(stats: ProgressStats, req: LevelRequirement): boolean {
  return (
    stats.creditedFocusMs >= (req.focusHours ?? 0) * HOUR &&
    stats.completedFlights >= (req.flights ?? 0) &&
    stats.countries >= (req.countries ?? 0) &&
    stats.specialAchievements >= (req.specialAchievements ?? 0)
  );
}

/** Highest level reached. Levels are sequential: each requires the previous one. */
export function levelFor(stats: ProgressStats): LevelDef {
  let current = LEVELS[0] as LevelDef;
  for (const level of LEVELS) {
    if (!meets(stats, level.requirement)) break;
    current = level;
  }
  return current;
}

export interface NextLevelProgress {
  level: LevelDef;
  missing: Required<LevelRequirement>;
}

export function nextLevelProgress(stats: ProgressStats): NextLevelProgress | null {
  const index = LEVELS.indexOf(levelFor(stats));
  const next = LEVELS[index + 1];
  if (!next) return null;
  const r = next.requirement;
  return {
    level: next,
    missing: {
      focusHours: Math.max(0, (r.focusHours ?? 0) - stats.creditedFocusMs / HOUR),
      flights: Math.max(0, (r.flights ?? 0) - stats.completedFlights),
      countries: Math.max(0, (r.countries ?? 0) - stats.countries),
      specialAchievements: Math.max(0, (r.specialAchievements ?? 0) - stats.specialAchievements),
    },
  };
}

export function unlockStateFor(stats: ProgressStats): UnlockState {
  const level = levelFor(stats);
  const reached = LEVELS.slice(0, LEVELS.indexOf(level) + 1);
  return {
    airlineTier: level.airlineTier,
    cabinClasses: reached.map((l) => l.unlocksCabin).filter((c): c is CabinClass => c !== null),
  };
}

export interface AirlineTierOptions {
  /** How many of the highest-ranked airlines are held back for the top level. */
  topTierSize?: number;
}

/**
 * Assigns airlines to unlock tiers (FR-065): budget airlines are tier 0; full-service airlines are
 * spread over tiers 1–5 from lower-ranked to higher-ranked by Skytrax position; the highest-ranked
 * airlines form tier 6. Unranked full-service airlines are treated as lowest-ranked.
 */
export function assignAirlineTiers(airlines: readonly Airline[], options: AirlineTierOptions = {}): Map<string, number> {
  const tiers = new Map<string, number>();
  const fullService: Airline[] = [];
  for (const airline of airlines) {
    if (airline.type === "budget") tiers.set(airline.iata, 0);
    else fullService.push(airline);
  }
  // Best first; unranked last.
  fullService.sort((a, b) => (a.skytraxRank ?? Number.MAX_SAFE_INTEGER) - (b.skytraxRank ?? Number.MAX_SAFE_INTEGER));
  const topSize = Math.min(options.topTierSize ?? 10, Math.max(1, Math.round(fullService.length / 6)));
  const top = fullService.slice(0, topSize);
  const rest = fullService.slice(topSize).reverse(); // lowest-ranked first
  for (const airline of top) tiers.set(airline.iata, TOP_AIRLINE_TIER);
  const middleTiers = TOP_AIRLINE_TIER - 1;
  rest.forEach((airline, i) => {
    tiers.set(airline.iata, 1 + Math.min(middleTiers - 1, Math.floor((i * middleTiers) / rest.length)));
  });
  return tiers;
}

export interface CoverageResult {
  tiers: Map<string, number>;
  /** Full-service airlines moved into the starter group to fill coverage gaps. */
  promoted: string[];
  /** Region/duration combinations no airline in the catalogue can cover. */
  uncovered: { region: Region; bucket: string }[];
}

/**
 * Ensures the starter group offers every duration range from every region in the catalogue
 * (FR-067). Where budget airlines cannot, the lowest-ranked full-service airline that can is
 * promoted to the starter group.
 */
export function ensureStarterCoverage(
  tiers: ReadonlyMap<string, number>,
  airlines: readonly Airline[],
  catalogue: readonly ScheduleSnapshot[],
  airportsByIata: ReadonlyMap<string, Airport>,
): CoverageResult {
  const result = new Map(tiers);
  const promoted: string[] = [];
  const uncovered: CoverageResult["uncovered"] = [];
  const rankOf = new Map(airlines.map((a) => [a.iata, a.skytraxRank ?? Number.MAX_SAFE_INTEGER]));

  const cells = new Map<string, Set<string>>();
  for (const s of catalogue) {
    const region = airportsByIata.get(s.origin)?.region;
    if (!region) continue;
    const key = `${region}|${durationBucketFor(blockDurationMs(s)).id}`;
    const set = cells.get(key) ?? new Set<string>();
    set.add(s.operatingAirline);
    cells.set(key, set);
  }

  for (const [key, airlineSet] of cells) {
    const operators = [...airlineSet];
    if (operators.some((a) => result.get(a) === 0)) continue;
    const candidate = operators
      .filter((a) => result.has(a))
      .sort((a, b) => (result.get(a) ?? 0) - (result.get(b) ?? 0) || (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0))[0];
    const [region, bucket] = key.split("|") as [Region, string];
    if (!candidate) {
      uncovered.push({ region, bucket });
      continue;
    }
    result.set(candidate, 0);
    promoted.push(candidate);
  }
  return { tiers: result, promoted, uncovered };
}

/**
 * Checks that each cabin class unlock comes with at least one unlocked airline that sells it, so
 * the class can actually be booked (FR-065). Returns human-readable warnings for data review.
 */
export function cabinAvailabilityWarnings(
  tiers: ReadonlyMap<string, number>,
  catalogue: readonly ScheduleSnapshot[],
): string[] {
  const warnings: string[] = [];
  for (const level of LEVELS) {
    const cabin = level.unlocksCabin;
    if (!cabin || cabin === "economy" || cabin === "private") continue;
    const bookable = catalogue.some(
      (s) => (tiers.get(s.operatingAirline) ?? Number.POSITIVE_INFINITY) <= level.airlineTier && offeredCabins(s).includes(cabin),
    );
    if (!bookable) warnings.push(`${level.name} unlocks ${cabin}, but no airline unlocked by then offers it`);
  }
  return warnings;
}
