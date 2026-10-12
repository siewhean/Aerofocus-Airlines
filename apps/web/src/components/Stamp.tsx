/**
 * A passport stamp as an ink impression (FR-048). Inline SVG: a double-rule border whose shape and
 * ink colour follow the country, the airport code, a boxed date, "ARRIVAL" or "TRANSIT", a small
 * aircraft silhouette. Worn edges and uneven ink come from an feTurbulence displacement filter; a
 * faint offset copy underneath reads as bleed. Uppercase here is stamp content, not a UI label.
 */
import { useId } from "react";
import { countryName } from "../lib/format";
import { hashString } from "./Barcode";
import "./Stamp.css";

export interface StampMark {
  id: string;
  country: string;
  airport: string;
  /** "YYYY-MM-DD" (already in the passenger's calendar) or an epoch instant rendered in `timeZone`. */
  arrivalDate: string | number;
  isTransit?: boolean;
  visitNumber?: number | null;
  flightNumber?: string;
}

interface Props {
  mark: StampMark;
  timeZone: string;
  /** Rendered width in px; the impression keeps a 3:2 proportion. */
  size?: number;
  /** Adds the figure caption. Off by default: the passport page shows one caption for the spread. */
  caption?: boolean;
  className?: string;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "12 OCT 2026" in the stamp's own fixed form, independent of the viewer's locale. */
export function stampDate(value: string | number, timeZone: string): string {
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return value.toUpperCase();
    return `${m[3]} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  }
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "numeric", year: "numeric", timeZone }).formatToParts(value);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("day")} ${MONTHS[Number(get("month")) - 1] ?? get("month")} ${get("year")}`;
  } catch {
    const d = new Date(value);
    return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
}

type Shape = "rounded" | "oval" | "rect";
const INKS = ["#2b4a8b", "#9b2d2d", "#2f6b3f", "#2b2b2b"] as const;
const SHAPES: Shape[] = ["rounded", "oval", "rect"];

/** Everything that varies per stamp, all derived from the country and the mark id. */
export function stampStyle(country: string, id: string) {
  const c = hashString(`country:${country.toUpperCase()}`);
  const m = hashString(`mark:${id}`);
  return {
    shape: SHAPES[c % 3]!,
    ink: INKS[(c >>> 2) % 4]!,
    opacity: 0.82 + ((m % 131) / 130) * 0.13,
    rotation: ((m >>> 3) % 1601) / 100 - 8,
    displacement: 1.5 + (((m >>> 7) % 101) / 100) * 1,
    seed: m % 1000,
  };
}

/* The Icon set's aircraft, reused as a filled silhouette (24-unit grid). */
const PLANE = "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z";

const W = 240;
const H = 160;

export function Stamp({ mark, timeZone, size = 160, caption = false, className }: Props) {
  const rawId = useId();
  const uid = `st${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const { shape, ink, opacity, rotation, displacement, seed } = stampStyle(mark.country, mark.id);
  const name = countryName(mark.country).toUpperCase();
  const date = stampDate(mark.arrivalDate, timeZone);
  const kind = mark.isTransit ? "TRANSIT" : "ARRIVAL";
  const visit = mark.visitNumber && mark.visitNumber > 1 ? `VISIT ${mark.visitNumber}` : null;

  // Long country names shrink to stay inside the border; the oval has less room at the top.
  const maxWidth = shape === "oval" ? 150 : 192;
  const nameSize = Math.min(13, Math.max(7.5, maxWidth / (name.length * 0.72)));
  const nameY = shape === "oval" ? 40 : 33;
  const height = Math.round((size * H) / W);

  const label = `${countryName(mark.country)}, ${mark.airport}, ${date}, ${mark.isTransit ? "virtual transit record" : "virtual arrival record"}${visit ? `, visit ${mark.visitNumber}` : ""}. Not an immigration stamp.`;

  const border = (() => {
    switch (shape) {
      case "oval":
        return (
          <>
            <ellipse cx={W / 2} cy={H / 2} rx={116} ry={76} fill="none" stroke={ink} strokeWidth={2.4} />
            <ellipse cx={W / 2} cy={H / 2} rx={109} ry={69} fill="none" stroke={ink} strokeWidth={1} />
          </>
        );
      case "rect":
        return (
          <>
            <rect x={5} y={5} width={W - 10} height={H - 10} fill="none" stroke={ink} strokeWidth={4} />
            <rect x={13} y={13} width={W - 26} height={H - 26} fill="none" stroke={ink} strokeWidth={0.9} />
          </>
        );
      default:
        return (
          <>
            <rect x={4} y={4} width={W - 8} height={H - 8} rx={14} fill="none" stroke={ink} strokeWidth={2.4} />
            <rect x={10} y={10} width={W - 20} height={H - 20} rx={9} fill="none" stroke={ink} strokeWidth={1} />
          </>
        );
    }
  })();

  const impression = (
    <g fill={ink} fontFamily="var(--font)" textAnchor="middle">
      {border}
      <text x={W / 2} y={nameY} fontSize={nameSize} fontWeight={700} letterSpacing={1.8} style={{ fontStretch: "92%" }}>
        {name}
      </text>
      <text x={W / 2} y={88} fontSize={46} fontWeight={700} letterSpacing={2} style={{ fontStretch: "85%" }}>
        {mark.airport}
      </text>
      <text x={W / 2} y={105} fontSize={9.5} fontWeight={700} letterSpacing={3}>
        {kind}
      </text>
      <path d={PLANE} transform="translate(26 84) scale(0.95)" />
      {visit && (
        <text x={W - 30} y={99} fontSize={7.5} fontWeight={700} letterSpacing={1}>
          {visit}
        </text>
      )}
      <rect x={62} y={114} width={116} height={23} fill="none" stroke={ink} strokeWidth={1} />
      <line x1={62} y1={114} x2={178} y2={114} stroke={ink} strokeWidth={1.6} />
      <text x={W / 2} y={130} fontSize={12.5} fontWeight={600} letterSpacing={1.6} style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
        {date}
      </text>
    </g>
  );

  const svg = (
    <svg
      className={`stamp-svg ${className ?? ""}`}
      width={size}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      style={{ transform: `rotate(${rotation.toFixed(2)}deg)`, opacity }}
      overflow="visible"
    >
      <defs>
        <filter id={`${uid}-worn`} x="-6%" y="-8%" width="112%" height="116%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} result="edge" />
          <feDisplacementMap in="SourceGraphic" in2="edge" scale={displacement} xChannelSelector="R" yChannelSelector="G" result="worn" />
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves={3} seed={seed + 7} result="grain" />
          {/* Grain luminance becomes alpha between about 0.55 and 1, so the ink sits unevenly. */}
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.2 0 0 0 -0.25" result="inkMask" />
          <feComposite in="worn" in2="inkMask" operator="in" />
        </filter>
        <filter id={`${uid}-bleed`} x="-6%" y="-8%" width="112%" height="116%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>
      <g opacity={0.16} transform="translate(1.1 0.8)" filter={`url(#${uid}-bleed)`} aria-hidden="true">
        {impression}
      </g>
      <g filter={`url(#${uid}-worn)`}>{impression}</g>
    </svg>
  );

  if (!caption) return svg;
  return (
    <figure className="stamp-figure">
      {svg}
      <figcaption className="small muted">{mark.isTransit ? "Virtual transit record" : "Virtual arrival record"}, not an immigration stamp.</figcaption>
    </figure>
  );
}
