import type { CabinClass } from "@aerofocus/core";
import { AIRCRAFT_TYPES, seatMapFor } from "@aerofocus/data";
import { useEffect, useMemo, useState } from "react";
import { Page } from "../app/Shell";
import { SeatMap } from "../components/SeatMap";
import { errorMessage } from "../lib/api";
import { apiExt, type AirlineView } from "../lib/api-ext";
import { cabinLabel } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Board, Cell, Field, Notice, Section, Select, Skeleton } from "../ui";
import "./Hangar.css";

const FAMILY_LABELS: Record<string, string> = {
  regional: "Regional",
  narrowbody: "Narrow-body",
  widebody_twin: "Wide-body, twin",
  widebody_quad: "Wide-body, four engines",
};

const CABIN_ORDER: CabinClass[] = ["first", "business", "premium_economy", "economy", "private"];

export default function Hangar() {
  const session = useSession();
  const [code, setCode] = useState(AIRCRAFT_TYPES[0]!.code);
  const [cabin, setCabin] = useState<CabinClass>("economy");
  const [airlines, setAirlines] = useState<AirlineView[] | null>(null);
  const [airlineTier, setAirlineTier] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const type = useMemo(() => AIRCRAFT_TYPES.find((t) => t.code === code) ?? AIRCRAFT_TYPES[0]!, [code]);
  const map = useMemo(() => seatMapFor(type.code, type.family), [type]);
  const cabins = useMemo(() => CABIN_ORDER.filter((c) => map.cabins[c]), [map]);

  useEffect(() => {
    if (!map.cabins[cabin]) setCabin(cabins.includes("economy") ? "economy" : cabins[0] ?? "economy");
  }, [map, cabin, cabins]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      const [list, tier] = await Promise.all([
        apiExt.airlines(),
        session.mode === "user" ? apiExt.progression().then((p) => p.unlocks.airlineTier) : Promise.resolve(session.guest.unlocks().airlineTier),
      ]);
      return { list: [...list.airlines].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)), tier };
    })()
      .then((r) => {
        if (cancelled) return;
        setAirlines(r.list);
        setAirlineTier(r.tier);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [session.mode, session.guest, session.guestState]);

  return (
    <Page title="Aircraft hangar" lead="Every type in the fleet, with a representative cabin plan. Seats are assigned at boarding.">
      <div className="hangar">
        <div className="hangar-list" role="group" aria-label="Aircraft types">
          {AIRCRAFT_TYPES.map((t) => {
            const active = t.code === code;
            return (
              <button key={t.code} type="button" className={`hangar-item ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => setCode(t.code)}>
                <span className="code hangar-code">{t.code}</span>
                <span className="hangar-name">{t.name}</span>
                <span className="small muted">{FAMILY_LABELS[t.family] ?? t.family}</span>
              </button>
            );
          })}
        </div>
        <div className="hangar-detail">
          <div className="hangar-detail-head">
            <h2>{type.name}</h2>
            <Field label="Cabin" inline>
              {(id) => (
                <Select id={id} value={cabin} onChange={(e) => setCabin(e.target.value as CabinClass)} className="hangar-cabin">
                  {cabins.map((c) => (
                    <option key={c} value={c}>
                      {cabinLabel(c)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <SeatMap map={map} cabin={cabin} />
        </div>
      </div>

      <Section title="Airlines by unlock tier" aside={airlineTier !== null ? `You have unlocked up to group ${airlineTier}` : undefined}>
        {error && <Notice tone="danger">{error}</Notice>}
        {!airlines && !error && <Skeleton lines={4} />}
        {airlines && (
          <Board caption="Airlines by unlock tier">
            <thead>
              <tr>
                <Cell head num>
                  Tier
                </Cell>
                <Cell head>Airline</Cell>
                <Cell head>Type</Cell>
                <Cell head>Status</Cell>
              </tr>
            </thead>
            <tbody>
              {airlines.map((a) => {
                const unlocked = airlineTier !== null && a.tier <= airlineTier;
                return (
                  <tr key={a.iata} className={unlocked ? "" : "is-locked"}>
                    <Cell num>{a.tier}</Cell>
                    <Cell>
                      <span className="hangar-airline">
                        <span className="code">{a.iata}</span> {a.name}
                      </span>
                    </Cell>
                    <Cell>{a.type === "budget" ? "Budget" : "Full service"}</Cell>
                    <Cell>{unlocked ? <Badge tone="signal">Unlocked</Badge> : <Badge tone="premium" icon="lock">{`Locked at tier ${a.tier}`}</Badge>}</Cell>
                  </tr>
                );
              })}
            </tbody>
          </Board>
        )}
      </Section>
    </Page>
  );
}
