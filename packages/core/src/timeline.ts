import type { LatLon } from "./geo";
import type { FlightPhase } from "./phases";
import { inspectAtOffset, type FlightPlan } from "./simulation";
import { MINUTE } from "./time";

export interface TimelineEntry {
  offsetMs: number;
  instant: number;
  /** In the user's own time zone (FR-012). */
  localTime: string;
  phase: FlightPhase;
  position: LatLon;
  /** e.g. "Over India"; null when no reliable place is known (FR-021). */
  placeLabel: string | null;
  /** Phase changes are always included so the timeline reads as a story. */
  reason: "phase_start" | "interval" | "arrival";
  progressPercent: number;
}

/**
 * Text alternative to the route map (NFR-003): entries at every phase change and at a regular
 * interval, each with time, phase and location, suitable for screen readers and keyboard users.
 */
export function routeTimeline(
  plan: FlightPlan,
  userTimeZone: string,
  options: { intervalMinutes?: number; describe?: (position: LatLon) => string | null } = {},
): TimelineEntry[] {
  const interval = (options.intervalMinutes ?? 30) * MINUTE;
  const offsets = new Map<number, TimelineEntry["reason"]>();
  for (const segment of plan.phases) {
    if (segment.endMs - segment.startMs > 0) offsets.set(Math.round(segment.startMs), "phase_start");
  }
  for (let t = interval; t < plan.blockMs; t += interval) if (!offsets.has(t)) offsets.set(t, "interval");
  offsets.set(plan.blockMs, "arrival");

  return [...offsets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, reason]) => {
      const p = inspectAtOffset(plan, offset, userTimeZone);
      return {
        offsetMs: p.offsetMs,
        instant: p.instant,
        localTime: p.localTime,
        phase: reason === "arrival" ? "taxi_in" : p.phase,
        position: p.position,
        placeLabel: options.describe ? options.describe(p.position) : null,
        reason,
        progressPercent: p.progressPercent,
      };
    });
}
