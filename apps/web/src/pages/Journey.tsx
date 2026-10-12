/**
 * A booked journey (docs/UI-PLAN.md Phase 7 item 4): status, the vertical chain of leg passes
 * with layover blocks, the current step's action, abandon (FR-044) and rebooking from the
 * current airport for incomplete or abandoned journeys. Polls every 30 s while open and schedules
 * the server's notification plan locally.
 */
import type { Itinerary, ItineraryOffer } from "@aerofocus/client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { Page } from "../app/Shell";
import { BoardingPassCard, passStatus } from "../components/BoardingPassCard";
import { chainFromItinerary, ItineraryOffersBoard, ItineraryStatusBadge, JourneyChain } from "../components/JourneyChain";
import { api, errorMessage } from "../lib/api";
import { formatClock, formatDateTime } from "../lib/format";
import { currentStep, itineraryErrorMessage, loadItinerary, OPEN_STATUSES, rememberOpenItinerary, scheduleItineraryNotifications, type JourneyStep } from "../lib/itineraries";
import { useSession } from "../lib/session";
import { Button, Dialog, Empty, Icon, Notice, Section, Skeleton, useToast } from "../ui";
import "./Journey.css";

const POLL_MS = 30_000;
const TICK_MS = 15_000;

function legStatusLine(leg: Itinerary["legs"][number], now: number): string {
  switch (leg.outcome) {
    case "complete":
      return "Complete";
    case "in_flight":
      return "In flight";
    case "awaiting_validation":
      return "Awaiting validation";
    case "invalid":
      return "Not validated";
    case "ended_early":
      return "Ended early";
    default:
      break;
  }
  const s = passStatus(leg.boardingPass, now);
  return s === "no_show" ? "Missed" : s === "boarding_open" ? "Boarding open" : s === "boarded" ? "Boarded" : s === "cancelled" ? "Cancelled" : "Booked";
}

function stepLegIndex(step: JourneyStep): number | null {
  switch (step.kind) {
    case "board":
    case "in_flight":
    case "validate":
      return step.legIndex;
    case "layover":
      return step.legIndex + 1;
    default:
      return null;
  }
}

export default function Journey() {
  const { id = "" } = useParams();
  const session = useSession();
  const toast = useToast();
  const tz = session.timeZone;

  const [itinerary, setItinerary] = useState<Itinerary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => session.now());
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [rebook, setRebook] = useState<{ offers: ItineraryOffer[]; fromCity: string } | null>(null);
  const [rebookError, setRebookError] = useState<string | null>(null);
  const [rebookBusy, setRebookBusy] = useState(false);

  const load = useCallback(async () => {
    const it = await loadItinerary(id);
    setItinerary(it);
    if (it && OPEN_STATUSES.has(it.status)) rememberOpenItinerary(it.id);
    return it;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setItinerary(undefined);
    setError(null);
    load().catch((e) => {
      if (!cancelled) setError(errorMessage(e));
    });
    return () => {
      cancelled = true;
    };
  }, [id, load]);

  // Poll while the journey is open; tick the clock for boarding windows.
  const open = itinerary ? OPEN_STATUSES.has(itinerary.status) : false;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const poll = setInterval(() => {
      load().catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [open, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(session.now()), TICK_MS);
    return () => clearInterval(t);
  }, [session]);

  // Local notifications from the server's plan; rescheduled on every re-fetch (docs/API.md).
  const channel = session.settings?.notifications.channel ?? "sound";
  useEffect(() => {
    if (!itinerary || !open) return;
    return scheduleItineraryNotifications(itinerary, channel, session.now(), tz);
  }, [itinerary, open, channel, session, tz]);

  async function confirmAbandon() {
    if (!itinerary) return;
    setAbandoning(true);
    try {
      const res = await api.abandonItinerary(itinerary.id);
      setItinerary(res.itinerary);
      rememberOpenItinerary(null);
      setAbandonOpen(false);
      toast.show("Journey abandoned. Completed legs keep their credit.");
    } catch (e) {
      toast.show(itineraryErrorMessage(e), "danger");
    } finally {
      setAbandoning(false);
    }
  }

  async function findRebook() {
    if (!itinerary) return;
    setRebookBusy(true);
    setRebookError(null);
    try {
      const res = await api.rebookOptions(itinerary.id, { limit: 40 });
      setRebook({ offers: res.offers, fromCity: res.from.city });
    } catch (e) {
      setRebookError(itineraryErrorMessage(e));
    } finally {
      setRebookBusy(false);
    }
  }

  if (error) {
    return (
      <Page title="Journey">
        <Notice tone="danger">{error}</Notice>
        <div>
          <Button to="/fly/bookings">My bookings</Button>
        </div>
      </Page>
    );
  }
  if (itinerary === undefined) {
    return (
      <Page title="Journey">
        <Skeleton lines={6} />
      </Page>
    );
  }
  if (itinerary === null) {
    return (
      <Page title="Journey">
        <Empty title="Journey not found" action={<Button to="/fly/bookings">My bookings</Button>}>
          This journey does not exist or is not yours.
        </Empty>
      </Page>
    );
  }

  const it = itinerary;
  const step = currentStep(it, now);
  const chain = chainFromItinerary(it);
  const legCount = it.legs.length;
  const connections = Math.max(0, legCount - 1);
  const currentLeg = stepLegIndex(step);
  const rebookable = it.status === "incomplete" || it.status === "abandoned";
  const rebookCabin = it.legs[0]?.boardingPass.cabin ?? "economy";

  return (
    <Page
      title={
        <span className="journey-title">
          <span>
            {it.origin.city} to {it.destination.city}
          </span>
          <span className="journey-codes code">
            {it.origin.iata}
            <Icon name="plane" size={18} className="journey-plane" title="to" />
            {it.destination.iata}
          </span>
        </span>
      }
      lead={
        <>
          Departs {formatDateTime(it.departure, tz)}, lands {formatDateTime(it.arrival, tz)}. {legCount} {legCount === 1 ? "leg" : "legs"}, {connections} {connections === 1 ? "connection" : "connections"}.
        </>
      }
      aside={<ItineraryStatusBadge status={it.status} />}
    >
      {open && (
        <Section title="Now">
          <NowPanel step={step} itinerary={it} now={now} tz={tz} />
        </Section>
      )}

      <Section title="Your journey">
        <JourneyChain
          legs={chain.legs}
          layovers={chain.layovers}
          timeZone={tz}
          currentLegIndex={currentLeg}
          renderLeg={(i) => {
            const leg = it.legs[i];
            if (!leg) return null;
            return (
              <div className="journey-leg">
                <div className="journey-leg-head">
                  <span className="small muted">
                    Leg {i + 1} of {legCount}
                  </span>
                  <span className="journey-leg-status">{legStatusLine(leg, now)}</span>
                </div>
                <BoardingPassCard pass={leg.boardingPass} now={now} compact />
              </div>
            );
          }}
        />
      </Section>

      {it.canAbandon && open && (
        <Section>
          <div className="journey-actions">
            <Button variant="danger" onClick={() => setAbandonOpen(true)}>
              Abandon journey
            </Button>
          </div>
        </Section>
      )}

      {rebookable && (
        <Section title={`Rebook from ${it.currentAirport.city}`} aside={<span className="code">{it.currentAirport.iata}</span>}>
          {it.currentAirport.iata === it.destination.iata ? (
            <Notice>You have already reached this journey's destination.</Notice>
          ) : rebook === null ? (
            <>
              <p className="muted">Find a new journey from where you are now to {it.destination.city}. Completed legs keep their credit.</p>
              {rebookError && <Notice tone="danger">{rebookError}</Notice>}
              <div>
                <Button variant="primary" busy={rebookBusy} onClick={() => void findRebook()}>
                  Find flights from here
                </Button>
              </div>
            </>
          ) : rebook.offers.length === 0 ? (
            <Empty title={`No flights from ${rebook.fromCity} fit`}>Try again later, or search for a new flight.</Empty>
          ) : (
            <ItineraryOffersBoard
              offers={rebook.offers}
              now={now}
              timeZone={tz}
              cabin={rebookCabin}
              canBook={session.mode === "user"}
              hrefSuffix={`&rebookedFrom=${encodeURIComponent(it.id)}`}
              caption={`Journeys from ${rebook.fromCity} to ${it.destination.city}`}
            />
          )}
        </Section>
      )}

      <Dialog
        open={abandonOpen}
        onClose={() => setAbandonOpen(false)}
        title="Abandon this journey?"
        footer={
          <>
            <Button onClick={() => setAbandonOpen(false)}>Keep journey</Button>
            <Button variant="danger" busy={abandoning} onClick={() => void confirmAbandon()}>
              Abandon journey
            </Button>
          </>
        }
      >
        <p>Later legs are cancelled. Completed legs keep their focus credit, stamps and rewards.</p>
      </Dialog>
    </Page>
  );
}

