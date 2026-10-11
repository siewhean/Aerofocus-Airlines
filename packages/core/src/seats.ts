import type { DepartureMode } from "./booking";
import type { Rng } from "./random";
import type { AircraftFamily, CabinClass } from "./schedule";

export interface CabinLayout {
  rows: [number, number];
  /** Seat letters left to right; the first is the left window. */
  letters: string[];
  windowLetters: [string, string];
}

/**
 * generic: per aircraft family. representative: per aircraft type, typical layout, not tied to any
 * airline. verified: an airline's documented configuration (requires sourcing, FR-010).
 */
export type SeatMapSource = "generic" | "representative" | "verified";

export interface SeatMap {
  id: string;
  name: string;
  source: SeatMapSource;
  cabins: Partial<Record<CabinClass, CabinLayout>>;
  /** Rows from which the wing is visible. */
  wingRows: [number, number];
}

type GenericLayout = Omit<SeatMap, "id" | "name" | "source">;

/**
 * Generic seat layouts per aircraft family, used until aircraft-specific seat maps exist (FR-010).
 * They are presentation only and not claimed to match any airline's configuration.
 */
export const GENERIC_LAYOUTS: Readonly<Record<AircraftFamily, GenericLayout>> = {
  narrowbody: {
    cabins: {
      business: { rows: [1, 3], letters: ["A", "C", "D", "F"], windowLetters: ["A", "F"] },
      premium_economy: { rows: [4, 6], letters: ["A", "B", "C", "D", "E", "F"], windowLetters: ["A", "F"] },
      economy: { rows: [7, 32], letters: ["A", "B", "C", "D", "E", "F"], windowLetters: ["A", "F"] },
      first: { rows: [1, 2], letters: ["A", "F"], windowLetters: ["A", "F"] },
    },
    wingRows: [11, 17],
  },
  widebody_twin: {
    cabins: {
      first: { rows: [1, 2], letters: ["A", "D", "G", "K"], windowLetters: ["A", "K"] },
      business: { rows: [11, 19], letters: ["A", "D", "G", "K"], windowLetters: ["A", "K"] },
      premium_economy: { rows: [31, 35], letters: ["A", "C", "D", "E", "G", "H", "K"], windowLetters: ["A", "K"] },
      economy: { rows: [41, 70], letters: ["A", "B", "C", "D", "E", "F", "G", "H", "K"], windowLetters: ["A", "K"] },
    },
    wingRows: [44, 54],
  },
  widebody_quad: {
    cabins: {
      first: { rows: [1, 3], letters: ["A", "K"], windowLetters: ["A", "K"] },
      business: { rows: [11, 26], letters: ["A", "D", "F", "K"], windowLetters: ["A", "K"] },
      premium_economy: { rows: [31, 36], letters: ["A", "C", "D", "E", "F", "G", "H", "K"], windowLetters: ["A", "K"] },
      economy: { rows: [41, 88], letters: ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K"], windowLetters: ["A", "K"] },
    },
    wingRows: [50, 62],
  },
  regional: {
    cabins: {
      business: { rows: [1, 3], letters: ["A", "C", "D"], windowLetters: ["A", "D"] },
      economy: { rows: [4, 25], letters: ["A", "C", "D", "F"], windowLetters: ["A", "F"] },
    },
    wingRows: [8, 13],
  },
};

export interface SeatAssignment {
  seat: string;
  row: number;
  letter: string;
  isWindow: boolean;
  /** Whether the window view renders the wing. */
  wingView: boolean;
  /** How authentic the layout is; only "verified" may be presented as an airline's real cabin. */
  layout: SeatMapSource;
}

export function genericSeatMap(family: AircraftFamily): SeatMap {
  return { id: `generic-${family}`, name: `Generic ${family.replace("_", " ")}`, source: "generic", ...GENERIC_LAYOUTS[family] };
}

const randInt = (min: number, max: number, rng: Rng): number => min + Math.floor(rng() * (max - min + 1));

/**
 * Issues a seat automatically; users cannot choose (FR-010).
 * Individual flights: always a window seat with a wing view, in every cabin, even where the real
 * cabin has no wing-view window. Community Flights: anywhere in the booked cabin.
 */
export function assignSeat(mode: DepartureMode, map: AircraftFamily | SeatMap, cabin: CabinClass, rng: Rng): SeatAssignment {
  const layout = typeof map === "string" ? genericSeatMap(map) : map;
  const cabinLayout = layout.cabins[cabin] ?? layout.cabins.economy;
  if (!cabinLayout) throw new RangeError(`No layout for ${layout.id}`);
  const [firstRow, lastRow] = cabinLayout.rows;
  const [wingFirst, wingLast] = layout.wingRows;

  if (mode !== "community") {
    const overlapFirst = Math.max(firstRow, wingFirst);
    const overlapLast = Math.min(lastRow, wingLast);
    const row =
      overlapFirst <= overlapLast
        ? randInt(overlapFirst, overlapLast, rng)
        : lastRow < wingFirst
          ? lastRow // cabin is ahead of the wing: closest row to it
          : firstRow; // cabin is behind the wing
    const letter = cabinLayout.windowLetters[rng() < 0.5 ? 0 : 1];
    return { seat: `${row}${letter}`, row, letter, isWindow: true, wingView: true, layout: layout.source };
  }

  const row = randInt(firstRow, lastRow, rng);
  const letter = cabinLayout.letters[Math.floor(rng() * cabinLayout.letters.length)] ?? cabinLayout.windowLetters[0];
  const isWindow = cabinLayout.windowLetters.includes(letter);
  return {
    seat: `${row}${letter}`,
    row,
    letter,
    isWindow,
    wingView: isWindow && row >= wingFirst && row <= wingLast,
    layout: layout.source,
  };
}
