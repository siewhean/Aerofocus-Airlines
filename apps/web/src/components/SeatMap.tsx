/**
 * Representative cabin plan (FR-010). Only a "verified" map may be presented as an airline's real
 * cabin; everything else is captioned as representative or generic.
 */
import type { CabinClass, SeatMap as SeatMapData } from "@aerofocus/core";
import { cabinLabel } from "../lib/format";
import "./SeatMap.css";

interface Props {
  map: SeatMapData;
  cabin: CabinClass;
  highlight?: { row: number; letter: string } | null;
  compact?: boolean;
}

/** Aisle positions: one aisle between the middle letters up to 6-abreast, two at the thirds beyond. */
function aisleAfter(letterCount: number): Set<number> {
  if (letterCount <= 1) return new Set();
  if (letterCount <= 6) return new Set([Math.floor(letterCount / 2) - 1]);
  const third = Math.floor(letterCount / 3);
  return new Set([third - 1, letterCount - third - 1]);
}

function caption(source: SeatMapData["source"]): string | null {
  if (source === "generic") return "Generic layout for this aircraft family";
  if (source === "representative") return "Representative layout";
  return null;
}

export function SeatMap({ map, cabin, highlight = null, compact = false }: Props) {
  const layout = map.cabins[cabin];
  if (!layout) {
    return <p className="muted small">No {cabinLabel(cabin)} cabin in this layout.</p>;
  }
  const [firstRow, lastRow] = layout.rows;
  const [wingFirst, wingLast] = map.wingRows;
  const aisles = aisleAfter(layout.letters.length);
  const rows: number[] = [];
  for (let r = firstRow; r <= lastRow; r++) rows.push(r);
  const note = caption(map.source);

  return (
    <figure className={`seatmap ${compact ? "seatmap-compact" : ""}`}>
      <div className="seatmap-scroll" tabIndex={0} role="region" aria-label="Seat map, scrolls sideways">
        <div className="seatmap-grid" role="table" aria-label={`${map.name}, ${cabinLabel(cabin)} cabin`}>
          <div className="seatmap-row seatmap-head" role="row">
            <span className="seatmap-rownum" role="columnheader">
              <span className="visually-hidden">Row</span>
            </span>
            {layout.letters.map((letter, i) => (
              <span key={letter} className={`seatmap-letter ${aisles.has(i) ? "has-aisle" : ""}`} role="columnheader">
                {letter}
              </span>
            ))}
          </div>
          {rows.map((row) => {
            const wing = row >= wingFirst && row <= wingLast;
            return (
              <div key={row} className={`seatmap-row ${wing ? "is-wing" : ""}`} role="row">
                <span className="seatmap-rownum numeral" role="rowheader">
                  {row}
                </span>
                {layout.letters.map((letter, i) => {
                  const isWindow = layout.windowLetters.includes(letter);
                  const isYou = highlight !== null && highlight.row === row && highlight.letter === letter;
                  const cls = ["seat", isWindow ? "is-window" : "", isYou ? "is-you" : "", aisles.has(i) ? "has-aisle" : ""].join(" ").trim();
                  const label = `${row}${letter}${isWindow ? ", window" : ""}${wing ? ", wing row" : ""}${isYou ? ", your seat" : ""}`;
                  return (
                    <span key={letter} className={cls} role="cell" aria-label={label} title={label}>
                      <span aria-hidden="true">{compact ? "" : letter}</span>
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="seatmap-caption small muted">
        <span className="seatmap-legend">
          <span className="seatmap-key seatmap-key-window" aria-hidden="true" /> Window
        </span>
        <span className="seatmap-legend">
          <span className="seatmap-key seatmap-key-wing" aria-hidden="true" /> Wing rows {wingFirst}–{wingLast}
        </span>
        {highlight && (
          <span className="seatmap-legend">
            <span className="seatmap-key seatmap-key-you" aria-hidden="true" /> Your seat
          </span>
        )}
        {note && <span className="seatmap-note">{note}</span>}
      </figcaption>
    </figure>
  );
}
