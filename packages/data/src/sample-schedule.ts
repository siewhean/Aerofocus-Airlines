import type { CabinClass } from "@aerofocus/core";

/**
 * SAMPLE weekly timetable for development and testing only. Times and durations are illustrative,
 * NOT published airline schedules, and every generated snapshot is marked sourceStatus "sample".
 * Replace with a licensed schedule provider before launch (Phase 0).
 */
export interface WeeklyPattern {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  /** Departure wall-clock time at the origin. */
  departureLocal: string;
  blockMinutes: number;
  /** ISO weekdays the service operates (1 = Monday). */
  days: readonly number[];
  aircraft: string | null;
  cabins: CabinClass[] | null;
}

const DAILY = [1, 2, 3, 4, 5, 6, 7] as const;
const E: CabinClass[] = ["economy"];
const EB: CabinClass[] = ["economy", "business"];
const EPB: CabinClass[] = ["economy", "premium_economy", "business"];
const EBF: CabinClass[] = ["economy", "business", "first"];
const EPBF: CabinClass[] = ["economy", "premium_economy", "business", "first"];

export const SAMPLE_PATTERNS: readonly WeeklyPattern[] = [
  // Under 1 hour
  { airline: "AK", flightNumber: "6012", origin: "KUL", destination: "PEN", departureLocal: "13:00", blockMinutes: 55, days: DAILY, aircraft: "320", cabins: E },
  { airline: "MH", flightNumber: "1142", origin: "KUL", destination: "PEN", departureLocal: "09:00", blockMinutes: 58, days: DAILY, aircraft: "738", cabins: EB },
  // 1–2 hours
  { airline: "TR", flightNumber: "450", origin: "SIN", destination: "KUL", departureLocal: "10:00", blockMinutes: 65, days: DAILY, aircraft: "32N", cabins: E },
  { airline: "SQ", flightNumber: "106", origin: "SIN", destination: "KUL", departureLocal: "08:00", blockMinutes: 60, days: DAILY, aircraft: "359", cabins: EB },
  { airline: "AK", flightNumber: "712", origin: "KUL", destination: "SIN", departureLocal: "07:00", blockMinutes: 65, days: DAILY, aircraft: "320", cabins: E },
  { airline: "JQ", flightNumber: "501", origin: "SYD", destination: "MEL", departureLocal: "06:00", blockMinutes: 95, days: DAILY, aircraft: "320", cabins: E },
  { airline: "QF", flightNumber: "401", origin: "SYD", destination: "MEL", departureLocal: "07:00", blockMinutes: 95, days: DAILY, aircraft: "738", cabins: EB },
  { airline: "FR", flightNumber: "202", origin: "DUB", destination: "LGW", departureLocal: "07:00", blockMinutes: 75, days: DAILY, aircraft: "738", cabins: E },
  { airline: "U2", flightNumber: "8851", origin: "LGW", destination: "AMS", departureLocal: "06:40", blockMinutes: 70, days: DAILY, aircraft: "320", cabins: E },
  { airline: "KL", flightNumber: "1000", origin: "AMS", destination: "LHR", departureLocal: "07:00", blockMinutes: 70, days: DAILY, aircraft: "738", cabins: EB },
  { airline: "AF", flightNumber: "1081", origin: "CDG", destination: "LHR", departureLocal: "08:00", blockMinutes: 75, days: DAILY, aircraft: "320", cabins: EB },
  { airline: "LH", flightNumber: "900", origin: "FRA", destination: "LHR", departureLocal: "07:30", blockMinutes: 100, days: DAILY, aircraft: "32N", cabins: EB },
  // 2–4 hours
  { airline: "TR", flightNumber: "616", origin: "SIN", destination: "BKK", departureLocal: "09:30", blockMinutes: 150, days: DAILY, aircraft: "32N", cabins: E },
  { airline: "SQ", flightNumber: "708", origin: "SIN", destination: "BKK", departureLocal: "07:35", blockMinutes: 145, days: DAILY, aircraft: "359", cabins: EB },
  { airline: "TG", flightNumber: "404", origin: "BKK", destination: "SIN", departureLocal: "12:00", blockMinutes: 145, days: DAILY, aircraft: "333", cabins: EB },
  { airline: "TR", flightNumber: "282", origin: "SIN", destination: "DPS", departureLocal: "08:25", blockMinutes: 155, days: [1, 3, 5, 7], aircraft: "32N", cabins: E },
  { airline: "VJ", flightNumber: "812", origin: "SGN", destination: "SIN", departureLocal: "07:30", blockMinutes: 120, days: DAILY, aircraft: "32Q", cabins: E },
  { airline: "6E", flightNumber: "1001", origin: "DEL", destination: "BOM", departureLocal: "06:00", blockMinutes: 130, days: DAILY, aircraft: "32Q", cabins: E },
  { airline: "AI", flightNumber: "865", origin: "DEL", destination: "BOM", departureLocal: "08:00", blockMinutes: 135, days: DAILY, aircraft: "32N", cabins: EB },
  { airline: "U2", flightNumber: "8335", origin: "LGW", destination: "BCN", departureLocal: "08:00", blockMinutes: 125, days: DAILY, aircraft: "320", cabins: E },
  { airline: "PR", flightNumber: "502", origin: "MNL", destination: "SIN", departureLocal: "08:00", blockMinutes: 220, days: DAILY, aircraft: "333", cabins: EB },
  { airline: "CX", flightNumber: "714", origin: "SIN", destination: "HKG", departureLocal: "09:00", blockMinutes: 235, days: DAILY, aircraft: "359", cabins: EPB },
  { airline: "VN", flightNumber: "650", origin: "SGN", destination: "HKG", departureLocal: "10:00", blockMinutes: 165, days: [2, 4, 6], aircraft: "789", cabins: EB },
  { airline: "JQ", flightNumber: "7", origin: "SIN", destination: "DPS", departureLocal: "15:00", blockMinutes: 160, days: DAILY, aircraft: "320", cabins: E },
  // 4–8 hours
  { airline: "SQ", flightNumber: "638", origin: "SIN", destination: "HND", departureLocal: "22:10", blockMinutes: 415, days: DAILY, aircraft: "359", cabins: EPB },
  { airline: "JL", flightNumber: "36", origin: "SIN", destination: "HND", departureLocal: "22:30", blockMinutes: 405, days: DAILY, aircraft: "789", cabins: EPB },
  { airline: "KE", flightNumber: "644", origin: "SIN", destination: "ICN", departureLocal: "22:50", blockMinutes: 380, days: DAILY, aircraft: "77W", cabins: EBF },
  { airline: "EK", flightNumber: "353", origin: "SIN", destination: "DXB", departureLocal: "01:45", blockMinutes: 440, days: DAILY, aircraft: "388", cabins: EBF },
  { airline: "EK", flightNumber: "1", origin: "DXB", destination: "LHR", departureLocal: "07:45", blockMinutes: 460, days: DAILY, aircraft: "388", cabins: EPBF },
  { airline: "QR", flightNumber: "1", origin: "DOH", destination: "LHR", departureLocal: "07:45", blockMinutes: 410, days: DAILY, aircraft: "351", cabins: EB },
  { airline: "SQ", flightNumber: "211", origin: "SIN", destination: "SYD", departureLocal: "20:35", blockMinutes: 470, days: DAILY, aircraft: "359", cabins: EPB },
  { airline: "AK", flightNumber: "152", origin: "KUL", destination: "DEL", departureLocal: "18:00", blockMinutes: 330, days: [1, 4, 6], aircraft: "32Q", cabins: E },
  { airline: "BA", flightNumber: "117", origin: "LHR", destination: "JFK", departureLocal: "08:20", blockMinutes: 485, days: DAILY, aircraft: "77W", cabins: EPBF },
  // Over 8 hours
  { airline: "QR", flightNumber: "945", origin: "SIN", destination: "DOH", departureLocal: "20:45", blockMinutes: 490, days: DAILY, aircraft: "359", cabins: EB },
  { airline: "SQ", flightNumber: "322", origin: "SIN", destination: "LHR", departureLocal: "23:55", blockMinutes: 845, days: DAILY, aircraft: "388", cabins: EPBF },
  { airline: "BA", flightNumber: "12", origin: "SIN", destination: "LHR", departureLocal: "23:20", blockMinutes: 860, days: DAILY, aircraft: "77W", cabins: EPBF },
  { airline: "BA", flightNumber: "283", origin: "LHR", destination: "LAX", departureLocal: "10:00", blockMinutes: 670, days: DAILY, aircraft: "789", cabins: EPBF },
  { airline: "CX", flightNumber: "251", origin: "HKG", destination: "LHR", departureLocal: "23:30", blockMinutes: 800, days: DAILY, aircraft: "351", cabins: EPB },
  { airline: "TR", flightNumber: "12", origin: "SIN", destination: "SYD", departureLocal: "21:00", blockMinutes: 480, days: [1, 3, 5], aircraft: "789", cabins: E },
  { airline: "QF", flightNumber: "12", origin: "LAX", destination: "SYD", departureLocal: "23:00", blockMinutes: 900, days: DAILY, aircraft: "789", cabins: EPBF },
  { airline: "CX", flightNumber: "880", origin: "HKG", destination: "LAX", departureLocal: "11:00", blockMinutes: 760, days: DAILY, aircraft: "77W", cabins: EPBF },
  // Additional aircraft types (Phase 2 catalogue)
  { airline: "KL", flightNumber: "1007", origin: "AMS", destination: "LHR", departureLocal: "14:00", blockMinutes: 70, days: DAILY, aircraft: "E90", cabins: EB },
  { airline: "AF", flightNumber: "1680", origin: "CDG", destination: "AMS", departureLocal: "10:30", blockMinutes: 80, days: DAILY, aircraft: "223", cabins: EB },
  { airline: "VN", flightNumber: "1", origin: "SGN", destination: "HND", departureLocal: "23:50", blockMinutes: 360, days: DAILY, aircraft: "78X", cabins: EPB },
  { airline: "KE", flightNumber: "17", origin: "ICN", destination: "LAX", departureLocal: "14:30", blockMinutes: 670, days: DAILY, aircraft: "748", cabins: EBF },
  { airline: "MH", flightNumber: "1", origin: "KUL", destination: "LHR", departureLocal: "23:30", blockMinutes: 805, days: [2, 4, 6, 7], aircraft: "339", cabins: EB },
  // Connecting services (Phase 3, illustrative). Layovers below are at published times; departureLocal
  // is origin wall-clock time and arrival = departure + block, so check each pair across time zones.
  // SIN→DOH→LHR: QR945 lands DOH 23:55 local; QR15 departs 01:50 → 1 h 55 layover (QR1 07:45 → 7 h 50).
  { airline: "QR", flightNumber: "15", origin: "DOH", destination: "LHR", departureLocal: "01:50", blockMinutes: 420, days: DAILY, aircraft: "351", cabins: EB },
  // KUL→SIN→SYD: SQ117 lands SIN 17:30; SQ211 departs 20:35 → 3 h 05 layover (TR12 21:00 → 3 h 30).
  { airline: "SQ", flightNumber: "117", origin: "KUL", destination: "SIN", departureLocal: "16:30", blockMinutes: 60, days: DAILY, aircraft: "359", cabins: EB },
  // SIN→LHR→JFK: SQ322 lands LHR 06:00 UTC; BA175 departs 13:30 local → 6 h 30 (BST) / 7 h 30 (GMT).
  { airline: "BA", flightNumber: "175", origin: "LHR", destination: "JFK", departureLocal: "13:30", blockMinutes: 490, days: DAILY, aircraft: "77W", cabins: EPBF },
  // Short domestic-style connection MEL→SYD→BNE: QF430 lands SYD 08:30; QF520 departs 09:45 → 1 h 15
  // (minimum 45 min, all airports in AU). JQ810 at 14:00 → 5 h 30.
  { airline: "QF", flightNumber: "430", origin: "MEL", destination: "SYD", departureLocal: "07:00", blockMinutes: 90, days: DAILY, aircraft: "738", cabins: EB },
  { airline: "QF", flightNumber: "520", origin: "SYD", destination: "BNE", departureLocal: "09:45", blockMinutes: 90, days: DAILY, aircraft: "738", cabins: EB },
  { airline: "JQ", flightNumber: "810", origin: "SYD", destination: "BNE", departureLocal: "14:00", blockMinutes: 95, days: DAILY, aircraft: "320", cabins: E },
];
