import type { LatLon } from "./geo";
import type { Airport, ScheduleSnapshot } from "./schedule";
import { createFlightPlan, flightStateAt } from "./simulation";
import type { Instant } from "./time";

/** One Community Flight per flight number and operating date (FR-004). */
export function communityFlightKey(s: Pick<ScheduleSnapshot, "operatingAirline" | "flightNumber" | "operatingDate">): string {
  return `${s.operatingAirline}${s.flightNumber}:${s.operatingDate}`;
}

interface PublicAirport extends LatLon {
  iata: string;
}

/**
 * Everything another user may see about a public flight (FR-056): origin, destination, path and
 * position. Departure and block time are included only so viewers can compute the position
 * locally instead of the server streaming it (FR-062). No profile data, ever.
 */
export interface PublicFlightDescriptor {
  /** Anonymous, session-specific identifier; not linkable across sessions (FR-060). */
  id: string;
  kind: "individual" | "community";
  origin: PublicAirport;
  destination: PublicAirport;
  departure: Instant;
  blockMs: number;
  /** Community Flights only. */
  passengerCount?: number;
}

export function toPublicAirport(a: Airport): PublicAirport {
  return { iata: a.iata, lat: a.lat, lon: a.lon };
}

/** Current position of a public flight, computed by the viewer. */
export function publicFlightPosition(flight: PublicFlightDescriptor, now: Instant): LatLon {
  const plan = createFlightPlan({
    origin: { ...flight.origin, name: "", city: "", country: "", region: "asia", timeZone: "UTC" },
    destination: { ...flight.destination, name: "", city: "", country: "", region: "asia", timeZone: "UTC" },
    departure: flight.departure,
    blockMs: flight.blockMs,
  });
  return flightStateAt(plan, now).position;
}
