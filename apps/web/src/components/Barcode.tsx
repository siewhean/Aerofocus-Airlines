/**
 * A decorative barcode drawn from a seed. The pattern is deterministic (same seed, same bars) so a
 * pass looks the same on every render, but it encodes nothing: it is printed texture, not data.
 */

/** FNV-1a 32-bit hash of a string; the shared seed for the pass, stamp and barcode patterns. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** xorshift32 bit stream seeded from the hash. Never yields a zero state. */
function bitStream(seed: number): () => boolean {
  let s = seed || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s & 1) === 1;
  };
}

interface Props {
  seed: string;
  kind?: "pdf417" | "qr";
  width?: number;
  height?: number;
  /** Visible caption under the pattern, 9px slate. */
  label?: string;
  className?: string;
}

/* PDF417 row framing, as printed: 17-module start pattern, 18-module stop pattern. */
const START = "11111111010101000";
const STOP = "111111101000101001";

function pdf417(seed: number, width: number, height: number) {
  const next = bitStream(seed);
  const cols = 112; // modules per row including framing
  const unit = width / cols;
  const rowH = Math.max(unit * 3, 3);
  const rows = Math.max(3, Math.floor(height / rowH));
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    let row = START;
    // Codewords: 4 bars and 4 spaces across 17 modules, like the real symbology, filled from the stream.
    while (row.length < cols - STOP.length) {
      let word = "";
      for (let k = 0; k < 4; k++) {
        const bar = 1 + (next() ? 1 : 0) + (next() ? 1 : 0);
        const space = 1 + (next() ? 1 : 0) + (next() ? 1 : 0);
        word += "1".repeat(bar) + "0".repeat(space);
      }
      row += word.slice(0, 17).padEnd(17, "0");
    }
    row = row.slice(0, cols - STOP.length) + STOP;
    let x = 0;
    while (x < row.length) {
      if (row[x] === "1") {
        let end = x;
        while (end < row.length && row[end] === "1") end++;
        rects.push({ x: x * unit, y, w: (end - x) * unit, h: rowH });
        x = end;
      } else {
        x++;
      }
    }
  }
  return { rects, drawnHeight: rows * rowH };
}

function qr(seed: number, size: number) {
  const next = bitStream(seed);
  const n = 25;
  const unit = size / n;
  const dark: boolean[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => false));
  const reserved: boolean[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => false));
  const finder = (ox: number, oy: number) => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const cx = ox + x;
        const cy = oy + y;
        if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
        reserved[cy]![cx] = true;
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        dark[cy]![cx] = ring === 3 || ring <= 1;
      }
    }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  for (let i = 8; i < n - 8; i++) {
    reserved[6]![i] = true;
    dark[6]![i] = i % 2 === 0;
    reserved[i]![6] = true;
    dark[i]![6] = i % 2 === 0;
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!reserved[y]![x]) dark[y]![x] = next();
    }
  }
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (dark[y]![x]) {
        let end = x;
        while (end < n && dark[y]![end]) end++;
        rects.push({ x: x * unit, y: y * unit, w: (end - x) * unit, h: unit });
        x = end;
      } else {
        x++;
      }
    }
  }
  return rects;
}

export function Barcode({ seed, kind = "pdf417", width, height, label, className }: Props) {
  const h = hashString(`${kind}:${seed}`);
  const w = width ?? (kind === "qr" ? 120 : 224);
  const ht = kind === "qr" ? w : (height ?? 64);
  const rects = kind === "qr" ? qr(h, w) : pdf417(h, w, ht).rects;
  return (
    <div className={`barcode ${className ?? ""}`} role="img" aria-label="Decorative barcode pattern. It is not a real barcode and does not encode anything.">
      <svg width={w} height={ht} viewBox={`0 0 ${w} ${ht}`} aria-hidden="true" shapeRendering="crispEdges" style={{ display: "block" }}>
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="#1b2230" />
        ))}
      </svg>
      {label && (
        <span className="barcode-label" aria-hidden="true">
          {label}
        </span>
      )}
    </div>
  );
}
