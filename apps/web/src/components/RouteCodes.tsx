import { Icon } from "../ui/Icon";
import { LockedBadge } from "../ui/Badge";
import "./RouteCodes.css";

interface Endpoint {
  iata: string;
  city?: string;
}

/**
 * "SIN ✈ LHR" in signage type. The plane icon is the only connector; no text arrows (design plan).
 * Pass `cities` to print the city names on a second line.
 */
export function RouteCodes({ origin, destination, cities = false, size = "md" }: { origin: Endpoint; destination: Endpoint; cities?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={`route ${size === "lg" ? "route-lg" : ""}`}>
      <span className="route-codes">
        <span className="code">{origin.iata}</span>
        <Icon name="plane" size={size === "lg" ? 22 : 16} className="route-plane" title="to" />
        <span className="code">{destination.iata}</span>
      </span>
      {cities && (
        <span className="route-cities muted small">
          <span>{origin.city ?? origin.iata}</span>
          <span aria-hidden="true">to</span>
          <span>{destination.city ?? destination.iata}</span>
        </span>
      )}
    </span>
  );
}

/** Flight number in signage type with the airline name beneath; shows the lock when the airline is locked. */
export function FlightIdent({ flightNumber, airline, locked = false }: { flightNumber: string; airline: string; locked?: boolean }) {
  return (
    <span className="flight-ident">
      <span className="code">{flightNumber}</span>
      <span className="flight-ident-airline muted small">
        <span>{airline}</span>
        {locked && <LockedBadge what="This airline" />}
      </span>
    </span>
  );
}
