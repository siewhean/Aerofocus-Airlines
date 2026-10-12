/**
 * The journey drawn as a vertical chain (docs/UI-PLAN.md Phase 7 design): leg rows stacked with a
 * layover block between them ("2h 15m at Doha", lounge badge), the current leg marked with the
 * sky rule. `compact` renders the codes chain on one line for boards, with the layover duration
 * under each hub. Also hosts the itinerary offers board shared by Search and Journey (rebook).
 */
import type { Itinerary, ItineraryOffer } from "@aerofocus/client";
import type { CabinClass, DisplayTime } from "@aerofocus/core";
import type { ReactNode } from "react";
import { bookJourneyHref } from "../lib/itineraries";
import { cabinLabel, formatClock, formatDuration, formatRelativeDay } from "../lib/format";
import { itineraryStatusLabel } from "../lib/itineraries";
import { Badge, Board, Button, Cell, Icon } from "../ui";
import { FlightIdent, RouteCodes } from "./RouteCodes";
import "./JourneyChain.css";

type Tone = "neutral" | "signal" | "amber" | "premium" | "geo" | "danger";

interface Endpoint {
  iata: string;
  city?: string;
}

export interface ChainLeg {
  origin: Endpoint;
  destination: Endpoint;
  flightNumber: string;
  airline: string;
  departure: DisplayTime;
  arrival: DisplayTime;
  cabin?: CabinClass;
  status?: string;
  statusTone?: Tone;
  outcome?: string | null;
  locked?: boolean;
}

export interface ChainLayover {
  afterLegIndex: number;
  airport: Endpoint;
  layoverMs: number;
  lounge?: "premium" | "terminal";
  /** Final layover focus credit, shown as "25m focus credited" when known. */
  creditedFocusMs?: number | null;
}

interface Props {
  legs: ChainLeg[];
  layovers: ChainLayover[];
  timeZone: string;
  currentLegIndex?: number | null;
  compact?: boolean;
  /** Replace a leg row (Journey renders a compact boarding pass). */
  renderLeg?: (legIndex: number) => ReactNode;
}