function NowPanel({ step, itinerary, now, tz }: { step: JourneyStep; itinerary: Itinerary; now: number; tz: string }) {
  switch (step.kind) {
    case "board": {
      const n = step.legIndex + 1;
      const canBoard = now >= step.opensAt && now <= step.closesAt;
      return (
        <div className="journey-now">
          <p>{canBoard ? `Boarding is open for leg ${n}.` : now < step.opensAt ? `Boarding for leg ${n} opens at ${formatClock(step.opensAt, tz)}.` : `Boarding for leg ${n} has closed.`}</p>
          {canBoard ? (
            <Button variant="primary" size="lg" to={`/fly/boarding/${encodeURIComponent(step.bookingId)}`}>
              Board leg {n}
            </Button>
          ) : (
            <Button variant="primary" size="lg" disabled>
              {now < step.opensAt ? `Boarding opens at ${formatClock(step.opensAt, tz)}` : "Boarding closed"}
            </Button>
          )}
        </div>
      );
    }
    case "in_flight":
      return (
        <div className="journey-now">
          <p>Leg {step.legIndex + 1} is in the air.</p>
          <Button variant="primary" size="lg" to="/fly/active">
            Return to your flight
          </Button>
        </div>
      );
    case "validate":
      return (
        <div className="journey-now">
          <p>Leg {step.legIndex + 1} has landed. Validate your arrival within 10 minutes to keep its credit.</p>
          <Button variant="primary" size="lg" to="/fly/arrival">
            Validate leg {step.legIndex + 1}
          </Button>
        </div>
      );
    case "layover": {
      const hub = itinerary.layovers.find((l) => l.afterLegIndex === step.legIndex)?.airport ?? itinerary.currentAirport;
      const next = itinerary.legs[step.legIndex + 1];
      return (
        <div className="journey-now">
          <p>
            In the terminal at {hub.city}.{next ? ` Boarding for leg ${step.legIndex + 2} opens at ${formatClock(next.boardingPass.boardingOpensAt, tz)}.` : ""}
          </p>
          <Button variant="primary" size="lg" to={`/fly/layover/${encodeURIComponent(itinerary.id)}`}>
            Go to the terminal
          </Button>
        </div>
      );
    }
    default:
      return null;
  }
}
