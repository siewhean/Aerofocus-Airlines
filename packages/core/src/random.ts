import { blockDurationMs, offeredCabins, type CabinClass, type ScheduleSnapshot } from "./schedule";

export type Rng = () => number;

/** Deterministic PRNG (mulberry32), seeded from a number or string. */
export function seededRng(seed: number | string): Rng {
  let h = typeof seed === "number" ? seed >>> 0 : 2166136261;
  if (typeof seed === "string") {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random Flight cabin odds (FR-005). Business and First are rare. Provisional, set during tuning. */
export const RANDOM_CABIN_WEIGHTS: Readonly<Record<Exclude<CabinClass, "private">, number>> = {
  economy: 70,
  premium_economy: 18,
  business: 9,
  first: 3,
};

export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll < 0) return item;
  }
  return items[items.length - 1] ?? null;
}

export interface RandomFlightPick {
  snapshot: ScheduleSnapshot;
  cabin: CabinClass;
}

/**
 * Picks a genuine flight whose published duration fits the study duration, then a cabin with
 * weighted odds. Airlines and classes are not limited by unlocks (FR-005).
 * Prefers flights between (1 - tolerance) × and 1 × the study duration; falls back to the longest
 * flights that still fit.
 */
export function pickRandomFlight(
  candidates: readonly ScheduleSnapshot[],
  studyMs: number,
  rng: Rng,
  tolerance = 0.25,
): RandomFlightPick | null {
  const fitting = candidates.filter((c) => blockDurationMs(c) <= studyMs);
  if (fitting.length === 0) return null;
  let pool = fitting.filter((c) => blockDurationMs(c) >= studyMs * (1 - tolerance));
  if (pool.length === 0) {
    const longest = Math.max(...fitting.map(blockDurationMs));
    pool = fitting.filter((c) => blockDurationMs(c) === longest);
  }
  const snapshot = pool[Math.floor(rng() * pool.length)] ?? pool[0];
  if (!snapshot) return null;
  const cabins = offeredCabins(snapshot).filter((c): c is Exclude<CabinClass, "private"> => c !== "private");
  const cabin = pickWeighted(cabins, (c) => RANDOM_CABIN_WEIGHTS[c], rng) ?? "economy";
  return { snapshot, cabin };
}
