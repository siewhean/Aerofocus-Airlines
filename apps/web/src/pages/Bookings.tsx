/** My bookings (PRD §4, FR-008). Lists passes for either session mode via lib/flights. */
import type { BoardingPass } from "@aerofocus/client";
import { MINUTE } from "@aerofocus/core";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { passStatus, StatusBadge } from "../components/BoardingPassCard";
import { errorMessage } from "../lib/api";
import { cancelBooking, listBookings } from "../lib/flights";
import { formatClock, formatDuration, formatRelativeDay } from "../lib/format";
import { useSession } from "../lib/session";
import { Board, Button, Cell, Dialog, Empty, Notice, Skeleton, useToast } from "../ui";
import "./Bookings.css";

const CLOSING_SOON_MS = 15 * MINUTE;

export default function Bookings() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const tz = session.timeZone;

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
      {error && <Notice tone="danger">{error}</Notice>}
      {closingSoon.map((p) => (
        <Notice key={p.bookingId} tone="amber">
          Boarding for {p.flightNumber} closes at {formatClock(p.boardingClosesAt, tz)}.
        </Notice>
      ))}

      {items === null && !error && <Skeleton lines={4} />}

      {items !== null && items.length === 0 && (
        <Empty title="No flights booked" action={<Button to="/fly/search" variant="primary">Find a flight</Button>}>
          Tell us when you can study and we'll find one.
        </Empty>
      )}

      {items !== null && items.length > 0 && (
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
                    <span className="code">{p.flightNumber}</span>
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
                      {p.status === "booked" && (
                        <Button size="sm" variant="quiet" disabled={busy} onClick={() => setToCancel(p)} aria-label={`Cancel booking ${p.flightNumber}`}>
                          Cancel
                        </Button>
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
