import type { Airport, ScheduleSnapshot } from "../src";
import { MINUTE } from "../src";

export const SIN: Airport = {
  iata: "SIN", name: "Singapore Changi", city: "Singapore", country: "SG", region: "asia",
  lat: 1.3644, lon: 103.9915, timeZone: "Asia/Singapore",
};
export const LHR: Airport = {
  iata: "LHR", name: "London Heathrow", city: "London", country: "GB", region: "europe",
  lat: 51.47, lon: -0.4543, timeZone: "Europe/London",
};
export const KUL: Airport = {
  iata: "KUL", name: "Kuala Lumpur International", city: "Kuala Lumpur", country: "MY", region: "asia",
  lat: 2.7456, lon: 101.7099, timeZone: "Asia/Kuala_Lumpur",
};

/** 2026-10-12T00:00:00Z */
export const T0 = Date.UTC(2026, 9, 12, 0, 0);

export function snapshot(overrides: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  return {
    id: "test:SQ322:2026-10-12",
    provider: "test",
    dataVersion: "1",
    retrievedAt: 0,
    sourceStatus: "sample",
    operatingAirline: "SQ",
    marketingAirline: null,
    flightNumber: "322",
    origin: "SIN",
    destination: "LHR",
    operatingDate: "2026-10-12",
    departure: T0 + 2 * 60 * MINUTE,
    arrival: T0 + 2 * 60 * MINUTE + 845 * MINUTE,
    aircraftType: "388",
    cabinClasses: ["economy", "premium_economy", "business", "first"],
    ...overrides,
  };
}
