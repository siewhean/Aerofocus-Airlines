/**
 * Arrival (/fly/arrival, FR-013a, FR-015, FR-048): validate within the window, confirm unattended
 * spans, answer the goal question, then the outcome: stamp reveal, invalid, or ended early.
 */
import type { TimeSpan } from "@aerofocus/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { Segmented } from "../components/FlightControls";
import { errorMessage } from "../lib/api";
import { apiExt } from "../lib/api-ext";
import { airportView } from "../lib/flights";
import { actOnFlight, lastGuestOutcome, loadActiveFlight, refreshFlight, type FlightView, type LoadedFlight } from "../lib/flightSession";
import { countryName, formatClock, formatCountdown, formatDate, formatDuration } from "../lib/format";
import { useSession } from "../lib/session";
import { prefersReducedMotion, setTheme } from "../lib/theme";
import { useFlightClock } from "../lib/useFlightClock";
import { Button, Empty, Facts, Notice, Skeleton } from "../ui";
import "./Arrival.css";

const OPEN_FLAG = "aerofocus.flightOpen";
const POLL_MS = 30_000;

type FinalOutcome = "complete" | "invalid" | "ended_early" | "no_show";

interface Final {
  outcome: FinalOutcome;
  destination: { iata: string; city: string; country: string };
  arrival: number;
  creditedFocusMs: number;
  creditedFlightMs: number;
}

function finalFromView(view: FlightView): Final | null {
  const o = view.focus.outcome;
  if (o !== "complete" && o !== "invalid" && o !== "ended_early") return null;
  const d = view.boardingPass.destination;
  return {
    outcome: o,
    destination: { iata: d.iata, city: d.city, country: d.country },
    arrival: view.flight.arrival.epochMs,
    creditedFocusMs: view.focus.creditedFocusMs,
    creditedFlightMs: view.focus.creditedFlightMs,
  };
}

/** "09:41" for windows under an hour; the full figure otherwise. */
function shortCountdown(ms: number): string {
  const full = formatCountdown(ms);
  return full.startsWith("00:") ? full.slice(3) : full;
}

