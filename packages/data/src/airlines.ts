import type { AircraftType, Airline } from "@aerofocus/core";

/**
 * Airline reference data. Skytrax positions here are SAMPLE values (rankSource: "sample") for
 * development only. Replace them with the licensed Skytrax World Airline Awards ranking before launch.
 */
export const AIRLINES: readonly Airline[] = [
  { iata: "TR", name: "Scoot", type: "budget", skytraxRank: null, rankSource: "sample" },
  { iata: "AK", name: "AirAsia", type: "budget", skytraxRank: null, rankSource: "sample" },
  { iata: "VJ", name: "VietJet Air", type: "budget", skytraxRank: null, rankSource: "sample" },
  { iata: "6E", name: "IndiGo", type: "budget", skytraxRank: null, rankSource: "sample" },
  { iata: "JQ", name: "Jetstar", type: "budget", skytraxRank: null, rankSource: "sample" },
  { iata: "FR", name: "Ryanair", type: "budget", skytraxRank: null, rankSource: "sample" },
  { iata: "U2", name: "easyJet", type: "budget", skytraxRank: null, rankSource: "sample" },
  { iata: "QR", name: "Qatar Airways", type: "full_service", skytraxRank: 1, rankSource: "sample" },
  { iata: "SQ", name: "Singapore Airlines", type: "full_service", skytraxRank: 2, rankSource: "sample" },
  { iata: "CX", name: "Cathay Pacific", type: "full_service", skytraxRank: 3, rankSource: "sample" },
  { iata: "EK", name: "Emirates", type: "full_service", skytraxRank: 4, rankSource: "sample" },
  { iata: "KE", name: "Korean Air", type: "full_service", skytraxRank: 7, rankSource: "sample" },
  { iata: "JL", name: "Japan Airlines", type: "full_service", skytraxRank: 9, rankSource: "sample" },
  { iata: "QF", name: "Qantas", type: "full_service", skytraxRank: 15, rankSource: "sample" },
  { iata: "AF", name: "Air France", type: "full_service", skytraxRank: 11, rankSource: "sample" },
  { iata: "LH", name: "Lufthansa", type: "full_service", skytraxRank: 24, rankSource: "sample" },
  { iata: "BA", name: "British Airways", type: "full_service", skytraxRank: 28, rankSource: "sample" },
  { iata: "KL", name: "KLM", type: "full_service", skytraxRank: 30, rankSource: "sample" },
  { iata: "TG", name: "Thai Airways", type: "full_service", skytraxRank: 33, rankSource: "sample" },
  { iata: "MH", name: "Malaysia Airlines", type: "full_service", skytraxRank: 40, rankSource: "sample" },
  { iata: "VN", name: "Vietnam Airlines", type: "full_service", skytraxRank: 45, rankSource: "sample" },
  { iata: "PR", name: "Philippine Airlines", type: "full_service", skytraxRank: 60, rankSource: "sample" },
  { iata: "AI", name: "Air India", type: "full_service", skytraxRank: null, rankSource: "sample" },
];

export const AIRLINES_BY_IATA: ReadonlyMap<string, Airline> = new Map(AIRLINES.map((a) => [a.iata, a]));

export const AIRCRAFT_TYPES: readonly AircraftType[] = [
  { code: "320", name: "Airbus A320", family: "narrowbody" },
  { code: "32N", name: "Airbus A320neo", family: "narrowbody" },
  { code: "32Q", name: "Airbus A321neo", family: "narrowbody" },
  { code: "738", name: "Boeing 737-800", family: "narrowbody" },
  { code: "7M8", name: "Boeing 737 MAX 8", family: "narrowbody" },
  { code: "333", name: "Airbus A330-300", family: "widebody_twin" },
  { code: "359", name: "Airbus A350-900", family: "widebody_twin" },
  { code: "351", name: "Airbus A350-1000", family: "widebody_twin" },
  { code: "77W", name: "Boeing 777-300ER", family: "widebody_twin" },
  { code: "788", name: "Boeing 787-8", family: "widebody_twin" },
  { code: "789", name: "Boeing 787-9", family: "widebody_twin" },
  { code: "388", name: "Airbus A380-800", family: "widebody_quad" },
];

export const AIRCRAFT_BY_CODE: ReadonlyMap<string, AircraftType> = new Map(AIRCRAFT_TYPES.map((a) => [a.code, a]));
