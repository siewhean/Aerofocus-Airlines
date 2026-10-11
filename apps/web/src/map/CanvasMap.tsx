/**
 * Canvas world map / globe on d3-geo (docs/UI-PLAN.md Phase 4). Land from world-atlas land-110m
 * (lazy-loaded, ~100 KB), no tiles, no keys, works offline. Two projections: "flat" (Natural Earth)
 * and "globe" (orthographic with drag-to-rotate). Callers draw their own layers in `draw`.
 *
 * Only this file imports d3-geo / topojson; nothing in apps/web imports @aerofocus/geo.
 */
import type { LatLon } from "@aerofocus/core";
import { geoNaturalEarth1, geoOrthographic, geoPath, type GeoPath, type GeoPermissibleObjects, type GeoProjection } from "d3-geo";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import "./CanvasMap.css";

export type MapMode = "flat" | "globe";

export interface MapFrame {
  ctx: CanvasRenderingContext2D;
  projection: GeoProjection;
  path: GeoPath;
  width: number;
  height: number;
  /** Project a position to canvas pixels, or null when hidden (back of the globe). */
  project: (p: LatLon) => [number, number] | null;
  /** Visible longitude/latitude bounds for flat maps: [west, south, east, north]. */
  bbox: [number, number, number, number] | null;
  /** Approximate Web Mercator zoom level for clustering. */
  zoom: number;
  theme: { land: string; water: string; line: string; geo: string; text: string; accent: string };
}

export interface CanvasMapHandle {
  /** Request a redraw on the next frame. */
  invalidate: () => void;
  /** Convert a pointer event to a geographic position, or null outside the map. */
  invert: (clientX: number, clientY: number) => LatLon | null;
  /** Centre the map on a position (globe: rotate to it). */
  centerOn: (p: LatLon) => void;
  fitBounds: (bounds: [LatLon, LatLon], padding?: number) => void;
}

export interface CanvasMapProps {
  mode: MapMode;
  /** Draw overlay layers after land and graticule. Called on every frame. */
  draw: (frame: MapFrame) => void;
  /** Redraw trigger: change the value to request a frame (e.g. a clock tick). */
  tick?: unknown;
  interactive?: boolean;
  initialCenter?: LatLon;
  initialScale?: number;
  onClick?: (p: LatLon | null, event: PointerEvent) => void;
  onHover?: (p: LatLon | null, event: PointerEvent) => void;
  onViewChange?: (frame: { bbox: MapFrame["bbox"]; zoom: number }) => void;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel: string;
  ref?: Ref<CanvasMapHandle>;
}

type LandFeature = GeoJSON.Feature<GeoJSON.MultiPolygon | GeoJSON.Polygon>;
let landPromise: Promise<LandFeature> | null = null;
function loadLand(): Promise<LandFeature> {
  landPromise ??= Promise.all([import("topojson-client"), import("world-atlas/land-110m.json")]).then(([topo, atlas]) => {
    const topology = (atlas.default ?? atlas) as unknown as TopoJSON.Topology<{ land: TopoJSON.GeometryCollection }>;
    return topo.feature(topology, topology.objects.land) as unknown as LandFeature;
  });
  return landPromise;
}

const SPHERE = { type: "Sphere" } as unknown as GeoPermissibleObjects;

function readTheme(el: HTMLElement): MapFrame["theme"] {
  const cs = getComputedStyle(el);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    land: v("--map-land", "#d9d2c0"),
    water: v("--map-water", "#eef3f6"),
    line: v("--map-line", "#b9b2a1"),
    geo: v("--geo", "#3f7fb0"),
    text: v("--text", "#1b2230"),
    accent: v("--accent", "#0e1a2f"),
  };
}

