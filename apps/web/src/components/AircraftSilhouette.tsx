/**
 * Side-profile silhouette per aircraft family (docs/UI-PLAN.md Phase 9, item 3). Simple SVG paths
 * drawn in currentColor; the nose points left. The shapes are generic for the family, not a
 * particular type, and the figure says so in its label.
 */
import type { ReactElement } from "react";

export type AircraftFamily = "regional" | "narrowbody" | "widebody_twin" | "widebody_quad";

const FAMILY_LABELS: Record<AircraftFamily, string> = {
  regional: "regional turboprop",
  narrowbody: "narrow-body jet",
  widebody_twin: "wide-body twin-engine jet",
  widebody_quad: "wide-body four-engine jet",
};

/*
 * viewBox 0 0 400 120. The nose is at the left, the tail cone rises to the tail at the right, the
 * near wing sweeps back and down toward the viewer with its engines hanging clear of its edge.
 */
const SHAPES: Record<AircraftFamily, ReactElement> = {
  regional: (
    <>
      {/* slim fuselage */}
      <path d="M30 61 C34 52 54 50 90 50 L296 50 C324 50 350 52 372 55 L372 58 C348 64 318 70 288 72 L90 72 C54 72 34 70 30 61 Z" />
      {/* T-tail: a tall fin with the stabilizer across its top */}
      <path d="M298 50 L330 10 L354 10 L368 50 Z" />
      <path d="M322 8 L380 4 L386 10 L330 15 Z" />
      {/* engine nacelle on the high wing, the propeller disc ahead of it, the belly fairing below */}
      <path d="M152 42 h48 c8 0 12 2 14 8 h-62 Z" />
      <path d="M148 30 a3 20 0 0 1 0 40 a3 20 0 0 1 0 -40 Z" />
      <path d="M150 72 h88 c6 0 8 2 8 4 c0 2 -2 3 -8 3 h-88 c-6 0 -8 -1 -8 -3 c0 -2 2 -4 8 -4 Z" />
      {/* cockpit glazing */}
      <path d="M52 56 L66 52 L80 52 L78 57 Z" fill="var(--bg, #fff)" opacity="0.9" />
    </>
  ),
  narrowbody: (
    <>
      <path d="M24 62 C28 50 52 44 92 44 L298 44 C330 44 358 48 384 53 L384 58 C350 64 310 73 270 76 L92 76 C52 76 28 72 24 62 Z" />
      {/* fin and stabilizer */}
      <path d="M300 44 L336 10 L360 10 L376 47 Z" />
      <path d="M326 62 L372 54 L386 54 L368 64 Z" />
      {/* near wing */}
      <path d="M140 72 L236 72 L300 100 L274 102 Z" />
      {/* engine under the wing on its pylon */}
      <path d="M172 76 L204 76 L206 84 L178 84 Z" />
      <path d="M156 82 h56 a7 7 0 0 1 0 14 h-56 a7 7 0 0 1 0 -14 Z" />
      <path d="M48 54 L64 48 L80 48 L78 55 Z" fill="var(--bg, #fff)" opacity="0.9" />
    </>
  ),
  widebody_twin: (
    <>
      <path d="M16 61 C20 46 44 38 90 38 L300 38 C336 38 362 47 388 54 L388 60 C354 68 316 78 272 84 L90 84 C44 84 20 76 16 61 Z" />
      <path d="M302 38 L340 2 L368 2 L384 42 Z" />
      <path d="M322 64 L376 54 L392 54 L370 66 Z" />
      <path d="M130 80 L240 80 L318 110 L284 112 Z" />
      <path d="M166 84 L204 84 L206 92 L172 92 Z" />
      <path d="M146 90 h66 a9 9 0 0 1 0 18 h-66 a9 9 0 0 1 0 -18 Z" />
      <path d="M40 52 L58 44 L76 44 L74 53 Z" fill="var(--bg, #fff)" opacity="0.9" />
    </>
  ),
  widebody_quad: (
    <>
      {/* fuselage with the upper deck forward of the wing */}
      <path d="M16 61 C20 46 42 38 86 38 C94 30 104 26 116 26 L178 26 C190 26 200 32 206 36 L300 36 C336 36 362 46 388 55 L388 60 C354 68 318 76 274 84 L90 84 C46 84 20 76 16 61 Z" />
      <path d="M302 36 L340 0 L368 0 L386 40 Z" />
      <path d="M322 64 L378 53 L394 53 L372 66 Z" />
      <path d="M124 80 L240 80 L322 112 L286 114 Z" />
      {/* two engines on the near wing: the outboard one sits lower and further back */}
      <path d="M160 84 L196 84 L198 92 L166 92 Z" />
      <path d="M144 90 h60 a8 8 0 0 1 0 16 h-60 a8 8 0 0 1 0 -16 Z" />
      <path d="M226 98 L256 98 L258 104 L232 104 Z" />
      <path d="M212 102 h52 a7 7 0 0 1 0 14 h-52 a7 7 0 0 1 0 -14 Z" />
      <path d="M40 52 L58 44 L76 44 L74 53 Z" fill="var(--bg, #fff)" opacity="0.9" />
    </>
  ),
};

export function AircraftSilhouette({ family, className }: { family: string; className?: string }) {
  const key: AircraftFamily = family in SHAPES ? (family as AircraftFamily) : "narrowbody";
  return (
    <svg className={className} viewBox="0 0 400 120" width="100%" role="img" aria-label={`Side profile of a ${FAMILY_LABELS[key]}, generic for the family`} fill="currentColor" style={{ display: "block" }}>
      {SHAPES[key]}
    </svg>
  );
}
