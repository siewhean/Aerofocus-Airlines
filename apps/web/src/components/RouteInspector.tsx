/**
 * Route inspector panel (FR-017, FR-021). Shows one inspected point on the route as a compact
 * fact list. Reads only the point it is given; it never touches the live flight state (FR-019).
 */
import type { FlightState, InspectionPoint } from "@aerofocus/core";
import { formatClock, formatDuration, phaseLabel } from "../lib/format";
import "./RouteInspector.css";

interface Props {
  point: InspectionPoint | null;
  /** `undefined` = no place lookup available (guest preview); `null` = looked up, nothing nearby. */
  placeLabel?: string | null;
  timeZone: string;
  live: FlightState | null;
}

export function RouteInspector({ point, placeLabel, timeZone, live }: Props) {
  if (!point) {
    return (
      <div className="route-inspector" aria-live="polite">
        <p className="muted route-inspector-hint">Hover, tap or use the slider to inspect any point on the route.</p>
      </div>
    );
  }
  const relation = live && live.status !== "scheduled" ? (point.elapsedMs <= live.elapsedMs ? "Already passed" : "Ahead") : "Ahead";
  const rows: { label: string; value: string }[] = [];
  if (placeLabel !== undefined) rows.push({ label: "Place", value: placeLabel ?? "Over the ocean" });
  rows.push(
    { label: "Elapsed", value: formatDuration(point.elapsedMs) },
    { label: "Remaining", value: formatDuration(point.remainingMs) },
    { label: "Your clock time", value: formatClock(point.instant, timeZone) },
    { label: "Phase", value: phaseLabel(point.phase) },
    { label: "Progress", value: `${point.progressPercent}%` },
  );
  return (
    <div className="route-inspector" aria-live="polite">
      <div className="route-inspector-head">
        <span className={`route-inspector-relation ${relation === "Ahead" ? "is-ahead" : "is-passed"}`}>{relation}</span>
        <span className="small muted">Simulated</span>
      </div>
      <dl className="route-inspector-list">
        {rows.map((r) => (
          <div key={r.label} className="route-inspector-row">
            <dt>{r.label}</dt>
            <dd className="numeral">{r.value}</dd>
          </div>
        ))}
      </dl>
      <details className="route-inspector-coords">
        <summary>Coordinates</summary>
        <p className="numeral small">
          {point.position.lat.toFixed(2)}, {point.position.lon.toFixed(2)}
        </p>
      </details>
    </div>
  );
}
