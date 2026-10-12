/**
 * Route map (FR-016–FR-021): the flight's route on the shared canvas engine with the simulated
 * aircraft, plus an optional inspector. Inspection is computed locally from the plan in memory
 * (`inspectNearestPoint` / `inspectAtDistanceFraction`) and never touches the live flight state
 * (FR-019). Place labels come from the API when a session or snapshot id is available.
 */
import {
  flightStateAt,
  headingAt,
  inspectAtDistanceFraction,
  inspectNearestPoint,
  pointAtDistanceFraction,
  routeGeometry,
  splitAtAntimeridian,
  type FlightPlan,
  type InspectionPoint,
  type LatLon,
} from "@aerofocus/core";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { apiExt, type RouteGeometry } from "../lib/api-ext";
import { formatClock } from "../lib/format";
import { CanvasMap, drawDot, drawLabel, drawPlane, strokeLine, type CanvasMapHandle, type MapFrame, type MapMode } from "../map/CanvasMap";
import { Button } from "../ui/Button";
import { RouteInspector } from "./RouteInspector";
import "./RouteMap.css";

export interface RouteMapProps {
  plan: FlightPlan;
  geometry?: RouteGeometry | null;
  now: number;
  timeZone: string;
  mode?: MapMode;
  height?: number | string;
  inspect?: boolean;
  sessionId?: string | null;
  snapshotId?: string | null;
  className?: string;
  /** Pan, zoom and pointer inspection. Off for thumbnails (community sheet). */
  interactive?: boolean;
}

const GEOMETRY_REFRESH_MS = 5000;
const SLIDER_MAX = 1000;

function crossesAntimeridian(plan: FlightPlan): boolean {
  return Math.abs(plan.origin.lon - plan.destination.lon) > 180;
}

