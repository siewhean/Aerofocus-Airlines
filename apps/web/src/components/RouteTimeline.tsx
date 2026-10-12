/**
 * Route timeline table: the accessible text alternative to the route map (NFR-003). Each row is a
 * button so keyboard and screen-reader users can move the inspector without the canvas.
 */
import type { TimelineEntry } from "@aerofocus/core";
import { formatClock, phaseLabel } from "../lib/format";
import { Board, Cell } from "../ui/Board";
import "./RouteTimeline.css";

interface Props {
  entries: TimelineEntry[];
  timeZone: string;
  onSelect?: (entry: TimelineEntry) => void;
  activeOffsetMs?: number;
}

function nearestIndex(entries: TimelineEntry[], offsetMs: number | undefined): number {
  if (offsetMs === undefined || entries.length === 0) return -1;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  entries.forEach((e, i) => {
    const d = Math.abs(e.offsetMs - offsetMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  });
  return best;
}

export function RouteTimeline({ entries, timeZone, onSelect, activeOffsetMs }: Props) {
  const active = nearestIndex(entries, activeOffsetMs);
  return (
    <Board caption="Route timeline" className="board route-timeline">
      <thead>
        <tr>
          <Cell head>Time</Cell>
          <Cell head>Phase</Cell>
          <Cell head>Place</Cell>
          <Cell head num>
            Progress
          </Cell>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => {
          const isActive = i === active;
          return (
            <tr key={`${e.offsetMs}-${e.reason}`} className={isActive ? "is-active" : undefined} aria-current={isActive ? "true" : undefined}>
              <Cell>
                <button type="button" className="route-timeline-select numeral" onClick={() => onSelect?.(e)} aria-label={`Inspect ${formatClock(e.instant, timeZone)}, ${phaseLabel(e.phase)}, ${e.placeLabel ?? "over the ocean"}`}>
                  {formatClock(e.instant, timeZone)}
                </button>
              </Cell>
              <Cell>{phaseLabel(e.phase)}</Cell>
              <Cell>{e.placeLabel ?? "Over the ocean"}</Cell>
              <Cell num>{e.progressPercent}%</Cell>
            </tr>
          );
        })}
      </tbody>
    </Board>
  );
}
