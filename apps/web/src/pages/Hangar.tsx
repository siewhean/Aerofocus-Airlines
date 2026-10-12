/**
 * Fleet: a fact sheet per aircraft type, like an airline's fleet page (docs/UI-PLAN.md Phase 9,
 * item 3). Types are chosen from a plain list on desktop and a select on phones. Airline unlock
 * tiers live on the Membership page.
 */
import type { CabinClass } from "@aerofocus/core";
import { AIRCRAFT_TYPES, AIRLINES_BY_IATA, SAMPLE_PATTERNS, seatMapFor } from "@aerofocus/data";
import { useEffect, useId, useMemo, useState } from "react";
import { Page } from "../app/Shell";
import { AircraftSilhouette } from "../components/AircraftSilhouette";
import { SeatMap } from "../components/SeatMap";
import { cabinLabel } from "../lib/format";
import { Select } from "../ui";
import "./Hangar.css";

const FAMILY_LABELS: Record<string, string> = {
  regional: "Regional turboprop and regional jet",
  narrowbody: "Narrow-body",
  widebody_twin: "Wide-body, twin-engine",
  widebody_quad: "Wide-body, four-engine",
};

const CABIN_ORDER: CabinClass[] = ["first", "business", "premium_economy", "economy", "private"];

/** Airlines flying each type in the sample catalogue (packages/data/src/sample-schedule.ts). */
const FLOWN_BY: ReadonlyMap<string, string[]> = (() => {
  const by = new Map<string, Set<string>>();
  for (const p of SAMPLE_PATTERNS) {
    if (!p.aircraft) continue;
    const set = by.get(p.aircraft) ?? new Set<string>();
    set.add(p.airline);
    by.set(p.aircraft, set);
  }
  return new Map([...by].map(([code, iatas]) => [code, [...iatas].map((i) => AIRLINES_BY_IATA.get(i)?.name ?? i).sort((a, b) => a.localeCompare(b))]));
})();

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function Hangar() {
  const selectId = useId();
  const cabinId = useId();
  const [code, setCode] = useState(AIRCRAFT_TYPES[0]!.code);
  const [cabin, setCabin] = useState<CabinClass>("economy");

  const type = useMemo(() => AIRCRAFT_TYPES.find((t) => t.code === code) ?? AIRCRAFT_TYPES[0]!, [code]);
  const map = useMemo(() => seatMapFor(type.code, type.family), [type]);
  const cabins = useMemo(() => CABIN_ORDER.filter((c) => map.cabins[c]), [map]);

  useEffect(() => {
    if (!map.cabins[cabin]) setCabin(cabins.includes("economy") ? "economy" : cabins[0] ?? "economy");
  }, [map, cabin, cabins]);

  const family = FAMILY_LABELS[type.family] ?? type.family;
  const flownBy = FLOWN_BY.get(type.code) ?? [];
  const [wingFirst, wingLast] = map.wingRows;
  const cabinNames = cabins.map((c) => cabinLabel(c));
  const facts = `${family}. ${cabinNames.length > 1 ? `${list(cabinNames)} cabins` : `${cabinNames[0] ?? "Economy"} cabin only`}. The wing covers rows ${wingFirst} to ${wingLast}.`;

  return (
    <Page title="Fleet" lead="Every type in the fleet with a representative cabin plan. Seats are assigned at boarding.">
      <div className="fleet">
        <div className="fleet-pick">
          <label htmlFor={selectId} className="visually-hidden">
            Aircraft type
          </label>
          <Select id={selectId} value={code} onChange={(e) => setCode(e.target.value)}>
            {AIRCRAFT_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="fleet-list" role="group" aria-label="Aircraft types">
          {AIRCRAFT_TYPES.map((t) => {
            const active = t.code === code;
            return (
              <button key={t.code} type="button" className={`fleet-item ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => setCode(t.code)}>
                <span className="fleet-item-name">{t.name}</span>
                <span className="fleet-item-family small muted">{FAMILY_LABELS[t.family] ?? t.family}</span>
              </button>
            );
          })}
        </div>

        <article className="fleet-sheet" aria-labelledby="fleet-type">
          <header className="fleet-sheet-head">
            <h2 id="fleet-type" className="display fleet-type">
              {type.name}
            </h2>
            <p className="fleet-family muted">{family}</p>
          </header>
          <AircraftSilhouette family={type.family} className="fleet-silhouette" />
          <p className="fleet-facts">{facts}</p>

          <div className="fleet-cabin">
            <div className="fleet-cabin-head">
              <h3>Cabin plan</h3>
              <label className="fleet-cabin-pick" htmlFor={cabinId}>
                <span className="small muted">Cabin</span>
                <Select id={cabinId} value={cabin} onChange={(e) => setCabin(e.target.value as CabinClass)} className="fleet-cabin-select">
                  {cabins.map((c) => (
                    <option key={c} value={c}>
                      {cabinLabel(c)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <SeatMap map={map} cabin={cabin} />
          </div>

          <p className="fleet-flown">{flownBy.length > 0 ? `Flown by ${list(flownBy)} in the sample catalogue.` : "Not yet scheduled by an airline in the sample catalogue."}</p>
        </article>
      </div>
    </Page>
  );
}
