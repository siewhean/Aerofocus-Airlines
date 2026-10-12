/**
 * Personal globe (FR-053): every validated leg on an orthographic canvas. Signed-in users read
 * `/v1/me/globe`; guests build the same collection from their device history with
 * `buildGreatCircleRoute` + `splitAtAntimeridian`.
 */
import { buildGreatCircleRoute, splitAtAntimeridian, type GuestFlightImport, type LatLon, type Position } from "@aerofocus/core";
import { AIRPORTS_BY_IATA } from "@aerofocus/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page } from "../app/Shell";
import { errorMessage } from "../lib/api";
import { apiExt, type AirlineView, type GlobeResponse } from "../lib/api-ext";
import { countryName, formatDate, formatDuration } from "../lib/format";
import { useSession } from "../lib/session";
import { CanvasMap, drawDot, drawLabel, strokeLine, type CanvasMapHandle, type MapFrame } from "../map/CanvasMap";
import { Empty, Facts, Notice, Section, Skeleton } from "../ui/Board";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";
import "./Globe.css";

interface Leg {
  id: string;
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  destinationCountry: string;
  departure: number;
  blockMs: number;
  coordinates: Position[][];
  mid: LatLon;
}
interface AirportNode extends LatLon {
  iata: string;
  name: string;
  city: string;
  country: string;
  visits: number;
}
interface Collection {
  legs: Leg[];
  airports: AirportNode[];
  countries: string[];
}
interface Filters {
  airline: string;
  country: string;
  from: string;
  to: string;
}

const HIT_PX = 12;
const DAY_MS = 86_400_000;

function midpointOf(coordinates: Position[][]): LatLon {
  const flat = coordinates.flat();
  const m = flat[Math.floor(flat.length / 2)] ?? [0, 0];
  return { lat: m[1], lon: m[0] };
}

function dateToMs(value: string, endOfDay = false): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t)) return undefined;
  return endOfDay ? t + DAY_MS - 1 : t;
}

