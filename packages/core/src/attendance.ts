import { MINUTE, type Instant } from "./time";

/**
 * Signals the app sends while a flight is open (FR-013a).
 * - beat: periodic "app is open" signal (about once a minute where the app runs in the background)
 * - background: the OS is about to pause the app (phones). Only send on platforms that pause apps.
 * - resume: the app returned from the background
 * - reopen: the app started from closed while a flight was open
 * None of these inspect screen content, input or what the user is doing (FR-031).
 */
export type AttendanceSignalKind = "beat" | "background" | "resume" | "reopen";

export interface AttendanceSignal {
  at: Instant;
  kind: AttendanceSignalKind;
}

export const HEARTBEAT_INTERVAL_MS = MINUTE;
export const UNATTENDED_THRESHOLD_MS = 5 * MINUTE;

export interface TimeSpan {
  start: Instant;
  end: Instant;
}

/**
 * Unattended spans between `from` and `to`: the app was closed or the computer slept (FR-013a).
 * A paused phone app (background → resume) counts as attended, because phones cannot tell a locked
 * screen from another app in use.
 */
export function unattendedSpans(
  signals: readonly AttendanceSignal[],
  from: Instant,
  to: Instant,
  thresholdMs = UNATTENDED_THRESHOLD_MS,
): TimeSpan[] {
  if (to <= from) return [];
  const sorted = signals.filter((s) => s.at >= from && s.at <= to).sort((a, b) => a.at - b.at);
  const spans: TimeSpan[] = [];
  // The passenger is present when the span starts (they just boarded or resumed focus).
  let prev: AttendanceSignal = { at: from, kind: "beat" };
  for (const signal of sorted) {
    const gap = signal.at - prev.at;
    if (signal.kind === "reopen") {
      if (gap > 0) spans.push({ start: prev.at, end: signal.at });
    } else if (prev.kind !== "background" && gap > thresholdMs) {
      spans.push({ start: prev.at, end: signal.at });
    }
    prev = signal;
  }
  if (prev.kind !== "background" && to - prev.at > thresholdMs) spans.push({ start: prev.at, end: to });
  return mergeSpans(spans);
}

/** Whether the passenger is unattended right now: the latest signal is too old (and not a paused phone app). */
export function isUnattendedAt(
  signals: readonly AttendanceSignal[],
  from: Instant,
  now: Instant,
  thresholdMs = UNATTENDED_THRESHOLD_MS,
): boolean {
  let last: AttendanceSignal | null = null;
  for (const s of signals) if (s.at <= now && (last === null || s.at >= last.at)) last = s;
  if (last === null || last.at < from) return now - from > thresholdMs;
  if (last.kind === "background") return false;
  return now - last.at > thresholdMs;
}

export function mergeSpans(spans: readonly TimeSpan[]): TimeSpan[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const merged: TimeSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Total length of `spans` that falls inside [start, end). */
export function overlapMs(spans: readonly TimeSpan[], start: Instant, end: Instant): number {
  let total = 0;
  for (const span of spans) {
    const s = Math.max(span.start, start);
    const e = Math.min(span.end, end);
    if (e > s) total += e - s;
  }
  return total;
}
