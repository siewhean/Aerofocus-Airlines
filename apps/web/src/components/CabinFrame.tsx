/**
 * The cabin wall around the window (docs/UI-PLAN.md Phase 8, item 6): wall panel, window reveal,
 * sill, seat-back edge with the tray-table latch, and the overhead reading light that the toggle
 * actually lights. Cabin brightness sets the wall's base luminance; the cabin class changes the
 * materials subtly. Everything is CSS; no images, no motion.
 */
import type { CabinClass } from "@aerofocus/core";
import type { CSSProperties, ReactNode } from "react";
import "./CabinFrame.css";

export interface CabinFrameProps {
  children: ReactNode;
  readingLight: boolean;
  /** 0..1, from the lighting preferences (FR-024). */
  cabinBrightness: number;
  cabin: CabinClass;
  side?: "left" | "right";
  className?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.7));

export function CabinFrame({ children, readingLight, cabinBrightness, cabin, side = "left", className }: CabinFrameProps) {
  const style = { "--cabin-brightness": clamp01(cabinBrightness) } as CSSProperties;
  const material = cabin === "business" || cabin === "first" || cabin === "private" ? "premium" : cabin === "premium_economy" ? "warm" : "plain";
  return (
    <div className={`cabin-frame cabin-${material} ${readingLight ? "is-lit" : ""} ${className ?? ""}`.trim()} data-side={side} style={style}>
      <div className="cabin-lamp" aria-hidden="true">
        <span className="cabin-lamp-ring" />
        <span className="cabin-lamp-lens" />
      </div>
      <div className="cabin-lamp-pool" aria-hidden="true" />
      <div className="cabin-reveal">{children}</div>
      <div className="cabin-sill" aria-hidden="true" />
      <div className="cabin-seatback" aria-hidden="true">
        <span className="cabin-latch" />
      </div>
    </div>
  );
}
