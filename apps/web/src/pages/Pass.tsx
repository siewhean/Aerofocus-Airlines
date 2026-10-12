/** Boarding pass page (FR-008). Status line updates every 30 s against the server clock. */
import type { BoardingPass } from "@aerofocus/client";
import { MINUTE } from "@aerofocus/core";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Page } from "../app/Shell";
import { BoardingPassCard, passStatus } from "../components/BoardingPassCard";
import { errorMessage } from "../lib/api";
import { getBooking } from "../lib/flights";
import { formatClock, formatDuration } from "../lib/format";
import { useSession } from "../lib/session";
import { Button, Empty, Notice, Skeleton, useToast } from "../ui";
import "./Pass.css";

function untilLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return minutes < 60 ? `in ${minutes} min` : `in ${formatDuration(ms)}`;
}

export default function Pass() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const { bookingId = "" } = useParams();
  const tz = session.timeZone;

  const [pass, setPass] = useState<BoardingPass | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => session.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPass(undefined);
    setError(null);
    getBooking(session, bookingId)
      .then((p) => {
        if (!cancelled) setPass(p);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
    // The session object changes on every guest refresh; reload only when the id or mode changes.
  }, [bookingId, session.mode]);

  useEffect(() => {
    const id = setInterval(() => setNow(session.now()), 30_000);
    return () => clearInterval(id);
  }, [session]);

  async function board() {
    if (!pass) return;
    // The boarding page plays the sequence and boards at its end (FR-009).
    setBusy(true);
    navigate(`/fly/boarding/${encodeURIComponent(pass.bookingId)}`);
  }

  const actions = (
    <>
      <Button to="/fly/bookings">My bookings</Button>
      <Button onClick={() => window.print()} disabled={!pass}>
        Print
      </Button>
    </>
  );

  if (error) {
    return (
      <Page title="Boarding pass" aside={actions}>
        <Notice tone="danger">{error}</Notice>
      </Page>
    );
  }
  if (pass === undefined) {
    return (
      <Page title="Boarding pass" aside={actions}>
        <Skeleton lines={6} />
      </Page>
    );
  }
  if (pass === null) {
    return (
      <Page title="Boarding pass" aside={actions}>
        <Empty title="Booking not found" action={<Button to="/fly/bookings">My bookings</Button>}>
          It may have been cancelled, or it belongs to another passenger.
        </Empty>
      </Page>
    );
  }

  const status = passStatus(pass, now);
  const opens = pass.boardingOpensAt.epochMs;

  let statusLine: ReactNode;
  switch (status) {
    case "booked":
      statusLine = (
        <p className="pass-page-status" aria-live="polite">
          Boarding opens at <strong className="numeral">{formatClock(pass.boardingOpensAt, tz)}</strong> ({untilLabel(opens - now)}).
        </p>
      );
      break;
    case "boarding_open":
      statusLine = (
        <div className="pass-page-board">
          <Button variant="primary" size="lg" busy={busy} onClick={() => void board()}>
            {busy ? "Boarding" : "Board now"}
          </Button>
          <span className="muted">Boarding closes at {formatClock(pass.boardingClosesAt, tz)}.</span>
        </div>
      );
      break;
    case "boarded":
      statusLine = (
        <div className="pass-page-board">
          <span>You have boarded this flight.</span>
          <Button to="/fly/active" variant="primary">
            Go to your flight
          </Button>
        </div>
      );
      break;
    case "no_show":
      statusLine = (
        <Notice tone="danger">
          This booking lapsed as a no-show. <Link to="/fly/search">Find another flight</Link>.
        </Notice>
      );
      break;
    case "cancelled":
      statusLine = (
        <Notice>
          This booking was cancelled. <Link to="/fly/search">Find another flight</Link>.
        </Notice>
      );
      break;
  }

  return (
    <Page title="Boarding pass" aside={actions}>
      <BoardingPassCard pass={pass} now={now} />
      <div className="pass-page-line">{statusLine}</div>
    </Page>
  );
}
