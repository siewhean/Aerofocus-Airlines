/**
 * Flight plan panel (docs/UI-PLAN.md Phase 8, item 6): the kind of sheet printed for a crew, not a
 * dashboard. Altitude profile from the phase model (packages/core/src/phases.ts altitudeFtAt),
 * waypoints from the route timeline, sunrise and sunset markers, an estimated cruise speed and
 * the cabin log. Every figure is estimated from the published schedule.
 */
import { altitudeFtAt, GROUND_SPEED_WEIGHT, MINUTE, HOUR, type FlightPlan as CorePlan, type FlightState, type TimelineEntry } from "@aerofocus/core";
import { useId, useMemo } from "react";
import { formatClock, formatDuration, phaseLabel } from "../lib/format";
import "./FlightPlan.css";

export interface FlightPlanProps {
  plan: CorePlan;
  state: FlightState | null;
  timeline: TimelineEntry[];
  daylightEvents: { type: "sunrise" | "sunset"; instant: number }[];
  timeZone: string;
  announcements?: { at: number; text: string }[];
}

const W = 720;
const H = 160;
const PAD = { top: 22, right: 12, bottom: 26, left: 48 };
const SAMPLE_MS = 2 * MINUTE;

export function FlightPlan({ plan, state, timeline, daylightEvents, timeZone, announcements = [] }: FlightPlanProps) {
  const id = useId();
  const block = plan.blockMs;
  const maxFt = Math.max(40_000, Math.ceil(plan.cruiseAltitudeFt / 10_000) * 10_000);

  const geometry = useMemo(() => {
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + (Math.min(Math.max(t, 0), block) / block) * innerW;
    const y = (ft: number) => PAD.top + innerH - (Math.min(ft, maxFt) / maxFt) * innerH;
    const points: [number, number][] = [];
    for (let t = 0; t <= block; t += SAMPLE_MS) points.push([x(t), y(altitudeFtAt(plan.phases, t, plan.cruiseAltitudeFt))]);
    points.push([x(block), y(0)]);
    const line = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
    const area = `${line} L${x(block).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
    // Hour ticks, skipping any that would collide with the departure or arrival labels.
    const hours: number[] = [];
    for (let t = HOUR; t < block; t += HOUR) if (x(t) - x(0) > 44 && x(block) - x(t) > 44) hours.push(t);
    const table: { offsetMs: number; ft: number }[] = [];
    for (let t = 0; t <= block; t += 30 * MINUTE) table.push({ offsetMs: t, ft: altitudeFtAt(plan.phases, t, plan.cruiseAltitudeFt) });
    return { x, y, line, area, hours, table, innerH };
  }, [plan, block, maxFt]);

  const cruiseSpeed = useMemo(() => {
    const weighted = plan.phases.reduce((sum, s) => sum + (s.endMs - s.startMs) * GROUND_SPEED_WEIGHT[s.phase], 0);
    return weighted > 0 ? Math.round(plan.route.distanceKm / (weighted / HOUR) / 10) * 10 : null;
  }, [plan]);

  const elapsed = state?.elapsedMs ?? 0;
  const yTicks = [];
  for (let ft = 0; ft <= maxFt; ft += 10_000) yTicks.push(ft);
  const departure = plan.departure;

  return (
    <section className="flightplan" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Flight plan</h3>

      <figure className="flightplan-profile">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Altitude profile: cruise at ${plan.cruiseAltitudeFt.toLocaleString()} feet over a ${formatDuration(block)} flight. Estimated from the published schedule.`}>
          {yTicks.map((ft) => (
            <g key={ft}>
              <line x1={PAD.left} x2={W - PAD.right} y1={geometry.y(ft)} y2={geometry.y(ft)} className="fp-grid" />
              <text x={PAD.left - 6} y={geometry.y(ft)} className="fp-tick" textAnchor="end" dominantBaseline="middle">
                {ft === 0 ? "0" : `${ft / 1000}k`}
              </text>
            </g>
          ))}
          {plan.phases.map((seg) =>
            // Label only phases wide enough for their text; short ones keep the rule without a label.
            seg.startMs > 0 && ((seg.endMs - seg.startMs) / block) * (W - PAD.left - PAD.right) > 56 ? (
              <g key={seg.phase}>
                <line x1={geometry.x(seg.startMs)} x2={geometry.x(seg.startMs)} y1={PAD.top - 6} y2={H - PAD.bottom} className="fp-phase" />
                <text x={geometry.x(seg.startMs) + 3} y={PAD.top - 9} className="fp-phase-label">
                  {phaseLabel(seg.phase)}
                </text>
              </g>
            ) : seg.startMs > 0 ? (
              <line key={seg.phase} x1={geometry.x(seg.startMs)} x2={geometry.x(seg.startMs)} y1={PAD.top} y2={H - PAD.bottom} className="fp-phase" />
            ) : null,
          )}
          <path d={geometry.area} className="fp-area" />
          <path d={geometry.line} className="fp-line" />
          {daylightEvents.map((e) => {
            const t = e.instant - departure;
            if (t < 0 || t > block) return null;
            return (
              <g key={`${e.type}-${e.instant}`} transform={`translate(${geometry.x(t)}, ${H - PAD.bottom + 4})`}>
                <circle r="4" className={`fp-sun fp-sun-${e.type}`} />
                <title>{`${e.type === "sunrise" ? "Sunrise" : "Sunset"} at ${formatClock(e.instant, timeZone)}`}</title>
              </g>
            );
          })}
          {state && state.status !== "scheduled" && (
            <g transform={`translate(${geometry.x(elapsed)}, ${geometry.y(state.altitudeFt)})`}>
              <circle r="5" className="fp-now" />
              {elapsed > block * 0.04 && (
                <text x="8" y="-6" className="fp-now-label">
                  {formatClock(departure + elapsed, timeZone)}
                </text>
              )}
            </g>
          )}
          <text x={PAD.left} y={H - 6} className="fp-tick">
            {formatClock(departure, timeZone)}
          </text>
          {geometry.hours.map((t) => (
            <text key={t} x={geometry.x(t)} y={H - 6} className="fp-tick" textAnchor="middle">
              +{Math.round(t / HOUR)} h
            </text>
          ))}
          <text x={W - PAD.right} y={H - 6} className="fp-tick" textAnchor="end">
            {formatClock(departure + block, timeZone)}
          </text>
        </svg>
        <figcaption className="small muted">
          Altitude in feet against your clock time. Cruise {plan.cruiseAltitudeFt.toLocaleString()} ft.
          {cruiseSpeed !== null && ` Estimated cruise ground speed ${cruiseSpeed} km/h.`} All figures are estimated from the published schedule.
        </figcaption>
        <table className="visually-hidden">
          <caption>Altitude every 30 minutes</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Altitude</th>
            </tr>
          </thead>
          <tbody>
            {geometry.table.map((row) => (
              <tr key={row.offsetMs}>
                <td>{formatClock(departure + row.offsetMs, timeZone)}</td>
                <td>{Math.round(row.ft).toLocaleString()} ft</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>

      <div className="flightplan-columns">
        <div>
          <h4>Waypoints</h4>
          <ol className="fp-waypoints">
            {timeline.map((entry) => {
              const current = state ? entry.offsetMs <= elapsed && (timeline.find((n) => n.offsetMs > entry.offsetMs)?.offsetMs ?? Infinity) > elapsed : false;
              return (
                <li key={entry.offsetMs} className={current ? "is-current" : undefined} aria-current={current ? "step" : undefined}>
                  <span className="numeral">{formatClock(entry.instant, timeZone)}</span>
                  <span>{phaseLabel(entry.phase)}</span>
                  <span className="muted">{entry.placeLabel ?? "Over the ocean"}</span>
                  <span className="numeral muted">{entry.progressPercent}%</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <h4>Cabin log</h4>
          {announcements.length === 0 ? (
            <p className="muted small">No announcements yet.</p>
          ) : (
            <ol className="fp-log">
              {announcements.map((a) => (
                <li key={`${a.at}-${a.text}`}>
                  <span className="numeral">{formatClock(a.at, timeZone)}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