export default function Arrival() {
  const session = useSession();
  const navigate = useNavigate();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const { timeZone } = session;

  const [loaded, setLoaded] = useState<LoadedFlight | null | undefined>(undefined);
  const [view, setView] = useState<FlightView | null>(null);
  const [final, setFinal] = useState<Final | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(() => new Set());
  const [goal, setGoal] = useState<"yes" | "no" | null>(null);
  const expired = useRef(false);

  const plan = loaded?.plan ?? null;
  const { now } = useFlightClock(plan);
  const nothing = loaded === null && final === null;

  useEffect(() => {
    const root = document.documentElement;
    if (nothing) {
      setTheme("ground");
      delete root.dataset.shell;
      return;
    }
    setTheme("air");
    root.dataset.shell = "hidden";
    return () => {
      setTheme("ground");
      delete root.dataset.shell;
    };
  }, [nothing]);

  /** Outcome when no session is open any more: guest history on the device, the user's latest flight otherwise. */
  const loadFinal = useCallback(async (): Promise<Final | null> => {
    const s = sessionRef.current;
    if (s.mode === "guest") {
      const rec = lastGuestOutcome(s);
      if (!rec) return null;
      const d = airportView(rec.destination);
      return {
        outcome: rec.outcome,
        destination: { iata: d.iata, city: d.city, country: d.country || rec.destinationCountry },
        arrival: rec.arrival,
        creditedFocusMs: rec.creditedFocusMs,
        creditedFlightMs: rec.creditedFlightMs,
      };
    }
    const { flights } = await apiExt.history(1);
    const item = flights[0];
    if (!item || item.status === "in_flight") return null;
    const d = airportView(item.destination);
    return {
      outcome: item.status,
      destination: { iata: d.iata, city: d.city, country: d.country },
      arrival: item.arrival,
      creditedFocusMs: item.creditedFocusMs,
      // History items carry no credited flight time; the scheduled block is right for a completed flight.
      creditedFlightMs: item.status === "complete" ? item.scheduledBlockMs : Math.max(0, item.arrival - item.departure),
    };
  }, []);

  useEffect(() => {
    if (!session.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const l = await loadActiveFlight(sessionRef.current);
        if (cancelled) return;
        if (l) {
          setLoaded(l);
          setView(l.view);
          setFinal(finalFromView(l.view));
          return;
        }
        const f = await loadFinal();
        if (cancelled) return;
        setFinal(f);
        setLoaded(null);
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          setLoaded(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.ready, session.mode, loadFinal]);

  const sessionId = loaded?.view.sessionId ?? null;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const v = await refreshFlight(sessionRef.current, sessionId);
    if (v) {
      setView(v);
      setFinal(finalFromView(v));
    } else {
      setFinal(await loadFinal());
    }
  }, [sessionId, loadFinal]);

  useEffect(() => {
    if (!sessionId || final) return;
    const id = setInterval(() => refresh().catch(() => undefined), POLL_MS);
    return () => clearInterval(id);
  }, [sessionId, final, refresh]);

  // Still in flight (reached this page early): back to the cabin.
  useEffect(() => {
    if (view && view.focus.outcome === "in_flight") navigate("/fly/active", { replace: true });
  }, [view, navigate]);

  const deadline = view?.focus.validationDeadline ?? null;
  const remaining = deadline !== null ? deadline - now : 0;
  useEffect(() => {
    if (deadline === null || final || remaining > 0 || expired.current) return;
    expired.current = true;
    refresh().catch(() => undefined);
  }, [deadline, remaining, final, refresh]);

  useEffect(() => {
    if (!final) return;
    try {
      sessionStorage.removeItem(OPEN_FLAG);
    } catch {
      /* ignore */
    }
  }, [final]);

  const validate = async () => {
    if (!sessionId || !view) return;
    setBusy(true);
    setError(null);
    try {
      const v = await actOnFlight(sessionRef.current, sessionId, {
        type: "validate",
        confirmUnattendedStarts: [...confirmed],
        goalCompleted: view.studyGoal ? goal === "yes" : null,
      });
      if (v) {
        setView(v);
        setFinal(finalFromView(v));
      } else {
        setFinal(await loadFinal());
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSpan = (start: number, on: boolean) =>
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (on) next.add(start);
      else next.delete(start);
      return next;
    });

  const returnToAirport = () => {
    setTheme("ground");
    navigate("/");
  };

  const reduced = useMemo(() => prefersReducedMotion(), []);

  if (loaded === undefined) {
    return (
      <div className="arrival arrival-loading">
        <Skeleton lines={4} />
      </div>
    );
  }

  if (nothing) {
    return (
      <Page title="Arrival">
        {error && <Notice tone="danger">{error}</Notice>}
        <Empty
          title="No recent arrival"
          action={
            <Button variant="primary" to="/">
              Back to the airport
            </Button>
          }
        >
          When you land, your arrival summary appears here.
        </Empty>
      </Page>
    );
  }

  if (!final && view) {
    const f = view.focus;
    const flightMs = view.flight.arrival.epochMs - view.flight.departure.epochMs;
    return (
      <div className="arrival">
        <header className="arrival-header">
          <p className="muted">Arrived in {view.boardingPass.destination.city}</p>
          <h1 className="display">Confirm your arrival</h1>
          <p className="arrival-deadline numeral" role="timer" aria-live="off">
            Validate within {shortCountdown(remaining)}
          </p>
        </header>

        {error && <Notice tone="danger">{error}</Notice>}

        <Facts
          items={[
            { label: "Flight time", value: formatDuration(flightMs) },
            { label: "Focused", value: formatDuration(f.focusMs) },
            { label: "Breaks", value: formatDuration(f.breakMs) },
            { label: "Credited so far", value: formatDuration(f.creditedFocusMs) },
          ]}
        />

        {f.unattended.length > 0 && (
          <section className="arrival-unattended" aria-labelledby="unattended-title">
            <h2 id="unattended-title">Time we couldn't see the app</h2>
            <p className="muted">Tick any span you were studying through and it will be credited.</p>
            <ul className="arrival-spans">
              {f.unattended.map((span: TimeSpan) => {
                const id = `span-${span.start}`;
                return (
                  <li key={span.start}>
                    <input id={id} type="checkbox" checked={confirmed.has(span.start)} onChange={(e) => toggleSpan(span.start, e.target.checked)} />
                    <label htmlFor={id}>
                      <span className="numeral">
                        {formatClock(span.start, timeZone)} to {formatClock(span.end, timeZone)}
                      </span>
                      <span className="muted small">{formatDuration(span.end - span.start)}</span>
                      <span>I was studying through this</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {view.studyGoal && (
          <section className="arrival-goal">
            <h2>Did you reach your goal: {view.studyGoal}?</h2>
            <Segmented
              label="Goal reached"
              value={goal}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "Not this time" },
              ]}
              onChange={setGoal}
            />
          </section>
        )}

        <div className="arrival-actions">
          <Button variant="primary" size="lg" busy={busy} onClick={() => validate().catch(() => undefined)}>
            Confirm arrival
          </Button>
        </div>
        <p className="small muted">Virtual journey on a real schedule. You are not aboard the real aircraft.</p>
      </div>
    );
  }

  if (!final) {
    return (
      <div className="arrival arrival-loading">
        <Skeleton lines={3} />
      </div>
    );
  }

  const links = (
    <div className="arrival-links">
      <Button to="/collection/passport">Passport</Button>
      <Button to="/fly/search">Book another flight</Button>
      <Button to="/">Dashboard</Button>
    </div>
  );

  if (final.outcome === "complete") {
    return (
      <div className="arrival arrival-complete">
        <header className="arrival-header">
          <p className="muted">Arrived</p>
          <h1 className="display arrival-title">Welcome to {final.destination.city}</h1>
        </header>
        <figure className={`stamp ${reduced ? "is-reduced" : ""}`}>
          <div className="stamp-ring">
            <span className="stamp-code display">{final.destination.iata}</span>
            <span className="stamp-country">{countryName(final.destination.country)}</span>
            <span className="stamp-date numeral">{formatDate(final.arrival, timeZone)}</span>
          </div>
          <figcaption className="small muted">Virtual arrival record, not an immigration stamp</figcaption>
        </figure>
        <Facts
          items={[
            { label: "Credited focus", value: formatDuration(final.creditedFocusMs) },
            { label: "Flight time", value: formatDuration(final.creditedFlightMs) },
          ]}
        />
        {links}
        <div className="arrival-actions">
          <Button variant="primary" onClick={returnToAirport}>
            Return to the airport
          </Button>
        </div>
      </div>
    );
  }

  if (final.outcome === "ended_early") {
    return (
      <div className="arrival">
        <header className="arrival-header">
          <h1 className="display">You left early</h1>
          <p className="muted">Focus completed before your last break is kept.</p>
        </header>
        <Facts items={[{ label: "Credited focus", value: formatDuration(final.creditedFocusMs) }]} />
        {links}
        <div className="arrival-actions">
          <Button variant="primary" onClick={returnToAirport}>
            Return to the airport
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="arrival">
      <header className="arrival-header">
        <h1 className="display">{final.outcome === "no_show" ? "Flight missed" : "Not validated"}</h1>
      </header>
      <Notice tone="danger">
        {final.outcome === "no_show" ? "This booking lapsed before boarding, so it earns no focus credit or stamp." : "This flight wasn't validated in time, so it earns no focus credit or stamp."}
      </Notice>
      {links}
      <div className="arrival-actions">
        <Button variant="primary" onClick={returnToAirport}>
          Return to the airport
        </Button>
      </div>
    </div>
  );
}
