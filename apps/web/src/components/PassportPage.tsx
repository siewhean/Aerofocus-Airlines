/**
 * The passport's data page (docs/UI-PLAN.md Phase 9 item 6): the first spread after the cover.
 * Left page: the emblem and the issuer. Right page: the holder's details in a passport layout, a
 * neutral portrait area and a decorative machine-readable zone. Paper colours are the object's
 * own; the cover colour tints the page border.
 */
import type { CSSProperties } from "react";
import { Icon } from "../ui/Icon";
import { hashString } from "./Barcode";
import { coverHex } from "./PassportBook";
import { stampDate } from "./Stamp";
import "./PassportPage.css";

interface Props {
  cover: string;
  name: string | null;
  number: string;
  /** First flight; today when the holder has not flown yet. */
  issued: number | null;
  timeZone: string;
}

/** "AF" + nine digits, stable for the user id. Two hashes so the number uses all nine places. */
export function memberNumber(userId: string): string {
  const a = hashString(`member:${userId}`) % 100_000;
  const b = hashString(`member-tail:${userId}`) % 10_000;
  return `AF${String(a * 10_000 + b).padStart(9, "0")}`;
}

/** "GUEST" + six digits from the device's guest presence id. */
export function guestNumber(presenceId: string): string {
  return `GUEST${String(hashString(`guest:${presenceId}`) % 1_000_000).padStart(6, "0")}`;
}

/** Surname and given names: the last word is the surname; a single word is all given names. */
export function splitName(name: string | null): { surname: string | null; given: string } {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { surname: null, given: "Guest passenger" };
  if (words.length === 1) return { surname: null, given: words[0]! };
  return { surname: words[words.length - 1]!, given: words.slice(0, -1).join(" ") };
}

const MRZ_WIDTH = 44;

/** Letters only, uppercased, every other character a filler. Accents are dropped, not translated. */
function mrzText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "<");
}

function mrzLine(s: string): string {
  return (s + "<".repeat(MRZ_WIDTH)).slice(0, MRZ_WIDTH);
}

/** "YYMMDD" of an instant in the holder's zone. */
function yymmdd(instant: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { year: "2-digit", month: "2-digit", day: "2-digit", timeZone }).formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("year")}${get("month")}${get("day")}`;
  } catch {
    const d = new Date(instant);
    return `${String(d.getUTCFullYear()).slice(-2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  }
}

export function PassportPage({ cover, name, number, issued, timeZone }: Props) {
  const hex = coverHex(cover);
  const { surname, given } = splitName(name);
  const issuedAt = issued ?? Date.now();
  const issueDate = stampDate(issuedAt, timeZone);

  const line1 = mrzLine(`V<AFA${surname ? mrzText(surname) : ""}<<${mrzText(given)}`);
  const line2 = mrzLine(`${mrzText(number).padEnd(9, "<")}<AFA${yymmdd(issuedAt, timeZone)}<V<<<<<<<<<<<<<<<<<<<<<<<<<<<<`);

  return (
    <div className="ppg" style={{ "--ppg-cover": hex } as CSSProperties}>
      <div className="ppg-page ppg-page-left">
        <div className="ppg-emblem">
          <span className="ppg-ring" aria-hidden="true">
            <Icon name="plane" size={22} />
          </span>
          <span className="ppg-issuer display">Aerofocus Airlines</span>
          <span className="ppg-kind">Virtual passport</span>
        </div>
        <p className="ppg-foot">A record of virtual journeys. Not an identity or travel document.</p>
      </div>

      <div className="ppg-page ppg-page-right">
        <div className="ppg-data">
          <div className="ppg-portrait">
            <svg className="ppg-portrait-svg" viewBox="0 0 96 96" role="img" aria-label="Portrait area: a neutral silhouette, no photo">
              <circle cx={48} cy={34} r={16} />
              <path d="M16 90c0-18 14-30 32-30s32 12 32 30z" />
            </svg>
            <span className="ppg-portrait-note">No photo</span>
          </div>
          <dl className="ppg-fields">
            <div className="ppg-field ppg-f-type">
              <dt>Type</dt>
              <dd>V</dd>
            </div>
            <div className="ppg-field ppg-f-code">
              <dt>Code</dt>
              <dd>AFA</dd>
            </div>
            <div className="ppg-field ppg-f-no">
              <dt>Passport no.</dt>
              <dd className="numeral">{number}</dd>
            </div>
            <div className="ppg-field ppg-f-wide">
              <dt>Surname</dt>
              <dd className="ppg-name">{surname ? surname.toUpperCase() : "—"}</dd>
            </div>
            <div className="ppg-field ppg-f-wide">
              <dt>Given names</dt>
              <dd className="ppg-name">{given.toUpperCase()}</dd>
            </div>
            <div className="ppg-field ppg-f-wide">
              <dt>Nationality</dt>
              <dd>Virtual passenger</dd>
            </div>
            <div className="ppg-field ppg-f-half">
              <dt>Date of issue</dt>
              <dd className="numeral">{issueDate}</dd>
            </div>
            <div className="ppg-field ppg-f-half">
              <dt>Authority</dt>
              <dd>Aerofocus Airlines</dd>
            </div>
          </dl>
        </div>

        <div className="ppg-mrz-wrap">
          <div className="ppg-mrz" aria-hidden="true">
            {[line1, line2].map((line, i) => (
              <span key={i} className="ppg-mrz-line">
                {Array.from(line).map((ch, j) => (
                  <span key={j} className="ppg-mrz-cell">
                    {ch}
                  </span>
                ))}
              </span>
            ))}
          </div>
          <span className="ppg-mrz-note">Decorative, not machine readable</span>
        </div>
      </div>
    </div>
  );
}
