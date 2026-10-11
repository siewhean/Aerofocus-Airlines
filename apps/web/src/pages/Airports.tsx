/** Airport directory (FR-001): every supported airport with a search and a "Fly from here" action. */
import type { AirportView } from "@aerofocus/client";
import { useEffect, useMemo, useState } from "react";
import { Page } from "../app/Shell";
import { api, errorMessage } from "../lib/api";
import { countryName } from "../lib/format";
import { Board, Cell, Empty, Notice, Section, Skeleton } from "../ui/Board";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";
import "./Airports.css";

const REGION_LABELS: Record<string, string> = {
  asia: "Asia",
  oceania: "Oceania",
  europe: "Europe",
  north_america: "North America",
  south_america: "South America",
  africa: "Africa",
  middle_east: "Middle East",
};

function regionLabel(region: string): string {
  return REGION_LABELS[region] ?? region.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function Airports() {
  const [airports, setAirports] = useState<AirportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .airports()
      .then((r) => {
        if (!cancelled) setAirports([...r.airports].sort((a, b) => a.iata.localeCompare(b.iata)));
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!airports) return [];
    const q = query.trim().toLowerCase();
    if (!q) return airports;
    return airports.filter((a) => [a.iata, a.name, a.city, a.country, countryName(a.country)].some((v) => v.toLowerCase().includes(q)));
  }, [airports, query]);

  return (
    <Page title="Airport directory">
      <Section aside={airports ? <span className="numeral">{filtered.length === airports.length ? `${airports.length} airports` : `${filtered.length} of ${airports.length} airports`}</span> : undefined}>
        <div className="airports-search">
          <Field label="Search airports">{(id) => <Input id={id} type="search" value={query} placeholder="Code, name, city or country" onChange={(e) => setQuery(e.target.value)} autoComplete="off" />}</Field>
        </div>
        {error && <Notice tone="amber">{error}</Notice>}
        {!airports && !error && <Skeleton lines={6} />}
        {airports && filtered.length === 0 && <Empty title="No airports match">Try a code like SIN, or a city or country name.</Empty>}
        {airports && filtered.length > 0 && (
          <Board caption="Airport directory" className="board airports-board">
            <thead>
              <tr>
                <Cell head>Code</Cell>
                <Cell head>Airport</Cell>
                <Cell head>City</Cell>
                <Cell head>Country</Cell>
                <Cell head>Region</Cell>
                <Cell head>Time zone</Cell>
                <Cell head>
                  <span className="visually-hidden">Action</span>
                </Cell>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.iata}>
                  <Cell>
                    <span className="code">{a.iata}</span>
                  </Cell>
                  <Cell>{a.name}</Cell>
                  <Cell>{a.city}</Cell>
                  <Cell>{countryName(a.country)}</Cell>
                  <Cell>{regionLabel(a.region)}</Cell>
                  <Cell className="airports-tz">{a.timeZone}</Cell>
                  <Cell className="airports-action">
                    <Button size="sm" variant="secondary" to={`/fly/search?origin=${encodeURIComponent(a.iata)}`} aria-label={`Fly from ${a.name}`}>
                      Fly from here
                    </Button>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </Board>
        )}
      </Section>
    </Page>
  );
}
