/**
 * The passport as a book: a closed cover, then page spreads of virtual arrival records (FR-048).
 * Marks are deliberately not styled as immigration endorsements: a plain dashed ring, the IATA
 * code, the country name and the date.
 */
import { useEffect, useMemo, useState } from "react";
import type { TravelMarkView } from "../lib/api-ext";
import { countryName, formatDate } from "../lib/format";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import "./PassportBook.css";

interface Props {
  cover: string;
  marks: TravelMarkView[];
  timeZone: string;
}

const MARKS_PER_PAGE = 4;

const COVER_HEX: Record<string, string> = {
  navy: "#1f2b4d",
  burgundy: "#5e2231",
  forest_green: "#1e4634",
  black: "#141414",
  brown: "#4a3421",
  white: "#f2efe8",
};

export function coverHex(cover: string): string {
  if (cover.startsWith("custom:#")) {
    const hex = cover.slice("custom:".length);
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : COVER_HEX.navy!;
  }
  return COVER_HEX[cover] ?? COVER_HEX.navy!;
}

/** Perceived luminance of a #rrggbb hex, 0–1. Picks dark text on a pale cover. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Deterministic ±6° tilt per mark so the page looks hand-placed without changing between renders. */
function tilt(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1201) / 100 - 6;
}

/** "YYYY-MM-DD" from the server, rendered as a short date; anything else is shown as given. */
function markDate(value: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const instant = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  void timeZone; // the date is already in the user's local calendar (FR-049); render it as UTC noon
  return formatDate(instant, "UTC");
}

export function Mark({ mark, timeZone }: { mark: TravelMarkView; timeZone: string }) {
  const angle = tilt(mark.id);
  return (
    <div className="pb-mark" style={{ transform: `rotate(${angle}deg)` }} role="img" aria-label={`${countryName(mark.country)}, ${mark.airport}, ${markDate(mark.arrivalDate, timeZone)}, virtual arrival record`}>
      <span className="pb-mark-code code">{mark.airport}</span>
      <span className="pb-mark-country">{countryName(mark.country)}</span>
      <span className="pb-mark-date numeral small">{markDate(mark.arrivalDate, timeZone)}</span>
      <span className="pb-mark-virtual">virtual</span>
    </div>
  );
}

function useSpreadSize(): number {
  const [single, setSingle] = useState(() => (typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false));
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setSingle(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return single ? 1 : 2;
}

export function PassportBook({ cover, marks, timeZone }: Props) {
  const hex = coverHex(cover);
  const pale = luminance(hex) > 0.6;
  const spread = useSpreadSize();
  const pages = useMemo(() => {
    const out: TravelMarkView[][] = [];
    for (let i = 0; i < marks.length; i += MARKS_PER_PAGE) out.push(marks.slice(i, i + MARKS_PER_PAGE));
    if (out.length === 0) out.push([]);
    return out;
  }, [marks]);
  // View 0 is the closed cover; view n shows pages (n-1)*spread .. (n-1)*spread+spread-1.
  const viewCount = 1 + Math.ceil(pages.length / spread);
  const [view, setView] = useState(0);
  useEffect(() => {
    setView((v) => Math.min(v, viewCount - 1));
  }, [viewCount]);

  const firstPage = (view - 1) * spread;
  const visible = view === 0 ? [] : pages.slice(firstPage, firstPage + spread);

  return (
    <div className="pb">
      <div className="pb-stage">
        {view === 0 ? (
          <div className={`pb-cover ${pale ? "is-pale" : ""}`} style={{ background: hex }} key="cover">
            <span className="pb-cover-ring" aria-hidden="true">
              <Icon name="plane" size={28} />
            </span>
            <span className="pb-cover-title display">Aerofocus Airlines</span>
            <span className="pb-cover-sub">Virtual passport</span>
            <span className="pb-cover-count numeral small">
              {marks.length} {marks.length === 1 ? "mark" : "marks"}
            </span>
          </div>
        ) : (
          <div className="pb-spread" key={`spread-${view}`}>
            {visible.map((page, i) => {
              const pageNo = firstPage + i + 1;
              return (
                <div key={pageNo} className="pb-page">
                  <div className="pb-page-marks">
                    {page.length === 0 ? (
                      <p className="muted small pb-page-empty">No marks yet. Complete a flight to earn one.</p>
                    ) : (
                      page.map((m) => <Mark key={m.id} mark={m} timeZone={timeZone} />)
                    )}
                  </div>
                  <span className="pb-page-no numeral small muted">{pageNo}</span>
                </div>
              );
            })}
            {visible.length < spread && <div className="pb-page pb-page-blank" aria-hidden="true" />}
          </div>
        )}
      </div>
      <div className="pb-nav">
        <Button variant="secondary" size="sm" aria-label="Previous page" onClick={() => setView((v) => Math.max(0, v - 1))} disabled={view === 0} icon={<Icon name="back" />}>
          Previous
        </Button>
        <span className="small muted numeral" aria-live="polite">
          {view === 0 ? "Cover" : `Page ${firstPage + 1}${spread === 2 && visible.length === 2 ? `–${firstPage + 2}` : ""} of ${pages.length}`}
        </span>
        <Button variant="secondary" size="sm" aria-label="Next page" onClick={() => setView((v) => Math.min(viewCount - 1, v + 1))} disabled={view >= viewCount - 1} icon={<Icon name="forward" />}>
          Next
        </Button>
      </div>
      <p className="small muted">Virtual arrival records, not immigration stamps.</p>
    </div>
  );
}
