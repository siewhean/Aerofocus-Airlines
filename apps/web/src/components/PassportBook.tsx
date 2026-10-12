/**
 * The passport as a book: a closed cover, the data page spread (Phase 9 item 6), then spreads of
 * paper pages carrying the arrival stamps (FR-048). Stamps are ink impressions drawn by <Stamp>;
 * the pages are fixed paper, not UI chrome.
 */
import { useEffect, useMemo, useState } from "react";
import type { TravelMarkView } from "../lib/api-ext";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { guestNumber, memberNumber, PassportPage } from "./PassportPage";
import { Stamp } from "./Stamp";
import "./PassportBook.css";

interface Props {
  cover: string;
  marks: TravelMarkView[];
  timeZone: string;
  /** The holder, for the data page. Null name prints "Guest passenger". */
  holderName?: string | null;
  /** User id for members, the guest presence id for guests; the passport number is hashed from it. */
  holderId?: string;
  holderKind?: "member" | "guest";
  /** Earliest validated flight; the date of issue. Today when null. */
  firstFlightAt?: number | null;
}

const MARKS_PER_PAGE = 4;
/** Views before the stamp pages: the cover and the data page. */
const STAMP_VIEW = 2;

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

export function PassportBook({ cover, marks, timeZone, holderName = null, holderId = "", holderKind = "member", firstFlightAt = null }: Props) {
  const hex = coverHex(cover);
  const pale = luminance(hex) > 0.6;
  const spread = useSpreadSize();
  const number = holderKind === "guest" ? guestNumber(holderId) : memberNumber(holderId);
  const pages = useMemo(() => {
    const out: TravelMarkView[][] = [];
    for (let i = 0; i < marks.length; i += MARKS_PER_PAGE) out.push(marks.slice(i, i + MARKS_PER_PAGE));
    if (out.length === 0) out.push([]);
    return out;
  }, [marks]);
  // View 0 is the closed cover, view 1 the data page spread; view n shows stamp pages
  // (n-2)*spread .. (n-2)*spread+spread-1.
  const viewCount = STAMP_VIEW + Math.ceil(pages.length / spread);
  const [view, setView] = useState(0);
  useEffect(() => {
    setView((v) => Math.min(v, viewCount - 1));
  }, [viewCount]);

  const firstPage = (view - STAMP_VIEW) * spread;
  const visible = view < STAMP_VIEW ? [] : pages.slice(firstPage, firstPage + spread);
  const position = view === 0 ? "Cover" : view === 1 ? "Data page" : `Page ${firstPage + 1}${spread === 2 && visible.length === 2 ? `–${firstPage + 2}` : ""} of ${pages.length}`;

  return (
    <div className="pb">
      <div className="pb-stage">
        {view === 1 ? (
          <PassportPage cover={cover} name={holderName} number={number} issued={firstFlightAt} timeZone={timeZone} key="data" />
        ) : view === 0 ? (
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
              const side = spread === 1 ? "single" : i === 0 ? "left" : "right";
              return (
                <div key={pageNo} className={`pb-page pb-page-${side}`}>
                  <div className="pb-page-marks">
                    {page.length === 0 ? (
                      <p className="small pb-page-empty">No marks yet. Complete a flight to earn one.</p>
                    ) : (
                      page.map((m, slot) => (
                        <div key={m.id} className={`pb-slot pb-slot-${slot + 1}`}>
                          <Stamp mark={m} timeZone={timeZone} size={156} />
                        </div>
                      ))
                    )}
                  </div>
                  <span className="pb-page-no numeral">{pageNo}</span>
                </div>
              );
            })}
            {visible.length < spread && <div className="pb-page pb-page-right pb-page-blank" aria-hidden="true" />}
          </div>
        )}
      </div>
      <div className="pb-nav">
        <Button variant="secondary" size="sm" aria-label="Previous page" onClick={() => setView((v) => Math.max(0, v - 1))} disabled={view === 0} icon={<Icon name="back" />}>
          Previous
        </Button>
        <span className="small muted numeral" aria-live="polite">
          {position}
        </span>
        <Button variant="secondary" size="sm" aria-label="Next page" onClick={() => setView((v) => Math.min(viewCount - 1, v + 1))} disabled={view >= viewCount - 1} icon={<Icon name="forward" />}>
          Next
        </Button>
      </div>
      <p className="small muted">Virtual arrival records, not immigration stamps.</p>
    </div>
  );
}
