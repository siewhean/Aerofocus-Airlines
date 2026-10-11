/**
 * Boarding sequence (/fly/boarding/:bookingId, FR-009): five captions over rules.boardingSequenceMs,
 * then board() and on to the flight. The theme wipe from ivory to midnight is the one orchestrated
 * moment in the app (docs/UI-PLAN.md design plan).
 */
import type { BoardingPass } from "@aerofocus/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LocalClock } from "../app/Shell";
import { FlightIdent, RouteCodes } from "../components/RouteCodes";
import { apiExt } from "../lib/api-ext";
import { errorMessage } from "../lib/api";
import { boardBooking, BookingError, getBooking } from "../lib/flights";
import { formatClock } from "../lib/format";
import { useSession } from "../lib/session";
import { prefersReducedMotion, setTheme } from "../lib/theme";
import { Button, Notice, Skeleton } from "../ui";
import "./Boarding.css";

const OPEN_FLAG = "aerofocus.flightOpen";
const DEFAULT_SEQUENCE_MS = 90_000;
const STEPS = 5;

type Stage = "loading" | "sequence" | "boarding" | "too_early" | "error";

function captionsFor(pass: BoardingPass): string[] {
  const seat = pass.seat;
  const where = seat.wingView ? ", by the window with a view of the wing" : seat.isWindow ? ", by the window" : "";
  return [
    `Welcome aboard ${pass.airline.name} flight ${pass.flightNumber} to ${pass.destination.city}.`,
    `Your seat is ${seat.seat}${where}.`,
    "Please stow your study materials… actually, keep them out. Phones to silent, notifications off.",
    "Safety first: take breaks when scheduled, drink water, and tell us when you're back.",
    "Cabin crew, prepare for departure.",
  ];
}

export default function Boarding() {
  const { bookingId = "" } = useParams();
  const session = useSession();
  const navigate = useNavigate();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [pass, setPass] = useState<BoardingPass | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [aboard, setAboard] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const finished = useRef(false);

  const total = session.rules?.boardingSequenceMs ?? DEFAULT_SEQUENCE_MS;
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const root = document.documentElement;
    setTheme("air");
    root.dataset.shell = "hidden";
    return () => {
      setTheme("ground");
      delete root.dataset.shell;
    };
  }, []);

  // Load the pass and decide whether the sequence can start.
  useEffect(() => {
    if (!session.ready) return;
    let cancelled = false;
    (async () => {
      const s = sessionRef.current;
      try {
        const p = await getBooking(s, bookingId);
        if (cancelled) return;
        if (!p) {
          setError("We couldn't find that booking.");
          setStage("error");
          return;
        }
        setPass(p);
        if (p.status === "boarded") {
          navigate("/fly/active", { replace: true });
          return;
        }
        if (p.flightType === "community" && s.now() < p.boardingOpensAt.epochMs) {
          setOpensAt(p.boardingOpensAt.epochMs);
          setStage("too_early");
          return;
        }
        setStage("sequence");
      } catch (e) {
        if (cancelled) return;
        setError(errorMessage(e));
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.ready, session.mode, bookingId, navigate]);

  // Returning passengers may skip the introduction.
  useEffect(() => {
    if (!session.ready) return;
    const s = sessionRef.current;
    if (s.prefs.skipBoardingIntro) {
      setCanSkip(true);
      return;
    }
    if (s.mode === "guest") {
      setCanSkip(s.guest.load().history.length > 0);
      return;
    }
    let cancelled = false;
    apiExt
      .history(1)
      .then((r) => {
        if (!cancelled) setCanSkip(r.flights.length > 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session.ready, session.mode, session.prefs.skipBoardingIntro]);

  // The wipe: once the page knows what to show, the ivory veil fades to reveal the cabin.
  useEffect(() => {
    if (stage === "loading") return;
    const id = requestAnimationFrame(() => setAboard(true));
    return () => cancelAnimationFrame(id);
  }, [stage]);

  // Sequence timing. A UI animation, so performance.now() is the right clock here.
  useEffect(() => {
    if (stage !== "sequence") return;
    const start = performance.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.min(total, performance.now() - start)), 200);
    return () => clearInterval(id);
  }, [stage, total]);

  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    setStage("boarding");
    const s = sessionRef.current;
    try {
      await boardBooking(s, bookingId);
      try {
        sessionStorage.setItem(OPEN_FLAG, "boarding");
      } catch {
        /* ignore */
      }
      navigate("/fly/active", { replace: true });
    } catch (e) {
      finished.current = false;
      if (e instanceof BookingError) {
        if (e.code === "too_early") {
          setOpensAt(pass?.boardingOpensAt.epochMs ?? null);
          setStage("too_early");
          return;
        }
        if (e.code === "already_boarded") {
          navigate("/fly/active", { replace: true });
          return;
        }
      }
      setError(errorMessage(e));
      setStage("error");
    }
  }, [bookingId, navigate, pass]);

  useEffect(() => {
    if (stage === "sequence" && elapsed >= total) finish().catch(() => undefined);
  }, [stage, elapsed, total, finish]);

  const skip = () => {
    setElapsed(total);
  };

  const step = Math.min(STEPS - 1, Math.floor((elapsed / total) * STEPS));
  const captions = pass ? captionsFor(pass) : [];
  const caption = captions[step] ?? "";
  const backTo = pass ? `/fly/pass/${pass.bookingId}` : "/fly/bookings";

  return (
    <div className={`boarding ${aboard ? "is-aboard" : ""} ${reduced ? "is-reduced" : ""}`}>
      <div className="boarding-veil" aria-hidden="true" />

      <header className="boarding-header">
        {pass ? (
          <div className="boarding-ident">
            <FlightIdent flightNumber={pass.flightNumber} airline={pass.airline.name} />
            <RouteCodes origin={pass.origin} destination={pass.destination} cities />
          </div>
        ) : (
          <span />
        )}
        <LocalClock seconds />
      </header>

      <main className="boarding-body">
        {stage === "loading" && <Skeleton lines={2} />}

        {(stage === "sequence" || stage === "boarding") && (
          <div className="boarding-sequence" aria-live="polite">
            <p key={step} className="boarding-caption display">
              {caption}
            </p>
            {stage === "boarding" && <p className="muted">Boarding…</p>}
          </div>
        )}

        {stage === "too_early" && pass && (
          <div className="boarding-message">
            <h1 className="display">Boarding opens at {opensAt !== null ? formatClock(opensAt, session.timeZone) : formatClock(pass.boardingOpensAt, session.timeZone)}</h1>
            <p className="muted">Come back when the gate opens. Your seat is held until then.</p>
            <div className="boarding-actions">
              <Button to={backTo}>Back to your boarding pass</Button>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="boarding-message">
            <Notice tone="danger">{error ?? "Boarding failed."}</Notice>
            <div className="boarding-actions">
              <Button to="/fly/bookings">My bookings</Button>
              <Link to="/fly/search" className="small muted">
                Find another flight
              </Link>
            </div>
          </div>
        )}
      </main>

      {(stage === "sequence" || stage === "boarding") && (
        <footer className="boarding-footer">
          <div className="boarding-progress" role="progressbar" aria-label="Boarding" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((elapsed / total) * 100)}>
            <div className="boarding-progress-fill" style={{ width: `${(elapsed / total) * 100}%` }} />
          </div>
          <div className="boarding-footer-row">
            <span className="small muted">Virtual journey on a real schedule.</span>
            {canSkip && stage === "sequence" && (
              <Button variant="secondary" size="sm" onClick={skip}>
                Skip introduction
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