export function JourneyChain({ legs, layovers, timeZone, currentLegIndex = null, compact = false, renderLeg }: Props) {
  const layoverAfter = (i: number) => layovers.find((l) => l.afterLegIndex === i) ?? null;

  if (compact) {
    return (
      <span className="jchain-compact" aria-label={legs.map((l, i) => `${i === 0 ? `${l.origin.iata} to ` : ""}${l.destination.iata}`).join(", ")}>
        {legs.map((leg, i) => {
          const lay = layoverAfter(i);
          return (
            <span key={i} className="jchain-compact-leg">
              {i === 0 && (
                <span className="jchain-node">
                  <span className="code">{leg.origin.iata}</span>
                </span>
              )}
              <Icon name="plane" size={14} className="jchain-plane" title="to" />
              <span className="jchain-node">
                <span className="code">{leg.destination.iata}</span>
                {lay && <span className="jchain-node-layover small muted numeral">{formatDuration(lay.layoverMs)}</span>}
              </span>
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <ol className="jchain" aria-label="Journey">
      {legs.map((leg, i) => {
        const lay = layoverAfter(i);
        const current = currentLegIndex === i;
        return (
          <li key={i} className={`jchain-item ${current ? "is-current" : ""}`} aria-current={current ? "step" : undefined}>
            {renderLeg ? (
              <div className="jchain-custom">{renderLeg(i)}</div>
            ) : (
              <div className={`jchain-leg ${leg.locked ? "is-locked" : ""}`}>
                <span className="jchain-clock">
                  <span className="numeral">{formatClock(leg.departure, timeZone)}</span>
                  <span className="small muted">Departs</span>
                </span>
                <span className="jchain-route">
                  <RouteCodes origin={leg.origin} destination={leg.destination} cities />
                </span>
                <span className="jchain-flight">
                  <FlightIdent flightNumber={leg.flightNumber} airline={leg.airline} locked={leg.locked} />
                </span>
                <span className="jchain-meta">
                  <span className="numeral">{formatDuration(leg.arrival.epochMs - leg.departure.epochMs)}</span>
                  {leg.cabin && <span className="small muted">{cabinLabel(leg.cabin)}</span>}
                </span>
                {leg.status && (
                  <span className="jchain-status">
                    <Badge tone={leg.statusTone ?? "neutral"}>{leg.status}</Badge>
                  </span>
                )}
              </div>
            )}
            {lay && (
              <div className="jchain-layover">
                <Icon name="layover" size={16} className="jchain-layover-icon" />
                <span className="jchain-layover-text">
                  <span className="numeral">{formatDuration(lay.layoverMs)}</span> at {lay.airport.city ?? lay.airport.iata}
                </span>
                {lay.lounge === "premium" ? (
                  <Badge tone="premium" icon="seat">
                    Premium lounge
                  </Badge>
                ) : lay.lounge === "terminal" ? (
                  <Badge>Terminal</Badge>
                ) : null}
                {typeof lay.creditedFocusMs === "number" && lay.creditedFocusMs > 0 && (
                  <span className="small muted">{formatDuration(lay.creditedFocusMs)} focus credited</span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const STATUS_TONE: Record<Itinerary["status"], Tone> = {
  booked: "neutral",
  in_progress: "geo",
  complete: "signal",
  incomplete: "danger",
  abandoned: "danger",
  cancelled: "danger",
};

export function ItineraryStatusBadge({ status }: { status: Itinerary["status"] }) {
  return <Badge tone={STATUS_TONE[status]}>{itineraryStatusLabel(status)}</Badge>;
}

/** Chain inputs from a booked itinerary. */
export function chainFromItinerary(it: Itinerary): { legs: ChainLeg[]; layovers: ChainLayover[] } {
  return {
    legs: it.legs.map((l) => ({
      origin: l.boardingPass.origin,
      destination: l.boardingPass.destination,
      flightNumber: l.boardingPass.flightNumber,
      airline: l.boardingPass.airline.name,
      departure: l.boardingPass.departure,
      arrival: l.boardingPass.arrival,
      cabin: l.boardingPass.cabin,
      outcome: l.outcome,
    })),
    layovers: it.layovers.map((l) => ({ afterLegIndex: l.afterLegIndex, airport: l.airport, layoverMs: l.layoverMs, lounge: l.lounge, creditedFocusMs: l.creditedFocusMs })),
  };
}

/** Chain inputs from a search offer. */
export function chainFromOffer(offer: ItineraryOffer): { legs: ChainLeg[]; layovers: ChainLayover[] } {
  return {
    legs: offer.legs.map((l) => ({
      origin: l.origin,
      destination: l.destination,
      flightNumber: l.flightNumber,
      airline: l.airline.name,
      departure: l.departure,
      arrival: l.arrival,
      locked: l.airline.locked,
    })),
    layovers: offer.layovers.map((l) => ({ afterLegIndex: l.afterLegIndex, airport: l.airport, layoverMs: l.layoverMs })),
  };
}

/** Cabins offered on every leg; locked when locked on any leg. */
export function offerCabins(offer: ItineraryOffer): { cabin: CabinClass; locked: boolean }[] {
  const first = offer.legs[0];
  if (!first) return [];
  return first.cabins
    .filter((c) => offer.legs.every((l) => l.cabins.some((x) => x.cabin === c.cabin)))
    .map((c) => ({ cabin: c.cabin, locked: offer.legs.some((l) => l.cabins.find((x) => x.cabin === c.cabin)?.locked) }));
}

export function connectionsLabel(offer: Pick<ItineraryOffer, "connections" | "layovers">): string {
  if (offer.connections === 0) return "Direct";
  const hubs = offer.layovers.map((l) => l.airport.iata).join(", ");
  return `${offer.connections} ${offer.connections === 1 ? "stop" : "stops"} at ${hubs}`;
}

interface OffersBoardProps {
  offers: ItineraryOffer[];
  now: number;
  timeZone: string;
  cabin: CabinClass;
  studyWindow?: { start: number; end: number } | null;
  /** Guests cannot book journeys: Book is disabled. */
  canBook: boolean;
  /** Extra query appended to the book link (e.g. rebookedFrom). */
  hrefSuffix?: string;
  caption: string;
}

export function ItineraryOffersBoard({ offers, now, timeZone, cabin, studyWindow = null, canBook, hrefSuffix = "", caption }: OffersBoardProps) {
  return (
    <Board caption={caption}>
      <thead>
        <tr>
          <Cell head>Departs</Cell>
          <Cell head>Journey</Cell>
          <Cell head num>Total time</Cell>
          <Cell head num>Lands</Cell>
          <Cell head>Type</Cell>
          <Cell head>Connections</Cell>
          <Cell head>Cabins</Cell>
          <Cell head>
            <span className="visually-hidden">Action</span>
          </Cell>
        </tr>
      </thead>
      <tbody>
        {offers.map((o) => {
          const key = `${o.mode}-${o.legs.map((l) => l.snapshotId).join("+")}-${o.departure.epochMs}`;
          const day = formatRelativeDay(o.departure, now, timeZone);
          const chain = chainFromOffer(o);
          const cabins = offerCabins(o);
          const anyLocked = o.legs.some((l) => l.airline.locked);
          const chosen = cabins.find((c) => c.cabin === cabin) ?? cabins.find((c) => !c.locked) ?? cabins[0];
          const bookable = canBook && o.bookable && !anyLocked && chosen !== undefined && !chosen.locked;
          const reason = !canBook ? "Create an account to book connecting flights." : anyLocked ? "An airline on this journey is locked. Keep flying to unlock it." : "This journey cannot be booked right now.";
          const href = chosen ? `${bookJourneyHref(o, chosen.cabin, studyWindow)}${hrefSuffix}` : "#";
          return (
            <tr key={key} className={anyLocked ? "is-locked" : undefined}>
              <Cell>
                <span className="jchain-when">
                  <span className="numeral">{formatClock(o.departure, timeZone)}</span>
                  {day !== "today" && <span className="muted small">{day}</span>}
                </span>
              </Cell>
              <Cell>
                <JourneyChain legs={chain.legs} layovers={chain.layovers} timeZone={timeZone} compact />
              </Cell>
              <Cell num>
                <span className="numeral">{formatDuration(o.totalMs)}</span>
              </Cell>
              <Cell num>
                <span className="numeral">{formatClock(o.arrival, timeZone)}</span>
              </Cell>
              <Cell>{o.mode === "community" ? <Badge tone="geo">Community Flight</Badge> : "Individual"}</Cell>
              <Cell>{connectionsLabel(o)}</Cell>
              <Cell>
                <span className="jchain-cabins">
                  {cabins.map((c, i) => (
                    <span key={c.cabin} className={c.locked ? "jchain-cabin-locked" : undefined}>
                      {c.locked && <Icon name="lock" size={12} title="Locked" />}
                      {cabinLabel(c.cabin)}
                      {i < cabins.length - 1 ? "," : ""}
                    </span>
                  ))}
                </span>
              </Cell>
              <Cell num>
                {bookable ? (
                  <Button variant="primary" size="sm" to={href}>
                    Book
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" disabled title={reason}>
                    Book
                  </Button>
                )}
              </Cell>
            </tr>
          );
        })}
      </tbody>
    </Board>
  );
}
