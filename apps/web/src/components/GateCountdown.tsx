/**
 * The Layover Terminal's hero: a gate countdown in signage numerals (docs/UI-PLAN.md Phase 7).
 * Ticks are driven by the parent, which derives `ms` from the server clock; the server's
 * msTo* figures are snapshots and never used directly (docs/API.md LayoverView).
 */
import type { ReactNode } from "react";
import { formatCountdown } from "../lib/format";
import "./GateCountdown.css";

interface Props {
  label: string;
  ms: number;
  tone?: "neutral" | "signal" | "amber" | "danger";
  sub?: ReactNode;
}

export function GateCountdown({ label, ms, tone = "neutral", sub }: Props) {
  return (
    <div className={`gate gate-${tone}`}>
      <span className="gate-label">{label}</span>
      {/* aria-live="off" keeps the per-second tick out of the hero's polite region. */}
      <span className="display numeral gate-value" role="timer" aria-live="off">
        {formatCountdown(Math.max(0, ms))}
      </span>
      {sub && <span className="gate-sub muted">{sub}</span>}
    </div>
  );
}