export function CanvasMap({ mode, draw, tick, interactive = true, initialCenter, initialScale, onClick, onHover, onViewChange, children, className, style, ariaLabel, ref }: CanvasMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projRef = useRef<GeoProjection | null>(null);
  const landRef = useRef<LandFeature | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef(0);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const [, setLandLoaded] = useState(false);
  // View state, persisted across mode switches via refs so React re-renders do not reset it.
  const viewRef = useRef<{ k: number; rotate: [number, number]; center: [number, number] }>({
    k: initialScale ?? 1,
    rotate: [-(initialCenter?.lon ?? 0), -(initialCenter?.lat ?? 0)],
    center: [initialCenter?.lon ?? 0, initialCenter?.lat ?? 20],
  });

  const makeProjection = useCallback((): GeoProjection => {
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    if (mode === "globe") {
      const base = Math.min(w, h) / 2.15;
      return geoOrthographic()
        .scale(base * v.k)
        .translate([w / 2, h / 2])
        .rotate([v.rotate[0], v.rotate[1]])
        .clipAngle(90)
        .precision(0.5);
    }
    const p = geoNaturalEarth1().precision(0.5);
    p.fitSize([w, h], SPHERE);
    const fitScale = p.scale();
    p.scale(fitScale * v.k);
    // Pan: shift translate so `center` is at the middle.
    const c = p([v.center[0], v.center[1]]);
    const t = p.translate();
    if (c) p.translate([t[0] + (w / 2 - c[0]), t[1] + (h / 2 - c[1])]);
    return p;
  }, [mode]);

  const frameFor = useCallback(
    (ctx: CanvasRenderingContext2D, projection: GeoProjection): MapFrame => {
      const { w, h } = sizeRef.current;
      const path = geoPath(projection, ctx);
      const project = (p: LatLon): [number, number] | null => {
        if (mode === "globe") {
          // Hidden when more than 90° from the view centre.
          const r = projection.rotate();
          const lam = (-r[0] * Math.PI) / 180;
          const phi = (-r[1] * Math.PI) / 180;
          const lon = (p.lon * Math.PI) / 180;
          const lat = (p.lat * Math.PI) / 180;
          const cosc = Math.sin(phi) * Math.sin(lat) + Math.cos(phi) * Math.cos(lat) * Math.cos(lon - lam);
          if (cosc < 0) return null;
        }
        const xy = projection([p.lon, p.lat]);
        return xy ? [xy[0], xy[1]] : null;
      };
      let bbox: MapFrame["bbox"] = null;
      if (mode === "flat" && projection.invert) {
        // Sample the viewport edges; pixels outside the projected sphere invert to garbage, so each
        // sample must round-trip back to roughly the same pixel to count. Whole-world views that
        // leave the sphere fully inside the viewport fall back to the full extent.
        let west = Infinity;
        let east = -Infinity;
        let south = Infinity;
        let north = -Infinity;
        let valid = 0;
        const steps = 8;
        const samples: [number, number][] = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          samples.push([t * w, 0], [t * w, h], [0, t * h], [w, t * h]);
        }
        for (const px of samples) {
          const ll = projection.invert(px);
          if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1]) || Math.abs(ll[1]) > 90) continue;
          const back = projection(ll);
          if (!back || Math.hypot(back[0] - px[0], back[1] - px[1]) > 1) continue;
          valid++;
          west = Math.min(west, ll[0]);
          east = Math.max(east, ll[0]);
          south = Math.min(south, ll[1]);
          north = Math.max(north, ll[1]);
        }
        const sphereInside = (() => {
          const edge = projection([-180, 0]);
          const edge2 = projection([180, 0]);
          const top = projection([0, 90]);
          const bottom = projection([0, -90]);
          return Boolean(edge && edge2 && top && bottom && edge[0] >= 0 && edge2[0] <= w && top[1] >= 0 && bottom[1] <= h);
        })();
        if (sphereInside || valid < 4) bbox = [-180, -90, 180, 90];
        else bbox = [Math.max(-180, west), Math.max(-90, south), Math.min(180, east), Math.min(90, north)];
      }
      // Zoom estimate: world width in px at zoom z is 256 * 2^z.
      const worldPx = mode === "flat" ? projection.scale() * 2 * Math.PI * 0.86 : projection.scale() * 2 * Math.PI;
      const zoom = Math.max(0, Math.log2(worldPx / 256));
      return { ctx, projection, path, width: w, height: h, project, bbox, zoom, theme: readTheme(wrapRef.current ?? document.documentElement) };
    },
    [mode],
  );

  const render = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const projection = makeProjection();
    projRef.current = projection;
    const frame = frameFor(ctx, projection);
    const { theme, path } = frame;

    ctx.clearRect(0, 0, w, h);
    // Water
    ctx.beginPath();
    path(SPHERE);
    ctx.fillStyle = theme.water;
    ctx.fill();
    // Graticule-lite: equator and tropics as faint rules.
    ctx.strokeStyle = theme.line;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.6;
    for (const lat of [-66.5, -23.4, 0, 23.4, 66.5]) {
      ctx.beginPath();
      path({ type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } as unknown as GeoPermissibleObjects);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Land
    if (landRef.current) {
      ctx.beginPath();
      path(landRef.current as unknown as GeoPermissibleObjects);
      ctx.fillStyle = theme.land;
      ctx.fill();
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    // Sphere outline
    ctx.beginPath();
    path(SPHERE);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    drawRef.current(frame);
    onViewChange?.({ bbox: frame.bbox, zoom: frame.zoom });
  }, [frameFor, makeProjection, onViewChange]);

  const invalidate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  // Size tracking
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      sizeRef.current = { w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) };
      invalidate();
    });
    ro.observe(el);
    sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
    invalidate();
    return () => ro.disconnect();
  }, [invalidate]);

  // Land data
  useEffect(() => {
    let cancelled = false;
    loadLand().then((land) => {
      if (cancelled) return;
      landRef.current = land;
      setLandLoaded(true);
      invalidate();
    });
    return () => {
      cancelled = true;
    };
  }, [invalidate]);

  // External redraw triggers
  useEffect(() => {
    invalidate();
  }, [tick, mode, invalidate]);

  // Pointer interaction: drag pans (flat) or rotates (globe); wheel zooms; click reports a position.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !interactive) return;
    let dragging = false;
    let moved = false;
    let last: [number, number] = [0, 0];
    let pinch: number | null = null;
    const pointers = new Map<number, [number, number]>();

    const invertAt = (x: number, y: number): LatLon | null => {
      const p = projRef.current;
      const rect = el.getBoundingClientRect();
      const px = x - rect.left;
      const py = y - rect.top;
      if (!p?.invert) return null;
      const ll = p.invert([px, py]);
      if (!ll || Number.isNaN(ll[0])) return null;
      if (mode === "globe") {
        // Reject points on the back hemisphere.
        const r = p.rotate();
        const lam = (-r[0] * Math.PI) / 180;
        const phi = (-r[1] * Math.PI) / 180;
        const lon = (ll[0] * Math.PI) / 180;
        const lat = (ll[1] * Math.PI) / 180;
        const cosc = Math.sin(phi) * Math.sin(lat) + Math.cos(phi) * Math.cos(lat) * Math.cos(lon - lam);
        if (cosc < 0) return null;
      }
      return { lat: ll[1], lon: ll[0] };
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 1) {
        dragging = true;
        moved = false;
        last = [e.clientX, e.clientY];
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a![0] - b![0], a![1] - b![1]);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a![0] - b![0], a![1] - b![1]);
        zoomBy(d / pinch);
        pinch = d;
        return;
      }
      if (!dragging) {
        onHover?.(invertAt(e.clientX, e.clientY), e);
        return;
      }
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      last = [e.clientX, e.clientY];
      const v = viewRef.current;
      const p = projRef.current;
      if (!p) return;
      if (mode === "globe") {
        const sens = 75 / p.scale();
        v.rotate = [v.rotate[0] + dx * sens, Math.max(-90, Math.min(90, v.rotate[1] - dy * sens))];
      } else {
        const sens = 1 / (p.scale() * (Math.PI / 180)) ;
        v.center = [clampLon(v.center[0] - dx * sens), Math.max(-85, Math.min(85, v.center[1] + dy * sens))];
      }
      invalidate();
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!dragging) return;
      dragging = false;
      if (!moved) onClick?.(invertAt(e.clientX, e.clientY), e);
    };
    const zoomBy = (factor: number) => {
      const v = viewRef.current;
      v.k = Math.max(0.8, Math.min(40, v.k * factor));
      invalidate();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    const onLeave = () => onHover?.(null, new PointerEvent("pointerleave"));
    const onKey = (e: KeyboardEvent) => {
      const v = viewRef.current;
      const step = mode === "globe" ? 8 : 10 / v.k;
      if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
      else if (e.key === "ArrowLeft") (mode === "globe" ? (v.rotate[0] += step) : (v.center[0] = clampLon(v.center[0] - step)), invalidate());
      else if (e.key === "ArrowRight") (mode === "globe" ? (v.rotate[0] -= step) : (v.center[0] = clampLon(v.center[0] + step)), invalidate());
      else if (e.key === "ArrowUp") (mode === "globe" ? (v.rotate[1] += step) : (v.center[1] = Math.min(85, v.center[1] + step)), invalidate());
      else if (e.key === "ArrowDown") (mode === "globe" ? (v.rotate[1] -= step) : (v.center[1] = Math.max(-85, v.center[1] - step)), invalidate());
      else return;
      e.preventDefault();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
    };
  }, [interactive, mode, invalidate, onClick, onHover]);

  useImperativeHandle(
    ref,
    () => ({
      invalidate,
      invert: (x, y) => {
        const p = projRef.current;
        const el = wrapRef.current;
        if (!p?.invert || !el) return null;
        const r = el.getBoundingClientRect();
        const ll = p.invert([x - r.left, y - r.top]);
        return ll && !Number.isNaN(ll[0]) ? { lat: ll[1], lon: ll[0] } : null;
      },
      centerOn: (p) => {
        const v = viewRef.current;
        v.rotate = [-p.lon, -p.lat];
        v.center = [p.lon, p.lat];
        invalidate();
      },
      fitBounds: ([a, b], padding = 0.25) => {
        const v = viewRef.current;
        // Take the short way round the date line: a SYD–LAX pair is 110° apart across the Pacific,
        // not 250° the other way, so the midpoint and span are computed on the unwrapped difference.
        let dLon = b.lon - a.lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const midLon = clampLon(a.lon + dLon / 2);
        const midLat = (a.lat + b.lat) / 2;
        const span = Math.max(Math.abs(dLon), Math.abs(a.lat - b.lat) * 1.6, 8);
        v.center = [midLon, midLat];
        v.rotate = [-midLon, -midLat];
        v.k = Math.max(0.9, Math.min(12, (180 / span) * (1 - padding)));
        invalidate();
      },
    }),
    [invalidate],
  );

  return (
    <div ref={wrapRef} className={`canvas-map ${className ?? ""}`} style={style} tabIndex={interactive ? 0 : -1} role="application" aria-label={ariaLabel}>
      <canvas ref={canvasRef} />
      {children}
    </div>
  );
}

function clampLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Draw a GeoJSON MultiLineString in the current frame. */
export function strokeLine(frame: MapFrame, coordinates: number[][][], style: { color: string; width: number; dash?: number[]; alpha?: number }) {
  const { ctx, path } = frame;
  ctx.save();
  ctx.beginPath();
  path({ type: "MultiLineString", coordinates } as unknown as GeoPermissibleObjects);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (style.dash) ctx.setLineDash(style.dash);
  if (style.alpha !== undefined) ctx.globalAlpha = style.alpha;
  ctx.stroke();
  ctx.restore();
}

/** Draw a small aircraft glyph at a projected point, pointing along `headingDeg`. */
export function drawPlane(frame: MapFrame, p: LatLon, headingDeg: number, color: string, size = 9) {
  const xy = frame.project(p);
  if (!xy) return;
  const { ctx } = frame;
  ctx.save();
  ctx.translate(xy[0], xy[1]);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.55, size * 0.55);
  ctx.lineTo(0, size * 0.2);
  ctx.lineTo(-size * 0.55, size * 0.55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export function drawDot(frame: MapFrame, p: LatLon, radius: number, fill: string, stroke?: string) {
  const xy = frame.project(p);
  if (!xy) return;
  const { ctx } = frame;
  ctx.beginPath();
  ctx.arc(xy[0], xy[1], radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export function drawLabel(frame: MapFrame, p: LatLon, text: string, color: string, dx = 8, dy = -8, font = "600 12px var(--font)") {
  const xy = frame.project(p);
  if (!xy) return;
  const { ctx } = frame;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, xy[0] + dx, xy[1] + dy);
  ctx.restore();
}