function fromServer(res: GlobeResponse): Collection {
  const legs: Leg[] = [];
  const airports: AirportNode[] = [];
  for (const f of res.features) {
    if (f.properties.kind === "leg" && f.geometry.type === "MultiLineString") {
      const p = f.properties;
      legs.push({ id: p.legId, flightNumber: p.flightNumber, airline: p.airline, origin: p.origin, destination: p.destination, destinationCountry: p.destinationCountry, departure: p.departure, blockMs: p.blockMs, coordinates: f.geometry.coordinates, mid: midpointOf(f.geometry.coordinates) });
    } else if (f.properties.kind === "airport" && f.geometry.type === "Point") {
      const p = f.properties;
      airports.push({ iata: p.iata, name: p.name, city: p.city, country: p.country, visits: p.visits, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
  }
  return { legs, airports, countries: res.countries };
}

function fromGuest(history: readonly GuestFlightImport[], filters: Filters): Collection {
  const from = dateToMs(filters.from);
  const to = dateToMs(filters.to, true);
  const legs: Leg[] = [];
  const visits = new Map<string, AirportNode>();
  const countries = new Set<string>();
  const bump = (iata: string) => {
    const a = AIRPORTS_BY_IATA.get(iata);
    if (!a) return;
    const node = visits.get(iata) ?? { iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon, visits: 0 };
    node.visits += 1;
    visits.set(iata, node);
  };
  history.forEach((r, i) => {
    if (r.outcome !== "complete") return;
    if (filters.airline && r.airline !== filters.airline) return;
    if (filters.country && r.destinationCountry !== filters.country) return;
    if (from !== undefined && r.departure < from) return;
    if (to !== undefined && r.departure > to) return;
    const a = AIRPORTS_BY_IATA.get(r.origin);
    const b = AIRPORTS_BY_IATA.get(r.destination);
    if (!a || !b) return;
    const coordinates = splitAtAntimeridian(buildGreatCircleRoute(a, b, 48).points);
    legs.push({ id: `${r.snapshotId}-${i}`, flightNumber: r.airline, airline: r.airline, origin: r.origin, destination: r.destination, destinationCountry: r.destinationCountry, departure: r.departure, blockMs: r.blockMs, coordinates, mid: midpointOf(coordinates) });
    bump(r.origin);
    bump(r.destination);
    countries.add(r.destinationCountry);
  });
  return { legs, airports: [...visits.values()], countries: [...countries].sort() };
}

type Selection = { kind: "airport"; airport: AirportNode } | { kind: "leg"; leg: Leg } | null;

export default function Globe() {
  const session = useSession();
  const { mode, timeZone, guest } = session;
  const mapRef = useRef<CanvasMapHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Filters>({ airline: "", country: "", from: "", to: "" });
  const [airlines, setAirlines] = useState<AirlineView[]>([]);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [allCountries, setAllCountries] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Selection>(null);
  const [tick, setTick] = useState(0);

  const collectionRef = useRef<Collection | null>(null);
  collectionRef.current = collection;
  const hitsRef = useRef<{ airports: { i: number; x: number; y: number }[]; legs: { i: number; x: number; y: number }[] }>({ airports: [], legs: [] });

  useEffect(() => {
    let cancelled = false;
    apiExt
      .airlines()
      .then((r) => {
        if (!cancelled) setAirlines(r.airlines);
      })
      .catch(() => {
        /* airline filter stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (mode === "guest") {
      const history = guest.load().history;
      const all = fromGuest(history, { airline: "", country: "", from: "", to: "" });
      setAllCountries(all.countries);
      setCollection(fromGuest(history, filters));
      setTick((t) => t + 1);
      return;
    }
    setCollection(null);
    apiExt
      .globe({ airline: filters.airline || undefined, country: filters.country || undefined, from: dateToMs(filters.from), to: dateToMs(filters.to, true) })
      .then((res) => {
        if (cancelled) return;
        const c = fromServer(res);
        setCollection(c);
        // Keep the country list stable while a country filter is applied.
        setAllCountries((prev) => (filters.country ? (prev.length ? prev : res.countries) : res.countries));
        setTick((t) => t + 1);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [mode, guest, filters]);

  // Centre on the most visited airport when the collection first arrives.
  const centredRef = useRef(false);
  useEffect(() => {
    if (!collection || centredRef.current || collection.airports.length === 0) return;
    const top = [...collection.airports].sort((a, b) => b.visits - a.visits)[0];
    if (top) {
      mapRef.current?.centerOn(top);
      centredRef.current = true;
    }
  }, [collection]);

  const draw = useCallback((frame: MapFrame) => {
    const c = collectionRef.current;
    const hits = hitsRef.current;
    hits.airports.length = 0;
    hits.legs.length = 0;
    if (!c) return;
    const { theme } = frame;
    c.legs.forEach((leg, i) => {
      strokeLine(frame, leg.coordinates, { color: theme.geo, width: 1.5, alpha: 0.85 });
      const xy = frame.project(leg.mid);
      if (xy) hits.legs.push({ i, x: xy[0], y: xy[1] });
    });
    const labelAll = c.airports.length < 12 || frame.zoom >= 3;
    c.airports.forEach((a, i) => {
      const xy = frame.project(a);
      if (!xy) return;
      hits.airports.push({ i, x: xy[0], y: xy[1] });
      drawDot(frame, a, 2.5 + Math.min(5, Math.sqrt(a.visits) * 1.5), theme.accent, theme.water);
      if (labelAll || a.visits >= 2) drawLabel(frame, a, a.iata, theme.text, 9, -9, "700 12px var(--font)");
    });
  }, []);

  const onClick = useCallback((_p: LatLon | null, event: PointerEvent) => {
    const el = wrapRef.current;
    const c = collectionRef.current;
    if (!el || !c) return;
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hits = hitsRef.current;
    let bestAirport: { i: number; d: number } | null = null;
    for (const h of hits.airports) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= HIT_PX && (!bestAirport || d < bestAirport.d)) bestAirport = { i: h.i, d };
    }
    if (bestAirport) {
      const airport = c.airports[bestAirport.i];
      if (airport) setPick({ kind: "airport", airport });
      return;
    }
    let bestLeg: { i: number; d: number } | null = null;
    for (const h of hits.legs) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= HIT_PX + 2 && (!bestLeg || d < bestLeg.d)) bestLeg = { i: h.i, d };
    }
    if (bestLeg) {
      const leg = c.legs[bestLeg.i];
      if (leg) setPick({ kind: "leg", leg });
      return;
    }
    setPick(null);
  }, []);

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const legCount = collection?.legs.length ?? 0;
  const countryCount = collection?.countries.length ?? 0;
  const loading = collection === null && !error;
  const countryOptions = useMemo(() => [...new Set([...allCountries, ...(collection?.countries ?? [])])].sort(), [allCountries, collection]);

  return (
    <Page title="World globe" lead="Every leg you've landed, drawn on the globe.">
      <Section>
        <form className="globe-filters" onSubmit={(e) => e.preventDefault()}>
          <Field label="Airline">
            {(id) => (
              <Select id={id} value={filters.airline} onChange={(e) => update({ airline: e.target.value })}>
                <option value="">All airlines</option>
                {airlines.map((a) => (
                  <option key={a.iata} value={a.iata}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Country">
            {(id) => (
              <Select id={id} value={filters.country} onChange={(e) => update({ country: e.target.value })}>
                <option value="">All countries</option>
                {countryOptions.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From">{(id) => <Input id={id} type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <Input id={id} type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />}</Field>
          {(filters.airline || filters.country || filters.from || filters.to) && (
            <Button variant="quiet" size="sm" onClick={() => setFilters({ airline: "", country: "", from: "", to: "" })}>
              Clear filters
            </Button>
          )}
        </form>

        {error && <Notice tone="amber">{error}</Notice>}
        {loading && <Skeleton lines={2} />}

        <div className="globe-layout">
          <div className="globe-map" ref={wrapRef}>
            <CanvasMap ref={mapRef} mode="globe" draw={draw} tick={tick} onClick={onClick} ariaLabel="Globe of your landed legs" initialCenter={{ lat: 20, lon: 100 }} />
          </div>
          <div className="globe-side">
            <p className="globe-legend">
              <span className="numeral">
                {legCount} {legCount === 1 ? "leg" : "legs"}
              </span>
              <span className="globe-rule" aria-hidden="true" />
              <span className="numeral">
                {countryCount} {countryCount === 1 ? "country" : "countries"}
              </span>
            </p>
            {pick?.kind === "airport" && (
              <div className="globe-detail">
                <h3 className="code">{pick.airport.iata}</h3>
                <Facts
                  items={[
                    { label: "Airport", value: pick.airport.name },
                    { label: "City", value: pick.airport.city },
                    { label: "Country", value: countryName(pick.airport.country) },
                    { label: "Visits", value: <span className="numeral">{pick.airport.visits}</span> },
                  ]}
                />
              </div>
            )}
            {pick?.kind === "leg" && (
              <div className="globe-detail">
                <h3 className="code">
                  {pick.leg.origin} to {pick.leg.destination}
                </h3>
                <Facts
                  items={[
                    { label: mode === "guest" ? "Airline" : "Flight", value: <span className="code">{pick.leg.flightNumber}</span> },
                    { label: "Date", value: formatDate(pick.leg.departure, timeZone) },
                    { label: "Duration", value: <span className="numeral">{formatDuration(pick.leg.blockMs)}</span> },
                    { label: "Destination country", value: countryName(pick.leg.destinationCountry) },
                  ]}
                />
              </div>
            )}
            {!pick && collection && legCount > 0 && <p className="small muted">Click an airport or the middle of a leg for details.</p>}
            {collection && legCount === 0 && !error && <Empty title="No landings yet">Your first validated arrival will appear here.</Empty>}
            <p className="small muted">Arrow keys rotate, plus and minus zoom.</p>
          </div>
        </div>
      </Section>
    </Page>
  );
}
