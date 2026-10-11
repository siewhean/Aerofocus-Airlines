/**
 * Community map (FR-055–FR-062): every public flight as a moving dot, clustered by the server.
 * Positions are computed locally from each descriptor's schedule with a cached FlightPlan per id
 * (never `publicFlightPosition` per frame, which rebuilds a plan). A tapped aircraft opens a sheet
 * with route, position and passenger count only (AC-32).
 */
import { createFlightPlan, flightStateAt, headingAt, type Airport, type ClusterResult, type FlightPlan, type PublicFlightDescriptor } from "@aerofocus/core";
import { AIRPORTS_BY_IATA } from "@aerofocus/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page } from "../app/Shell";
import { RouteCodes } from "../components/RouteCodes";
import { RouteMap } from "../components/RouteMap";
import { clock, errorMessage } from "../lib/api";
import { apiExt, type PublicFlightResponse } from "../lib/api-ext";
import { formatClock } from "../lib/format";
import { useSession } from "../lib/session";
import { CanvasMap, drawPlane, type CanvasMapHandle, type MapFrame } from "../map/CanvasMap";
import { Empty, Notice, Section } from "../ui/Board";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Field";
import { Icon } from "../ui/Icon";
import "./Community.css";

type Item = ClusterResult<PublicFlightDescriptor>;
type View = { zoom: number; bbox: [number, number, number, number] | null };

const POLL_MS = 60_000;
const VIEW_DEBOUNCE_MS = 400;
const HIT_RADIUS_PX = 12;

function airportFor(a: PublicFlightDescriptor["origin"]): Airport {
  return AIRPORTS_BY_IATA.get(a.iata) ?? { iata: a.iata, lat: a.lat, lon: a.lon, name: a.iata, city: "", country: "", region: "asia", timeZone: "UTC" };
}

export function planFromDescriptor(d: PublicFlightDescriptor): FlightPlan {
  return createFlightPlan({ origin: airportFor(d.origin), destination: airportFor(d.destination), departure: d.departure, blockMs: d.blockMs });
}

/** True when the view moved enough to warrant a new cluster request. */
function viewChanged(a: View | null, b: View): boolean {
  if (!a) return true;
  if (a.zoom !== b.zoom) return true;
  if (!a.bbox || !b.bbox) return a.bbox !== b.bbox;
  const w = Math.max(1, a.bbox[2] - a.bbox[0]);
  const h = Math.max(1, a.bbox[3] - a.bbox[1]);
  return Math.abs(a.bbox[0] - b.bbox[0]) > w * 0.1 || Math.abs(a.bbox[2] - b.bbox[2]) > w * 0.1 || Math.abs(a.bbox[1] - b.bbox[1]) > h * 0.1 || Math.abs(a.bbox[3] - b.bbox[3]) > h * 0.1;
}

