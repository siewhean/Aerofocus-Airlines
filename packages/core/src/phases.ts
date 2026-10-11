import { MINUTE } from "./time";

export type FlightPhase =
  | "taxi_out"
  | "takeoff"
  | "climb"
  | "cruise"
  | "descent"
  | "approach"
  | "landing"
  | "taxi_in";

export const PHASE_ORDER: readonly FlightPhase[] = [
  "taxi_out",
  "takeoff",
  "climb",
  "cruise",
  "descent",
  "approach",
  "landing",
  "taxi_in",
];

export type NonCruisePhase = Exclude<FlightPhase, "cruise">;

/** Default phase durations in minutes (FR-011a). Provisional. */
export const DEFAULT_PHASE_MINUTES: Readonly<Record<NonCruisePhase, number>> = {
  taxi_out: 15,
  takeoff: 1,
  climb: 20,
  descent: 25,
  approach: 8,
  landing: 1,
  taxi_in: 7,
};

/** Cruise never falls below this share of block time; shorter flights scale non-cruise phases down. */
export const MIN_CRUISE_SHARE = 0.15;

/**
 * Relative ground speed per phase, used to map time to distance along the route (FR-018).
 * Zero means the aircraft is at the airport.
 */
export const GROUND_SPEED_WEIGHT: Readonly<Record<FlightPhase, number>> = {
  taxi_out: 0,
  takeoff: 0,
  climb: 0.6,
  cruise: 1,
  descent: 0.7,
  approach: 0.4,
  landing: 0,
  taxi_in: 0,
};

export interface PhaseSegment {
  phase: FlightPhase;
  /** Offset from block start (pushback), in ms. */
  startMs: number;
  endMs: number;
}

export interface PhaseOverrides {
  /** Airport-specific taxi-out minutes, when reliable data exists. */
  taxiOutMinutes?: number;
  /** Airport-specific taxi-in minutes, when reliable data exists. */
  taxiInMinutes?: number;
}

/** Splits a block duration into phases (FR-011a). Deterministic. */
export function buildPhasePlan(blockMs: number, overrides: PhaseOverrides = {}): PhaseSegment[] {
  if (!(blockMs > 0)) throw new RangeError("Block duration must be positive");
  const minutes: Record<NonCruisePhase, number> = {
    ...DEFAULT_PHASE_MINUTES,
    ...(overrides.taxiOutMinutes !== undefined ? { taxi_out: overrides.taxiOutMinutes } : {}),
    ...(overrides.taxiInMinutes !== undefined ? { taxi_in: overrides.taxiInMinutes } : {}),
  };
  const nonCruiseMs = Object.values(minutes).reduce((sum, m) => sum + m * MINUTE, 0);
  const maxNonCruiseMs = blockMs * (1 - MIN_CRUISE_SHARE);
  const scale = nonCruiseMs > maxNonCruiseMs ? maxNonCruiseMs / nonCruiseMs : 1;

  const durations = new Map<FlightPhase, number>();
  let used = 0;
  for (const phase of PHASE_ORDER) {
    if (phase === "cruise") continue;
    const ms = minutes[phase] * MINUTE * scale;
    durations.set(phase, ms);
    used += ms;
  }
  durations.set("cruise", blockMs - used);

  const segments: PhaseSegment[] = [];
  let cursor = 0;
  for (const phase of PHASE_ORDER) {
    const ms = durations.get(phase) ?? 0;
    segments.push({ phase, startMs: cursor, endMs: cursor + ms });
    cursor += ms;
  }
  // Absorb floating-point drift so the last phase ends exactly at block end.
  const last = segments[segments.length - 1];
  if (last) last.endMs = blockMs;
  return segments;
}

export function phaseAt(plan: readonly PhaseSegment[], offsetMs: number): PhaseSegment {
  const first = plan[0];
  const last = plan[plan.length - 1];
  if (!first || !last) throw new RangeError("Empty phase plan");
  if (offsetMs <= first.startMs) return first;
  if (offsetMs >= last.endMs) return last;
  return plan.find((s) => offsetMs >= s.startMs && offsetMs < s.endMs) ?? last;
}

/** End of taxi-out, i.e. takeoff roll. Late boarding on Community Flights closes here (FR-004). */
export function takeoffOffsetMs(plan: readonly PhaseSegment[]): number {
  const taxiOut = plan.find((s) => s.phase === "taxi_out");
  if (!taxiOut) throw new RangeError("Phase plan has no taxi-out");
  return taxiOut.endMs;
}

function weightedTotal(plan: readonly PhaseSegment[]): number {
  return plan.reduce((sum, s) => sum + (s.endMs - s.startMs) * GROUND_SPEED_WEIGHT[s.phase], 0);
}

/** Fraction (0..1) of route distance covered at a time offset. */
export function distanceFractionAt(plan: readonly PhaseSegment[], offsetMs: number): number {
  const total = weightedTotal(plan);
  if (total <= 0) return 0;
  let covered = 0;
  for (const s of plan) {
    if (offsetMs <= s.startMs) break;
    const end = Math.min(offsetMs, s.endMs);
    covered += (end - s.startMs) * GROUND_SPEED_WEIGHT[s.phase];
  }
  return Math.min(1, Math.max(0, covered / total));
}

/**
 * Time offset at which a given distance fraction is reached. Inverse of distanceFractionAt.
 * 0 maps to pushback and 1 maps to arrival at the gate.
 */
export function offsetAtDistanceFraction(plan: readonly PhaseSegment[], fraction: number): number {
  const last = plan[plan.length - 1];
  if (!last) throw new RangeError("Empty phase plan");
  if (fraction <= 0) return 0;
  if (fraction >= 1) return last.endMs;
  const target = fraction * weightedTotal(plan);
  let covered = 0;
  for (const s of plan) {
    const weight = GROUND_SPEED_WEIGHT[s.phase];
    const segmentDistance = (s.endMs - s.startMs) * weight;
    if (weight > 0 && covered + segmentDistance >= target) {
      return s.startMs + (target - covered) / weight;
    }
    covered += segmentDistance;
  }
  return last.endMs;
}

/** Typical cruise altitude for a block length, in feet. Illustrative only. */
export function cruiseAltitudeFtFor(blockMs: number): number {
  if (blockMs < 60 * MINUTE) return 20_000;
  if (blockMs < 120 * MINUTE) return 30_000;
  return 36_000;
}

/** Approximate altitude at a time offset, for presentation (not authoritative). */
export function altitudeFtAt(plan: readonly PhaseSegment[], offsetMs: number, cruiseAltitudeFt: number): number {
  const segment = phaseAt(plan, offsetMs);
  const span = segment.endMs - segment.startMs;
  const t = span > 0 ? Math.min(1, Math.max(0, (offsetMs - segment.startMs) / span)) : 1;
  const approachStartFt = 3_000;
  switch (segment.phase) {
    case "taxi_out":
    case "takeoff":
    case "landing":
    case "taxi_in":
      return 0;
    case "climb":
      return Math.round(cruiseAltitudeFt * t);
    case "cruise":
      return cruiseAltitudeFt;
    case "descent":
      return Math.round(cruiseAltitudeFt - (cruiseAltitudeFt - approachStartFt) * t);
    case "approach":
      return Math.round(approachStartFt * (1 - t));
  }
}
