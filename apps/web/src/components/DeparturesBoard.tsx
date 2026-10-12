/**
 * The layover airport's departures board (docs/API.md LayoverResponse.departures): the next 12
 * hours from the schedule provider, with the passenger's own connection marked `yours`.
 * Styled like airport signage in the terminal theme (DeparturesBoard.css uses `--board`).
 */
import type { LayoverResponse } from "@aerofocus/client";
import { AIRLINES_BY_IATA } from "@aerofocus/data";
import { formatClock } from "../lib/format";
import { Badge, SampleBadge } from "../ui/Badge";
import { Board, Cell, Empty } from "../ui/Board";
import "./DeparturesBoard.css";

interface Props {
  departures: LayoverResponse["departures"];
  timeZone: string;
}

export function DeparturesBoard({ departures, timeZone }: Props) {
  if (departures.length === 0) {
    return <Empty title="No departures in the next 12 hours">The board updates as the schedule fills in.</Empty>;
  }
  const sample = departures.some((d) => d.dataSource === "sample");
  return (
    <div className="depboard">
      <Board caption="Departures from this airport in the next 12 hours">
        <thead>
          <tr>
            <Cell head>Time</Cell>
            <Cell head>Flight</Cell>
            <Cell head>Destination</Cell>
            <Cell head>Airline</Cell>
            <Cell head>Remarks</Cell>
          </tr>
        </thead>
        <tbody>
          {departures.map((d) => (
            <tr key={d.snapshotId} className={d.yours ? "is-yours" : undefined} aria-current={d.yours ? "true" : undefined}>
              <Cell className="numeral depboard-time">{formatClock(d.departure, timeZone)}</Cell>
              <Cell>
                <span className="code">{d.flightNumber}</span>
              </Cell>
              <Cell>
                <span className="depboard-dest">
                  <span>{d.destination.city}</span>
                  <span className="code depboard-dest-code">{d.destination.iata}</span>
                </span>
              </Cell>
              <Cell>{AIRLINES_BY_IATA.get(d.airline)?.name ?? d.airline}</Cell>
              <Cell>{d.yours ? <Badge tone="signal">Your connection</Badge> : <span className="depboard-remark">On time</span>}</Cell>
            </tr>
          ))}
        </tbody>
      </Board>
      {sample && (
        <p className="depboard-caption small muted">
          <SampleBadge dataSource="sample" />
          <span>Some of these times are illustrative, not a published airline schedule.</span>
        </p>
      )}
    </div>
  );
}