export default function Community() {
  const { prefs, updatePrefs, timeZone } = useSession();
  const mapRef = useRef<CanvasMapHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Item[]>([]);
  const plansRef = useRef(new Map<string, FlightPlan>());
  const screenRef = useRef<{ id: string; x: number; y: number }[]>([]);
  const showRef = useRef(prefs.showOtherFlights);
  showRef.current = prefs.showOtherFlights;
  const nowRef = useRef(clock.now());

  const [now, setNow] = useState(() => clock.now());
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ loading: boolean; data: PublicFlightResponse | null; error: string | null } | null>(null);

  const lastFetchedRef = useRef<View | null>(null);
  const candidateRef = useRef<View | null>(null);
  const timerRef = useRef(0);
  const requestSeq = useRef(0);

  const fetchClusters = useCallback(async (view: View) => {
    const seq = ++requestSeq.current;
    try {
      const res = await apiExt.communityClusters(Math.floor(view.zoom), view.bbox ?? undefined);
      if (seq !== requestSeq.current) return;
      lastFetchedRef.current = view;
      itemsRef.current = res.items;
      const plans = plansRef.current;
      const seen = new Set<string>();
      for (const it of res.items) {
        if (it.type !== "item") continue;
        seen.add(it.item.id);
        if (!plans.has(it.item.id)) plans.set(it.item.id, planFromDescriptor(it.item));
      }
      for (const id of [...plans.keys()]) if (!seen.has(id)) plans.delete(id);
      setTotal(res.total);
      setError(null);
      mapRef.current?.invalidate();
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(errorMessage(err));
    }
  }, []);

  // 1 s tick so aircraft move; 60 s poll for fresh descriptors.
  useEffect(() => {
    const tick = window.setInterval(() => {
      nowRef.current = clock.now();
      setNow(Math.floor(nowRef.current / 1000));
    }, 1000);
    const poll = window.setInterval(() => void fetchClusters(lastFetchedRef.current ?? { zoom: 1, bbox: null }), POLL_MS);
    void fetchClusters({ zoom: 1, bbox: null });
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      window.clearTimeout(timerRef.current);
    };
  }, [fetchClusters]);

  const onViewChange = useCallback(
    ({ bbox, zoom }: { bbox: MapFrame["bbox"]; zoom: number }) => {
      const view: View = { zoom: Math.floor(zoom), bbox };
      if (!viewChanged(candidateRef.current, view)) return;
      candidateRef.current = view;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const c = candidateRef.current;
        if (c && viewChanged(lastFetchedRef.current, c)) void fetchClusters(c);
      }, VIEW_DEBOUNCE_MS);
    },
    [fetchClusters],
  );

  const draw = useCallback((frame: MapFrame) => {
    const { ctx, theme } = frame;
    const t = nowRef.current;
    const hits = screenRef.current;
    hits.length = 0;
    const show = showRef.current;
    for (const it of itemsRef.current) {
      if (it.type === "item") {
        if (!show) continue;
        const plan = plansRef.current.get(it.item.id);
        if (!plan) continue;
        const state = flightStateAt(plan, t);
        const xy = frame.project(state.position);
        if (!xy) continue;
        hits.push({ id: it.item.id, x: xy[0], y: xy[1] });
        drawPlane(frame, state.position, headingAt(plan, state.distanceFraction), it.item.kind === "community" ? theme.accent : theme.geo, 8);
      } else {
        if (!show) continue;
        const xy = frame.project(it.position);
        if (!xy) continue;
        const r = Math.min(28, 10 + Math.sqrt(it.count) * 3);
        ctx.save();
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
        ctx.fillStyle = theme.geo;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = theme.water;
        ctx.font = "600 12px var(--font)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(it.count), xy[0], xy[1]);
        ctx.restore();
      }
    }
  }, []);

  const openFlight = useCallback(async (id: string) => {
    setSelected({ loading: true, data: null, error: null });
    try {
      const data = await apiExt.publicFlight(id);
      setSelected((s) => (s?.loading ? { loading: false, data, error: null } : s));
    } catch (err) {
      setSelected({ loading: false, data: null, error: errorMessage(err) });
    }
  }, []);

  const onClick = useCallback(
    (_p: unknown, event: PointerEvent) => {
      const el = wrapRef.current;
      if (!el || !showRef.current) return;
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let best: { id: string; d: number } | null = null;
      for (const h of screenRef.current) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= HIT_RADIUS_PX && (!best || d < best.d)) best = { id: h.id, d };
      }
      if (best) void openFlight(best.id);
    },
    [openFlight],
  );

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const selectedPlan = useMemo(() => (selected?.data ? planFromDescriptor(selected.data.flight) : null), [selected?.data]);

  return (
    <Page title="Community flights" lead="Every aircraft is someone studying right now. You see only routes and positions, never names.">
      <Section aside={total !== null ? <span className="numeral">{total} aircraft in the air</span> : undefined}>
        <div className="community-controls">
          <Toggle label="Show other flights" checked={prefs.showOtherFlights} onChange={(v) => updatePrefs({ showOtherFlights: v })} />
        </div>
        {error && <Notice tone="amber">{error}</Notice>}
        <div className="community-map" ref={wrapRef}>
          <CanvasMap ref={mapRef} mode="flat" draw={draw} tick={now} onClick={onClick} onViewChange={onViewChange} initialScale={1} ariaLabel="Community flights map" />
          {selected && (
            <aside className="community-sheet" aria-label="Flight details">
              <div className="community-sheet-head">
                {selected.data ? <RouteCodes origin={selected.data.flight.origin} destination={selected.data.flight.destination} size="lg" /> : <span className="muted">Loading flight</span>}
                <Button variant="quiet" size="sm" aria-label="Close" onClick={() => setSelected(null)} icon={<Icon name="close" size={18} />} />
              </div>
              {selected.error && <Notice tone="amber">{selected.error}</Notice>}
              {selected.data && selectedPlan && (
                <>
                  <p className="community-sheet-meta">
                    <span>{selected.data.flight.kind === "community" ? "Community Flight" : "Solo flight"}</span>
                    <span className="community-rule" aria-hidden="true" />
                    <span className="numeral">{selected.data.flight.passengerCount ?? 1} aboard</span>
                  </p>
                  <p className="community-sheet-times numeral">
                    <span>Departed at {formatClock(selected.data.flight.departure, timeZone)}</span>
                    <span className="community-rule" aria-hidden="true" />
                    <span>Lands at {formatClock(selected.data.flight.departure + selected.data.flight.blockMs, timeZone)}</span>
                  </p>
                  <RouteMap plan={selectedPlan} geometry={selected.data.path} now={nowRef.current} timeZone={timeZone} height={180} inspect={false} interactive={false} />
                </>
              )}
            </aside>
          )}
        </div>
        {total === 0 && <Empty title="The skies are quiet.">Book a flight and you'll be the first dot.</Empty>}
        <p className="small muted">Positions are calculated from each flight's published schedule and are not live aircraft tracking.</p>
      </Section>
    </Page>
  );
}
