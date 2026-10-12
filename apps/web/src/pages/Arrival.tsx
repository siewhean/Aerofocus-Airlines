/**
 * Arrival (/fly/arrival, FR-013a, FR-015, FR-048): validate within the window, confirm unattended
 * spans, answer the goal question, then the outcome: stamp reveal, invalid, or ended early.
 */
import type { Itinerary } from "@aerofocus/client";
import type { TimeSpan } from "@aerofocus/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { Segmented } from "../components/FlightControls";
import { Stamp, type StampMark } from "../components/Stamp";
import { errorMessage } from "../lib/api";
import { apiExt, type HistoryItem } from "../lib/api-ext";
import { airportView } from "../lib/flights";
import { actOnFlight, lastGuestOutcome, loadActiveFlight, loadActiveLegContext, refreshFlight, type FlightView, type LoadedFlight } from "../lib/flightSession";
import { loadItinerary } from "../lib/itineraries";
import { countryName, formatClock, formatCountdown, formatDate, formatDuration } from "../lib/format";
import { useSession } from "../lib/session";
import { prefersReducedMotion, setTheme } from "../lib/theme";
import { useFlightClock } from "../lib/useFlightClock";
import { Badge, Button, Empty, Facts, Notice, Skeleton } from "../ui";
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
  /** Phase 3: the journey this leg belongs to (apps/api/src/routes/me.ts history items carry both). */
  itineraryId: string | null;
  legIndex: number | null;
}

