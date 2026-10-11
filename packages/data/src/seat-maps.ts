import { genericSeatMap, type AircraftFamily, type CabinLayout, type SeatMap } from "@aerofocus/core";

const L = (rows: [number, number], letters: string): CabinLayout => {
  const list = letters.split("");
  return { rows, letters: list, windowLetters: [list[0]!, list[list.length - 1]!] };
};

/**
 * Representative seat maps per aircraft type (FR-010, Phase 2). Each is a typical layout for the
 * type, NOT any specific airline's configuration, so source is "representative". Replace with
 * "verified" maps per airline once configurations are sourced and licensed.
 */
export const SEAT_MAPS: Readonly<Record<string, SeatMap>> = {
  AT7: { id: "AT7", name: "ATR 72", source: "representative", cabins: { economy: L([1, 18], "ACDF") }, wingRows: [3, 8] },
  E90: {
    id: "E90", name: "Embraer E190", source: "representative",
    cabins: { business: L([1, 3], "ACD"), economy: L([4, 25], "ACDF") }, wingRows: [8, 13],
  },
  "223": {
    id: "223", name: "Airbus A220-300", source: "representative",
    cabins: { business: L([1, 3], "ACDF"), economy: L([4, 27], "ACDEF") }, wingRows: [9, 15],
  },
  "320": {
    id: "320", name: "Airbus A320", source: "representative",
    cabins: { business: L([1, 3], "ACDF"), economy: L([4, 30], "ABCDEF") }, wingRows: [10, 16],
  },
  "32N": {
    id: "32N", name: "Airbus A320neo", source: "representative",
    cabins: { business: L([1, 3], "ACDF"), economy: L([4, 31], "ABCDEF") }, wingRows: [10, 16],
  },
  "321": {
    id: "321", name: "Airbus A321", source: "representative",
    cabins: { business: L([1, 4], "ACDF"), economy: L([5, 36], "ABCDEF") }, wingRows: [14, 20],
  },
  "32Q": {
    id: "32Q", name: "Airbus A321neo", source: "representative",
    cabins: { business: L([1, 4], "ACDF"), premium_economy: L([5, 7], "ABCDEF"), economy: L([8, 38], "ABCDEF") }, wingRows: [15, 21],
  },
  "738": {
    id: "738", name: "Boeing 737-800", source: "representative",
    cabins: { business: L([1, 4], "ACDF"), economy: L([5, 32], "ABCDEF") }, wingRows: [11, 17],
  },
  "7M8": {
    id: "7M8", name: "Boeing 737 MAX 8", source: "representative",
    cabins: { business: L([1, 4], "ACDF"), economy: L([5, 33], "ABCDEF") }, wingRows: [11, 17],
  },
  "7M9": {
    id: "7M9", name: "Boeing 737 MAX 9", source: "representative",
    cabins: { business: L([1, 4], "ACDF"), economy: L([5, 35], "ABCDEF") }, wingRows: [13, 19],
  },
  "333": {
    id: "333", name: "Airbus A330-300", source: "representative",
    cabins: { business: L([1, 8], "ADGK"), premium_economy: L([20, 23], "ACDEFGHK"), economy: L([30, 60], "ACDEFGHK") }, wingRows: [31, 40],
  },
  "339": {
    id: "339", name: "Airbus A330-900", source: "representative",
    cabins: { business: L([1, 8], "ADGK"), premium_economy: L([20, 24], "ACDEFGHK"), economy: L([30, 62], "ACDEFGHK") }, wingRows: [32, 41],
  },
  "359": {
    id: "359", name: "Airbus A350-900", source: "representative",
    cabins: { business: L([11, 24], "ADFK"), premium_economy: L([31, 36], "ACDEFHK"), economy: L([41, 70], "ABCDEFHJK") }, wingRows: [43, 52],
  },
  "351": {
    id: "351", name: "Airbus A350-1000", source: "representative",
    cabins: { business: L([11, 25], "ADFK"), premium_economy: L([31, 35], "ACDEFHK"), economy: L([41, 75], "ABCDEFHJK") }, wingRows: [45, 55],
  },
  "763": {
    id: "763", name: "Boeing 767-300ER", source: "representative",
    cabins: { business: L([1, 6], "ADGK"), premium_economy: L([10, 12], "ACDEFHK"), economy: L([20, 45], "ACDEFHK") }, wingRows: [22, 30],
  },
  "77W": {
    id: "77W", name: "Boeing 777-300ER", source: "representative",
    cabins: {
      first: L([1, 2], "ADGK"), business: L([11, 24], "ADGK"), premium_economy: L([31, 35], "ACDEFGHK"), economy: L([41, 70], "ABCDEFGHJK"),
    },
    wingRows: [42, 52],
  },
  "788": {
    id: "788", name: "Boeing 787-8", source: "representative",
    cabins: { business: L([1, 6], "ADGK"), economy: L([20, 40], "ABCDEFHJK") }, wingRows: [22, 30],
  },
  "789": {
    id: "789", name: "Boeing 787-9", source: "representative",
    cabins: { business: L([1, 8], "ADGK"), premium_economy: L([21, 25], "ACDEFHK"), economy: L([30, 50], "ABCDEFHJK") }, wingRows: [31, 40],
  },
  "78X": {
    id: "78X", name: "Boeing 787-10", source: "representative",
    cabins: { business: L([1, 10], "ADGK"), premium_economy: L([21, 26], "ACDEFHK"), economy: L([31, 58], "ABCDEFHJK") }, wingRows: [34, 44],
  },
  "388": {
    id: "388", name: "Airbus A380-800", source: "representative",
    cabins: {
      first: L([1, 3], "AEFK"), business: L([11, 26], "ADFK"), premium_economy: L([31, 36], "ACDEFGHK"), economy: L([41, 88], "ABCDEFGHJK"),
    },
    wingRows: [50, 62],
  },
  "748": {
    id: "748", name: "Boeing 747-8", source: "representative",
    cabins: {
      first: L([1, 2], "AK"), business: L([3, 10], "ADGK"), premium_economy: L([31, 35], "ACDEFGHK"), economy: L([41, 70], "ABCDEFGHJK"),
    },
    wingRows: [40, 50],
  },
};

/** Seat map for an aircraft type, falling back to the generic family layout. */
export function seatMapFor(aircraftCode: string | null, family: AircraftFamily): SeatMap {
  return (aircraftCode ? SEAT_MAPS[aircraftCode] : undefined) ?? genericSeatMap(family);
}
