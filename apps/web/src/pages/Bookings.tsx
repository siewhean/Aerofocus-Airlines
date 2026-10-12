/**
 * My bookings (PRD §4, FR-008). Lists passes for either session mode via lib/flights. The
 * "Journeys" tab lists itineraries (docs/UI-PLAN.md Phase 7 item 7); legs of a journey link to it
 * instead of offering Cancel (cancelBooking on a leg fails with itinerary_leg).
 */
import type { BoardingPass, Itinerary } from "@aerofocus/client";
import { MINUTE } from "@aerofocus/core";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Page } from "../app/Shell";
import { passStatus, StatusBadge } from "../components/BoardingPassCard";
import { chainFromItinerary, ItineraryStatusBadge, JourneyChain } from "../components/JourneyChain";
import { api, errorMessage } from "../lib/api";
import { cancelBooking, listBookings } from "../lib/flights";
import { formatClock, formatDuration, formatRelativeDay } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Board, Button, Cell, Dialog, Empty, Notice, Skeleton, useToast } from "../ui";
import "./Bookings.css";

const CLOSING_SOON_MS = 15 * MINUTE;
const JOURNEY_PAGE = 20;
type Tab = "flights" | "journeys";

export default function Bookings() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const tz = session.timeZone;
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "journeys" ? "journeys" : "flights";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === "flights") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  const [items, setItems] = useState<BoardingPass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => session.now());
  const [toCancel, setToCancel] = useState<BoardingPass | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await listBookings(session);
    return list.slice().sort((a, b) => a.departure.epochMs - b.departure.epochMs);
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(session.now()), 30_000);
    return () => clearInterval(id);
  }, [session]);

  async function reload() {
    try {
      setItems(await load());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function board(pass: BoardingPass) {
    // The boarding page plays the sequence and boards at its end (FR-009).
    setBusyId(pass.bookingId);
    navigate(`/fly/boarding/${encodeURIComponent(pass.bookingId)}`);
  }

  async function confirmCancel() {
    if (!toCancel) return;
    setBusyId(toCancel.bookingId);
    try {
      await cancelBooking(session, toCancel.bookingId);
      toast.show(`Booking ${toCancel.flightNumber} cancelled.`);
      setToCancel(null);
      await reload();
    } catch (e) {
      toast.show(errorMessage(e), "danger");
    } finally {
      setBusyId(null);
    }
  }

  const windowDays = session.rules?.bookingWindowDays ?? null;
  const lead = windowDays !== null ? `Flights booked up to ${windowDays} days ahead.` : "Flights you have booked.";

  const closingSoon = (items ?? []).filter((p) => {
    const left = p.boardingClosesAt.epochMs - now;
    return passStatus(p, now) === "boarding_open" && left > 0 && left <= CLOSING_SOON_MS;
  });

  return (
    <Page title="My bookings" lead={lead} aside={<Button to="/fly/search">Find a flight</Button>}>
      <div className="bookings-tabs" role="group" aria-label="Booking type">
        <Button variant={tab === "flights" ? "primary" : "secondary"} aria-pressed={tab === "flights"} onClick={() => setTab("flights")}>
          Flights
        </Button>
        <Button variant={tab === "journeys" ? "primary" : "secondary"} aria-pressed={tab === "journeys"} onClick={() => setTab("journeys")}>
          Journeys
        </Button>
      </div>

      {tab === "journeys" && <JourneysTab now={now} tz={tz} signedIn={session.mode === "user"} />}

      {tab === "flights" && error && <Notice tone="danger">{error}</Notice>}
      {tab === "flights" && closingSoon.map((p) => (
        <Notice key={p.bookingId} tone="amber">
          Boarding for {p.flightNumber} closes at {formatClock(p.boardingClosesAt, tz)}.
        </Notice>
      ))}

      {tab === "flights" && items === null && !error && <Skeleton lines={4} />}

      {tab === "flights" && items !== null && items.length === 0 && (
        <Empty title="No flights booked" action={<Button to="/fly/search" variant="primary">Find a flight</Button>}>
          Tell us when you can study and we'll find one.
        </Empty>
      )}

      {tab === "flights" && items !== null && items.length > 0 && (
        <Board caption="Your bookings, soonest first">
          <thead>
            <tr>
              <Cell head>Departs</Cell>
              <Cell head>Flight</Cell>
              <Cell head>Route</Cell>
              <Cell head num>
                Study time
              </Cell>
              <Cell head>Type</Cell>
              <Cell head>Status</Cell>
              <Cell head>
                <span className="visually-hidden">Actions</span>
              </Cell>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const status = passStatus(p, now);
              const busy = busyId === p.bookingId;
              return (
                <tr key={p.bookingId} className={status === "no_show" || status === "cancelled" ? "is-locked" : ""}>
                  <Cell>
                    <span className="bookings-when">
                      <span className="numeral">{formatClock(p.departure, tz)}</span>
                      <span className="small muted">{formatRelativeDay(p.departure, now, tz)}</span>
                    </span>
                  </Cell>
                  <Cell>
                    <span className="bookings-flight">
                      <span className="code">{p.flightNumber}</span>
                      {p.itineraryId !== null && p.legIndex !== null && <Badge tone="geo">Leg {p.legIndex + 1}</Badge>}
                    </span>
                    <span className="small muted bookings-airline">{p.airline.name}</span>
                  </Cell>
                  <Cell>
                    <span className="code">
                      {p.origin.iata} {p.destination.iata}
                    </span>
                  </Cell>
                  <Cell num>{formatDuration(p.studyDurationMs)}</Cell>
                  <Cell>{p.flightType === "community" ? "Community Flight" : "Individual"}</Cell>
                  <Cell>
                    <StatusBadge status={status} />
                  </Cell>
                  <Cell>
                    <span className="bookings-actions">
                      {status === "boarding_open" && (
                        <Button size="sm" variant="primary" busy={busy} onClick={() => void board(p)}>
                          Board
                        </Button>
                      )}
                      <Button size="sm" to={`/fly/pass/${encodeURIComponent(p.bookingId)}`} aria-label={`Boarding pass for ${p.flightNumber}`}>
                        Pass
                      </Button>
                      {p.itineraryId !== null ? (
                        <Button size="sm" variant="quiet" to={`/fly/journey/${encodeURIComponent(p.itineraryId)}`} aria-label={`View journey for ${p.flightNumber}`}>
                          View journey
                        </Button>
                      ) : (
                        p.status === "booked" && (
                          <Button size="sm" variant="quiet" disabled={busy} onClick={() => setToCancel(p)} aria-label={`Cancel booking ${p.flightNumber}`}>
                            Cancel
                          </Button>
                        )
                      )}
                    </span>
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </Board>
      )}

      <Dialog
        open={toCancel !== null}
        onClose={() => setToCancel(null)}
        title="Cancel this booking?"
        footer={
          <>
            <Button onClick={() => setToCancel(null)}>Keep booking</Button>
            <Button variant="danger" busy={busyId !== null && busyId === toCancel?.bookingId} onClick={() => void confirmCancel()}>
              Cancel booking
            </Button>
          </>
        }
      >
        <p>The seat is released. You can book it again if it still fits your window.</p>
        {toCancel && (
          <p className="muted">
            {toCancel.flightNumber}, {toCancel.origin.iata} to {toCancel.destination.iata}, departs {formatClock(toCancel.departure, tz)} {formatRelativeDay(toCancel.departure, now, tz)}.
          </p>
        )}
      </Dialog>
    </Page>
  );
}

function JourneysTab({ now, tz, signedIn }: { now: number; tz: string; signedIn: boolean }) {
  const [list, setList] = useState<Itinerary[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    api
      .itineraries({ limit: JOURNEY_PAGE })
      .then((res) => {
        if (cancelled) return;
        setList(res.itineraries);
        setNextBefore(res.nextBefore);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function loadMore() {
    if (nextBefore === null) return;
    setMore(true);
    try {
      const res = await api.itineraries({ limit: JOURNEY_PAGE, before: nextBefore });
      setList((prev) => [...(prev ?? []), ...res.itineraries]);
      setNextBefore(res.nextBefore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMore(false);
    }
  }

  if (!signedIn) {
    return (
      <Notice>
        <span>
          Connecting flights need an account. <Link to="/account/sign-in">Create one</Link> to book journeys.
        </span>
      </Notice>
    );
  }
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (list === null) return <Skeleton lines={4} />;
  if (list.length === 0) {
    return (
      <Empty title="No journeys booked" action={<Button to="/fly/search" variant="primary">Find a journey</Button>}>
        Search with connections to book a multi-leg journey.
      </Empty>
    );
  }
  return (
    <>
      <Board caption="Your journeys, newest first">
        <thead>
          <tr>
            <Cell head>Departs</Cell>
            <Cell head>Journey</Cell>
            <Cell head num>Legs</Cell>
            <Cell head>Status</Cell>
            <Cell head>
              <span className="visually-hidden">Actions</span>
            </Cell>
          </tr>
        </thead>
        <tbody>
          {list.map((it) => {
            const chain = chainFromItinerary(it);
            return (
              <tr key={it.id}>
                <Cell>
                  <span className="bookings-when">
                    <span className="numeral">{formatClock(it.departure, tz)}</span>
                    <span className="small muted">{formatRelativeDay(it.departure, now, tz)}</span>
                  </span>
                </Cell>
                <Cell>
                  <JourneyChain legs={chain.legs} layovers={chain.layovers} timeZone={tz} compact />
                </Cell>
                <Cell num>{it.legs.length}</Cell>
                <Cell>
                  <ItineraryStatusBadge status={it.status} />
                </Cell>
                <Cell>
                  <span className="bookings-actions">
                    <Button size="sm" to={`/fly/journey/${encodeURIComponent(it.id)}`} aria-label={`View journey ${it.origin.iata} to ${it.destination.iata}`}>
                      View
                    </Button>
                  </span>
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </Board>
      {nextBefore !== null && (
        <div>
          <Button busy={more} onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
