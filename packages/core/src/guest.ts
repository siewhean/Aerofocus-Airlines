import { blockDurationMs, type ScheduleSnapshot } from "./schedule";
import type { FlightRecord } from "./stats";
import { DAY, type Instant } from "./time";

/** Guest data lives only on the device and expires 2 weeks after the last flight (FR-069). */
export const GUEST_DATA_TTL_MS = 14 * DAY;

export function guestDataExpiresAt(createdAt: Instant, lastFlightAt: Instant | null): Instant {
  return (lastFlightAt ?? createdAt) + GUEST_DATA_TTL_MS;
}

export function isGuestDataExpired(createdAt: Instant, lastFlightAt: Instant | null, now: Instant): boolean {
  return now >= guestDataExpiresAt(createdAt, lastFlightAt);
}

/** A guest flight record submitted for import on account creation (FR-071). */
export interface GuestFlightImport extends FlightRecord {
  snapshotId: string;
  validatedAt: Instant | null;
  studyGoal: string | null;
  goalCompleted: boolean | null;
}

export type ImportRejection =
  | "unknown_snapshot"
  | "duration_mismatch"
  | "in_future"
  | "overlaps_another_flight"
  | "focus_exceeds_flight"
  | "invalid_outcome";

export interface ImportResult {
  accepted: GuestFlightImport[];
  rejected: { record: GuestFlightImport; reason: ImportRejection }[];
}

/**
 * Validates device-stored history before it is accepted: each flight must match a known schedule
 * snapshot, flights must not overlap, and none may be in the future (FR-071).
 */
export function validateGuestImport(
  records: readonly GuestFlightImport[],
  snapshots: ReadonlyMap<string, ScheduleSnapshot>,
  now: Instant,
): ImportResult {
  const accepted: GuestFlightImport[] = [];
  const rejected: ImportResult["rejected"] = [];
  const sorted = [...records].sort((a, b) => a.departure - b.departure);
  let lastArrival = Number.NEGATIVE_INFINITY;
  for (const record of sorted) {
    const reject = (reason: ImportRejection): void => {
      rejected.push({ record, reason });
    };
    const snapshot = snapshots.get(record.snapshotId);
    if (!["complete", "invalid", "ended_early", "no_show"].includes(record.outcome)) reject("invalid_outcome");
    else if (!snapshot) reject("unknown_snapshot");
    else if (record.arrival - record.departure !== blockDurationMs(snapshot) || record.blockMs !== blockDurationMs(snapshot)) {
      reject("duration_mismatch");
    } else if (record.arrival > now || record.departure > now) reject("in_future");
    else if (record.departure < lastArrival) reject("overlaps_another_flight");
    else if (record.creditedFocusMs > record.blockMs || record.creditedFlightMs > record.blockMs) {
      reject("focus_exceeds_flight");
    } else {
      accepted.push(record);
      lastArrival = record.arrival;
    }
  }
  return { accepted, rejected };
}