export function RouteMap({ plan, geometry, now, timeZone, mode: initialMode = "flat", height = 320, inspect = false, sessionId = null, snapshotId = null, className, interactive = true }: RouteMapProps) {
  const mapRef = useRef<CanvasMapHandle>(null);
  const [mode, setMode] = useState<MapMode>(initialMode);
  const [inspected, setInspected] = useState<InspectionPoint | null>(null);
  const [sliderValue, setSliderValue] = useState(0);
  const [placeLabel, setPlaceLabel] = useState<string | null | undefined>(undefined);
  const sliderId = useId();

  // Per-frame data lives in refs so `draw` stays allocation-light.
  const nowRef = useRef(now);
  nowRef.current = now;
  const planRef = useRef(plan);
  planRef.current = plan;
  const inspectedRef = useRef<InspectionPoint | null>(null);
  inspectedRef.current = inspected;
  const geomRef = useRef<{ at: number; value: RouteGeometry | null }>({ at: 0, value: geometry ?? null });

  const fullRoute = useMemo(() => splitAtAntimeridian(plan.route.points), [plan]);
  const live = useMemo(() => flightStateAt(plan, now), [plan, now]);
  const canLabel = Boolean(sessionId || snapshotId);

  // Geometry: at most every 5 s (completed/remaining split moves slowly).
  const geomPlanRef = useRef(plan);
  useEffect(() => {
    if (geomPlanRef.current !== plan) {
      geomPlanRef.current = plan;
      geomRef.current = { at: 0, value: null };
    }
    if (geomRef.current.value === null || now - geomRef.current.at >= GEOMETRY_REFRESH_MS) {
      geomRef.current = { at: now, value: routeGeometry(plan, now) };
      mapRef.current?.invalidate();
    }
  }, [plan, now]);

  // Fit the route on mount and when the plan changes.
  useEffect(() => {
    const handle = mapRef.current;
    if (!handle) return;
    // CanvasMap.fitBounds now takes the short way across the date line; for a date-line route we
    // still centre on the route midpoint at world zoom so the whole arc stays in view.
    if (crossesAntimeridian(plan)) handle.centerOn(pointAtDistanceFraction(plan.route, 0.5));
    else handle.fitBounds([plan.origin, plan.destination], 0.3);
  }, [plan, mode]);

  const draw = useCallback(
    (frame: MapFrame) => {
      const p = planRef.current;
      const { theme } = frame;
      strokeLine(frame, fullRoute, { color: theme.line, width: 1, dash: [3, 4] });
      const geom = geomRef.current.value;
      if (geom) {
        for (const f of geom.features) {
          if (f.geometry.type !== "MultiLineString") continue;
          if (f.properties.kind === "completed") strokeLine(frame, f.geometry.coordinates, { color: theme.geo, width: 2.5 });
          else if (f.properties.kind === "remaining") strokeLine(frame, f.geometry.coordinates, { color: theme.geo, width: 2, alpha: 0.45 });
        }
      }
      drawDot(frame, p.origin, 3.5, theme.water, theme.text);
      drawDot(frame, p.destination, 3.5, theme.water, theme.text);
      drawLabel(frame, p.origin, p.origin.iata, theme.text, 8, -10, "700 12px var(--font)");
      drawLabel(frame, p.destination, p.destination.iata, theme.text, 8, -10, "700 12px var(--font)");

      const point = inspectedRef.current;
      if (point) {
        const xy = frame.project(point.position);
        if (xy) {
          const { ctx } = frame;
          ctx.save();
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], 6, 0, Math.PI * 2);
          ctx.strokeStyle = theme.accent;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      const state = flightStateAt(p, nowRef.current);
      drawPlane(frame, state.position, headingAt(p, state.distanceFraction), theme.accent, 9);
    },
    [fullRoute],
  );

  const applyPoint = useCallback((point: InspectionPoint) => {
    setInspected(point);
    setSliderValue(Math.round(point.distanceFraction * SLIDER_MAX));
    mapRef.current?.invalidate();
  }, []);

  const onHover = useCallback(
    (p: LatLon | null) => {
      if (!inspect || !p) return;
      applyPoint(inspectNearestPoint(planRef.current, p, timeZone));
    },
    [inspect, timeZone, applyPoint],
  );
  const onClick = useCallback(
    (p: LatLon | null) => {
      if (!inspect || !p) return;
      applyPoint(inspectNearestPoint(planRef.current, p, timeZone));
    },
    [inspect, timeZone, applyPoint],
  );

  const onSlider = (value: number) => {
    applyPoint(inspectAtDistanceFraction(planRef.current, value / SLIDER_MAX, timeZone));
  };

  // Place label from the API, debounced 300 ms. Guests with no ids get no label at all.
  const fraction = inspected?.distanceFraction ?? null;
  useEffect(() => {
    if (!inspect || fraction === null) {
      setPlaceLabel(undefined);
      return;
    }
    if (!canLabel) {
      setPlaceLabel(undefined);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = sessionId
          ? await apiExt.inspect(sessionId, { fraction })
          : await apiExt.previewInspect(snapshotId as string, { fraction, departure: planRef.current.departure, timeZone });
        if (!cancelled) setPlaceLabel(res.point.placeLabel || null);
      } catch {
        if (!cancelled) setPlaceLabel(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inspect, canLabel, fraction, sessionId, snapshotId, timeZone]);

  const style: CSSProperties = { height: typeof height === "number" ? `${height}px` : height };
  const valueText = inspected ? `${formatClock(inspected.instant, timeZone)}${placeLabel ? `, ${placeLabel}` : ""}` : "Not inspecting";

  return (
    <div className={`route-map ${className ?? ""}`.trim()}>
      <div className="route-map-canvas" style={style}>
        <CanvasMap ref={mapRef} mode={mode} draw={draw} tick={now} interactive={interactive} onHover={onHover} onClick={onClick} ariaLabel={`Route map from ${plan.origin.iata} to ${plan.destination.iata}`} />
      </div>
      <div className="route-map-bar">
        <span className="small muted">Simulated positions</span>
        {interactive && (
          <div className="route-map-modes" role="group" aria-label="Map projection">
            <Button size="sm" variant="secondary" aria-pressed={mode === "flat"} onClick={() => setMode("flat")}>
              Flat
            </Button>
            <Button size="sm" variant="secondary" aria-pressed={mode === "globe"} onClick={() => setMode("globe")}>
              Globe
            </Button>
          </div>
        )}
      </div>
      {inspect && (
        <div className="route-map-inspect">
          <div className="route-map-slider">
            <label htmlFor={sliderId}>Inspect along the route</label>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={SLIDER_MAX}
              step={1}
              value={sliderValue}
              onChange={(e) => onSlider(Number(e.target.value))}
              aria-valuetext={valueText}
              aria-valuemin={0}
              aria-valuemax={SLIDER_MAX}
            />
          </div>
          <RouteInspector point={inspected} placeLabel={canLabel ? placeLabel : undefined} timeZone={timeZone} live={live} />
        </div>
      )}
    </div>
  );
}