/** History items now carry the itinerary leg; src/lib/api-ext.ts is typed without it. */
type HistoryLegItem = HistoryItem & { itineraryId?: string | null; legIndex?: number | null };

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
    itineraryId: view.boardingPass.itineraryId,
    legIndex: view.boardingPass.legIndex,
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
  const [journey, setJourney] = useState<{ itinerary: Itinerary; legIndex: number } | null>(null);
  /** One or two earlier marks, shown faded on the page excerpt behind the new stamp (Phase 9 item 8). */
  const [prior, setPrior] = useState<StampMark[]>([]);
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
        itineraryId: null,
        legIndex: null,
      };
    }
    const { flights } = await apiExt.history(1);
    const item = flights[0] as HistoryLegItem | undefined;
    if (!item || item.status === "in_flight") return null;
    const d = airportView(item.destination);
    return {
      outcome: item.status,
      destination: { iata: d.iata, city: d.city, country: d.country },
      arrival: item.arrival,
      creditedFocusMs: item.creditedFocusMs,
      // History items carry no credited flight time; the scheduled block is right for a completed flight.
      creditedFlightMs: item.status === "complete" ? item.scheduledBlockMs : Math.max(0, item.arrival - item.departure),
      itineraryId: item.itineraryId ?? null,
      legIndex: item.legIndex ?? null,
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

  // Journey context (Phase 7): reload the itinerary once the leg has an outcome, so the screen
  // knows whether this was a transit stop or the final destination.
  useEffect(() => {
    if (!final?.itineraryId || sessionRef.current.mode !== "user") {
      setJourney(null);
      return;
    }
    let cancelled = false;
    const itineraryId = final.itineraryId;
    const legIndex = final.legIndex ?? 0;
    const load =
      view && view.boardingPass.itineraryId === itineraryId
        ? loadActiveLegContext(sessionRef.current, view)
        : loadItinerary(itineraryId).then((it) => (it ? { itinerary: it, legIndex } : null));
    load
      .then((j) => {
        if (!cancelled) setJourney(j);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [final, view]);

  // Earlier stamps for the page excerpt: the last two completed flights before this one, from the
  // user's history (apiExt.history) or the guest history on the device. None is fine.
  useEffect(() => {
    if (!final || final.outcome !== "complete") {
      setPrior([]);
      return;
    }
    const s = sessionRef.current;
    const isThis = (arrival: number, sid?: string) => arrival === final.arrival || (sessionId !== null && sid === sessionId);
    if (s.mode === "guest") {
      const marks: StampMark[] = s.guest
        .load()
        .history.filter((r) => r.outcome === "complete" && !isThis(r.arrival))
        .slice(-2)
        .reverse()
        .map((r) => ({ id: `guest-${r.snapshotId}-${r.arrival}`, country: r.destinationCountry, airport: r.destination, arrivalDate: r.arrival }));
      setPrior(marks);
      return;
    }
    let cancelled = false;
    apiExt
      .history(3)
      .then(({ flights }) => {
        if (cancelled) return;
        const marks: StampMark[] = [];
        for (const f of flights) {
          const tm = f.travelMark;
          if (f.status !== "complete" || !tm || isThis(f.arrival, f.sessionId)) continue;
          marks.push({ id: tm.id, country: tm.country, airport: tm.airport, arrivalDate: tm.arrivalDate, isTransit: tm.isTransit ?? false, visitNumber: tm.visitNumber ?? null });
          if (marks.length === 2) break;
        }
        setPrior(marks);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [final, sessionId]);

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

  // Journey legs (Phase 7): an intermediate landing is a transit stop that leads to the terminal;
  // the last leg completes the journey. Single flights (no itineraryId) are unchanged.
  const journeyHref = final.itineraryId ? `/fly/journey/${final.itineraryId}` : null;
  const legCount = journey?.itinerary.legs.length ?? 0;
  const transit = journey !== null && journey.legIndex < legCount - 1;
  const lastLeg = journey !== null && journey.legIndex >= legCount - 1;
  const journeyCancelled = journeyHref && (
    <Notice tone="amber">
      <span>The rest of this journey is cancelled. Completed legs keep their credit.</span>
      <Button size="sm" to={journeyHref}>
        Rebook
      </Button>
    </Notice>
  );

  if (final.outcome === "complete") {
    return (
      <div className="arrival arrival-complete">
        <header className="arrival-header">
          <p className="muted">{transit ? "Landed" : "Arrived"}</p>
          <h1 className="display arrival-title">Welcome to {final.destination.city}</h1>
          {lastLeg && journey && (
            <p className="arrival-journey">
              <span>Journey complete</span>
              <span className="numeral">
                {legCount} legs, {formatDuration(journey.itinerary.arrival.epochMs - journey.itinerary.departure.epochMs)}
              </span>
            </p>
          )}
        </header>
        <figure className={`arrival-page ${reduced ? "is-reduced" : ""}`}>
          {/* A passport page excerpt: paper, the faint security print, earlier stamps faded, the new
              one pressed on at a slight offset. Earlier stamps are context and hidden from readers. */}
          <div className="arrival-page-paper">
            {prior.map((m, i) => (
              <div key={m.id} className={`arrival-page-prior arrival-page-prior-${i + 1}`} aria-hidden="true">
                <Stamp mark={m} timeZone={timeZone} size={170} />
              </div>
            ))}
            <div className="arrival-page-new">
              <Stamp mark={{ id: sessionId ?? `arrival-${final.arrival}`, country: final.destination.country, airport: final.destination.iata, arrivalDate: final.arrival, isTransit: transit }} timeZone={timeZone} size={220} />
            </div>
          </div>
          <figcaption className="small muted arrival-stamp-caption">
            {transit && <Badge tone="geo">Transit</Badge>}
            <span>{transit ? "Transit record" : "Virtual arrival record"}, not an immigration stamp</span>
          </figcaption>
        </figure>
        <Facts
          items={[
            { label: "Credited focus", value: formatDuration(final.creditedFocusMs) },
            { label: "Flight time", value: formatDuration(final.creditedFlightMs) },
          ]}
        />
        {transit && journey ? (
          <div className="arrival-actions">
            <Button variant="primary" to={`/fly/layover/${journey.itinerary.id}`}>
              Go to the terminal
            </Button>
            <Button to={journeyHref ?? "/fly/bookings"}>View journey</Button>
          </div>
        ) : (
          <>
            {links}
            <div className="arrival-actions">
              <Button variant="primary" onClick={returnToAirport}>
                Return to the airport
              </Button>
              {journeyHref && <Button to={journeyHref}>View journey</Button>}
            </div>
          </>
        )}
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
        {journeyCancelled}
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
      {journeyCancelled}
      {links}
      <div className="arrival-actions">
        <Button variant="primary" onClick={returnToAirport}>
          Return to the airport
        </Button>
      </div>
    </div>
  );
}
