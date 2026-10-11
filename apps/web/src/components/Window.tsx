/**
 * The aircraft window: the one bold element of the Air atmosphere (docs/UI-PLAN.md, design plan).
 * Sky is driven by WindowLighting from packages/core/src/lighting.ts:13-31 (sun elevation, side,
 * brightness) and cloud cover from the scenery endpoint. Everything is simulated (FR-022/FR-023).
 */
import type { FlightPhase, WindowLighting } from "@aerofocus/core";
import { useMemo, type CSSProperties } from "react";
import "./Window.css";

export interface WindowProps {
  lighting: WindowLighting | null;
  phase: FlightPhase | null;
  altitudeFt: number;
  clouds?: { coverage: number; layer: "clear" | "scattered" | "broken" | "overcast" } | null;
  surface?: "ocean" | "land" | "coast" | null;
  /** Personal cabin lighting (FR-024). Separate from the sun. */
  readingLight?: boolean;
  cabinBrightness?: number; // 0..1
  reducedEffects?: boolean;
  /** Fill the viewport (full-screen window mode). */
  size?: "panel" | "full" | "mini";
  placeLabel?: string | null;
  className?: string;
}

interface SkyStops {
  top: string;
  mid: string;
  horizon: string;
  ground: string;
  glow: number; // 0..1 sun glow strength
  stars: number; // 0..1
}

/** Maps sun elevation to a sky palette. Values interpolate between night, twilight, golden hour and day. */
export function skyFor(elevationDeg: number, surface: WindowProps["surface"]): SkyStops {
  const t = clamp((elevationDeg + 12) / 22, 0, 1); // 0 deep night … 1 full day
  const g = clamp(1 - Math.abs(elevationDeg - 2) / 10, 0, 1); // golden band around the horizon
  const night = { top: [6, 10, 24], mid: [12, 22, 46], horizon: [28, 40, 70], ground: [8, 12, 22] };
  const day = { top: [58, 120, 190], mid: [128, 184, 228], horizon: [214, 232, 244], ground: surface === "ocean" ? [40, 88, 130] : [96, 110, 86] };
  const gold = { top: [70, 70, 120], mid: [196, 120, 96], horizon: [242, 188, 110], ground: [50, 44, 60] };
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + ((b[i] ?? 0) - v) * k);
  const blend = (key: keyof typeof night) => {
    const base = mix(night[key], day[key], t);
    return mix(base, gold[key], g * 0.75);
  };
  const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v)).join(" ")})`;
  return {
    top: rgb(blend("top")),
    mid: rgb(blend("mid")),
    horizon: rgb(blend("horizon")),
    ground: rgb(blend("ground")),
    glow: g,
    stars: clamp(1 - t * 2.5, 0, 1),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Window({
  lighting,
  phase,
  altitudeFt,
  clouds,
  surface,
  readingLight = false,
  cabinBrightness = 0.7,
  reducedEffects = false,
  size = "panel",
  placeLabel,
  className,
}: WindowProps) {
  const elevation = lighting?.sunElevationDeg ?? 20;
  const sky = useMemo(() => skyFor(elevation, surface ?? null), [elevation, surface]);
  const onGround = !phase || phase === "taxi_out" || phase === "taxi_in" || phase === "takeoff" || phase === "landing";
  const altitudeK = clamp(altitudeFt / 40_000, 0, 1);
  // The horizon sits lower as the aircraft climbs; the ground band fades at cruise.
  const horizonY = 58 + altitudeK * 18;
  const cloudOpacity = clouds ? clamp(clouds.coverage, 0, 1) * (reducedEffects ? 0.6 : 1) : 0;
  const sunX = lighting ? 50 + clamp(lighting.sunRelativeBearingDeg / 90, -1, 1) * 40 : 50;
  const sunY = clamp(horizonY - elevation * 1.6, 8, horizonY);
  const tilt = phase === "climb" ? -4 : phase === "descent" || phase === "approach" ? 3 : 0;

  const style = {
    "--sky-top": sky.top,
    "--sky-mid": sky.mid,
    "--sky-horizon": sky.horizon,
    "--sky-ground": sky.ground,
    "--horizon-y": `${horizonY}%`,
    "--sun-x": `${sunX}%`,
    "--sun-y": `${sunY}%`,
    "--sun-glow": sky.glow,
    "--stars": sky.stars,
    "--cloud-opacity": cloudOpacity,
    "--cabin-brightness": cabinBrightness,
    "--ext-brightness": lighting?.exteriorBrightness ?? 1,
    "--tilt": `${tilt}deg`,
  } as CSSProperties;

  return (
    <figure className={`window window-${size} ${readingLight ? "has-reading-light" : ""} ${reducedEffects ? "is-reduced" : ""} ${className ?? ""}`} style={style}>
      <div className="window-frame">
        <div className="window-glass" role="img" aria-label={describeView(lighting, phase, placeLabel ?? null, clouds ?? null)}>
          <div className="sky" />
          <div className="stars" />
          <div className="sun" />
          <div className={`ground ${onGround ? "is-near" : ""}`} />
          <div className="cloud-layer cloud-far" />
          <div className="cloud-layer cloud-near" />
          {onGround && <div className="runway" />}
          <svg className="wing" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 118 L0 72 Q120 48 400 44 L400 60 Q200 70 0 118 Z" />
            <path className="engine" d="M150 70 q10 -8 50 -6 q-2 14 -48 16 z" />
            <path className="winglet" d="M382 44 l10 -22 l8 2 l-6 22 z" />
          </svg>
          <div className="reflection" />
        </div>
      </div>
      <figcaption className="window-caption">
        <span>Simulated view</span>
        {placeLabel && <span>{placeLabel}</span>}
      </figcaption>
    </figure>
  );
}

function describeView(lighting: WindowLighting | null, phase: FlightPhase | null, place: string | null, clouds: WindowProps["clouds"]): string {
  const sky = !lighting ? "sky" : lighting.condition === "night" ? "night sky" : lighting.condition === "twilight" ? "twilight sky" : lighting.condition === "golden_hour" ? "golden-hour sky" : "daytime sky";
  const cloud = clouds ? (clouds.layer === "clear" ? "clear" : `${clouds.layer} cloud`) : "";
  const where = phase === null || phase === "taxi_out" || phase === "taxi_in" ? "at the airport" : place ? place.toLowerCase() : "in flight";
  return `Simulated window view: ${sky}${cloud ? `, ${cloud}` : ""}, ${where}.`;
}
