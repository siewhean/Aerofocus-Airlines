/**
 * Booking-time route preview. Phase 4 replaces the strip with the canvas map; the timeline table
 * stays (NFR-003). Shapes: core simulation.ts:19-28 (FlightPlan), timeline.ts:6-18, route-facts.ts:7-15.
 */
import type { FlightPhase, FlightPlan, RouteFacts, TimelineEntry } from "@aerofocus/core";
import type { RouteGeometry } from "../lib/api-ext";
import { formatClock } from "../lib/format";
import { Badge } from "../ui/Badge";
import { Board, Cell } from "../ui/Board";

interface Props {
  plan: FlightPlan;
  geometry: RouteGeometry;
  timeline: TimelineEntry[];
  facts: RouteFacts;
  timeZone: string;
}

const PHASE: Record<FlightPhase, string> = {
  taxi_out: "Taxi out",
  takeoff: "Takeoff",
  climb: "Climb",
  cruise: "Cruise",
  descent: "Descent",
  approach: "Approach",
  landing: "Landing",
  taxi_in: "Taxi in",
};

/** First, last, and every other entry in between: enough to read the story without a wall of rows. */
function sample(entries: TimelineEntry[]): TimelineEntry[] {
  if (entries.length <= 2) return entries;
  const last = entries.length - 1;
  return entries.filter((_, i) => i === 0 || i === last || i % 2 === 0);
}

export function RoutePreview({ plan, timeline, facts, timeZone }: Props) {
  // `geometry` is accepted for the Phase 4 map; the strip only needs phases.
  const total = plan.blockMs || 1;
  const rows = sample(timeline);
  const badges: string[] = [];
  if (facts.crossedEquator) badges.push("Crosses the equator");
  if (facts.crossedAntimeridian) badges.push("Crosses the date line");
  if (facts.sawSunrise) badges.push("You'll see a sunrise");
  if (facts.nightFlight) badges.push("Night flight");

  return (
    <div className="route-preview">
      <svg className="route-strip" width="100%" height="56" role="img" aria-label={`Flight phases from ${plan.origin.iata} to ${plan.destination.iata}`}>
        <line x1="0" y1="28" x2="100%" y2="28" stroke="var(--line)" strokeWidth="1" />
        {plan.phases.map((seg, i) => {
          const x = (seg.startMs / total) * 100;
          const w = Math.max(0.3, ((seg.endMs - seg.startMs) / total) * 100);
          return (
            <rect key={seg.phase + i} x={`${x}%`} y="22" width={`${w}%`} height="12" fill={i % 2 === 0 ? "var(--sky)" : "var(--geo)"}>
              <title>{`${PHASE[seg.phase]}: ${Math.round((seg.endMs - seg.startMs) / 60000)} min`}</title>
            </rect>
          );
        })}
        <text x="0" y="52" className="code route-strip-code" fill="currentColor">
          {plan.origin.iata}
        </text>
        <text x="100%" y="52" textAnchor="end" className="code route-strip-code" fill="currentColor">
          {plan.destination.iata}
        </text>
      </svg>

      {badges.length > 0 && (
        <div className="route-facts">
          {badges.map((b) => (
            <Badge key={b} tone="geo">
              {b}
            </Badge>
          ))}
        </div>
      )}

      <Board caption="Route timeline" className="board route-table">
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
          {rows.map((e) => (
            <tr key={e.offsetMs}>
              <Cell className="numeral">{formatClock(e.instant, timeZone)}</Cell>
              <Cell>{PHASE[e.phase]}</Cell>
              <Cell>{e.placeLabel ?? "Over the ocean"}</Cell>
              <Cell num>{e.progressPercent}%</Cell>
            </tr>
          ))}
        </tbody>
      </Board>
      <p className="small muted">Positions are simulated estimates.</p>
    </div>
  );
}
