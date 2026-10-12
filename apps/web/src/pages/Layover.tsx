/**
 * Layover Terminal (/fly/layover/:id, FR-042, FR-043): the atmosphere between legs. A gate
 * countdown by phase, the airport's departures board, the lounge and optional layover focus.
 * Polls layover(id) every 30 s and derives every countdown locally from the server clock (the
 * server's msTo* figures are snapshots); the itinerary is re-fetched every 60 s so the local
 * notification plan stays current (docs/API.md "Layovers, lounge and layover focus",
 * "Connecting-flight notifications"; docs/UI-PLAN.md Phase 7 item 5).
 */
import type { Itinerary, LayoverResponse, LayoverView } from "@aerofocus/client";
import type { DisplayTime } from "@aerofocus/core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { LocalClock } from "../app/Shell";
import { DeparturesBoard } from "../components/DeparturesBoard";
import { GateCountdown } from "../components/GateCountdown";
import { api } from "../lib/api";
import { playAlert } from "../lib/audio";
import { formatClock, formatDuration } from "../lib/format";
import {
  itineraryErrorMessage,
  LAYOVER_PHASE_LABELS,
  legLabel,
  loadItinerary,
  OPEN_STATUSES,
  rememberedOpenItinerary,
  rememberOpenItinerary,
  scheduleItineraryNotifications,
} from "../lib/itineraries";
import { useSession } from "../lib/session";
import { setTheme } from "../lib/theme";
import { Badge, Button, Empty, Icon, Notice, Skeleton } from "../ui";
import { isUuid } from "../lib/api";
import "./Layover.css";

const LAYOVER_POLL_MS = 30_000;
const ITINERARY_POLL_MS = 60_000;
const HEARTBEAT_MS = 60_000;
const CLOSING_SOON_MS = 5 * 60_000;

type Phase = LayoverView["phase"];

/** Layover focus can run while the passenger is in the terminal (docs/API.md "Layover focus"). */
const FOCUS_PHASES: ReadonlySet<Phase> = new Set(["deplaning", "in_terminal", "boarding_open"]);

const PHASE_TONE: Record<Phase, "neutral" | "signal" | "amber" | "geo" | "danger"> = {
  not_started: "neutral",
  deplaning: "amber",
  in_terminal: "geo",
  boarding_open: "signal",
  missed: "danger",
  departed: "geo",
  cancelled: "neutral",
};

function rememberIfOpen(it: Itinerary): void {
  if (OPEN_STATUSES.has(it.status)) rememberOpenItinerary(it.id);
  else if (rememberedOpenItinerary() === it.id) rememberOpenItinerary(null);
}

export default function Layover() {
  const { id: rawId = "" } = useParams();
  // The id is interpolated into API paths by the client library; anything but a UUID is "not found".
  const id = isUuid(rawId) ? rawId : "";
  const session = useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const { timeZone } = session;
  const channel = session.settings?.notifications.channel ?? "sound";
  const alertVolume = session.prefs.audio.notifications;

  const [itinerary, setItinerary] = useState<Itinerary | null | undefined>(undefined);
  const [data, setData] = useState<LayoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => session.now());

  // Atmosphere: terminal, with the shell hidden like the cabin pages.
  useEffect(() => {
    const root = document.documentElement;
    setTheme("terminal");
    root.dataset.shell = "hidden";
    return () => {
      setTheme("ground");
      delete root.dataset.shell;
    };
  }, []);

  const loadIt = useCallback(async () => {
    const it = await loadItinerary(id);
    setItinerary(it);
    if (it) rememberIfOpen(it);
    return it;
  }, [id]);

  const loadLayover = useCallback(async () => {
    if (!id) return null;
    const res = await api.layover(id);
    setData(res);
    setError(null);
    return res;
  }, [id]);

  // Initial load: the itinerary first (404 → not found), then the layover view.
  useEffect(() => {
    if (!session.ready) return;
    if (session.mode !== "user") {
      setItinerary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const it = await loadIt();
        if (cancelled || !it) return;
        await loadLayover();
      } catch (e) {
        if (!cancelled) setError(itineraryErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.ready, session.mode, loadIt, loadLayover]);

  // Polling: the layover every 30 s, the itinerary (notification plan) every 60 s.
  const itineraryId = itinerary?.id ?? null;
  useEffect(() => {
    if (!itineraryId) return;
    const a = setInterval(() => loadLayover().catch((e) => setError(itineraryErrorMessage(e))), LAYOVER_POLL_MS);
    const b = setInterval(() => loadIt().catch(() => undefined), ITINERARY_POLL_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [itineraryId, loadLayover, loadIt]);

  // Local clock: countdowns tick from the server-synced clock, and refresh when the tab returns.
  useEffect(() => {
    const tick = () => setNow(sessionRef.current.now());
    const t = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      tick();
      if (itineraryId) loadLayover().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [itineraryId, loadLayover]);

  // Phase changes: a boarding chime once when the gate opens, and a fresh notification plan.
  const phase = data?.layover?.phase ?? null;
  const prevPhase = useRef<Phase | null>(null);
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === null || phase === null || prev === phase) return;
    if (phase === "boarding_open" && (channel === "sound" || channel === "both")) playAlert("boarding", alertVolume);
    loadIt().catch(() => undefined);
  }, [phase, channel, alertVolume, loadIt]);

  // Notifications are scheduled locally from the server's plan and rescheduled on every re-fetch.
  useEffect(() => {
    if (!itinerary) return;
    return scheduleItineraryNotifications(itinerary, channel, sessionRef.current.now(), timeZone);
  }, [itinerary, channel, timeZone]);

  // Heartbeats keep layover focus attended (FR-013a): every 60 s and when the tab becomes visible.
  const focusing = data?.layover?.focus?.focusing ?? false;
  useEffect(() => {
    if (!focusing) return;
    const beat = () =>
      api
        .layoverHeartbeat(id)
        .then((res) => setData(res))
        // flight_in_progress / outside_layover: the layover view explains what changed.
        .catch(() => loadLayover().catch(() => undefined));
    const t = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [focusing, id, loadLayover]);

  const run = async (fn: () => Promise<LayoverResponse>) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await fn());
      loadIt().catch(() => undefined);
    } catch (e) {
      setActionError(itineraryErrorMessage(e));
      loadLayover().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const footer = <p className="terminal-footer small muted">Virtual terminal on a real schedule.</p>;
  const frame = (children: ReactNode) => (
    <div className="terminal">
      <header className="terminal-header">
        <h1 className="display terminal-title">Terminal</h1>
        <div className="terminal-meta">
          <LocalClock seconds />
        </div>
      </header>
      {children}
      {footer}
    </div>
  );

  if (itinerary === undefined || (itinerary && !data && !error)) {
    return (
      <div className="terminal terminal-loading">
        <Skeleton lines={4} />
      </div>
    );
  }

  if (session.mode !== "user") {
    return frame(
      <Empty
        title="Sign in to see your journey"
        action={
          <Button variant="primary" to="/account/sign-in">
            Sign in
          </Button>
        }
      >
        Connecting flights and layovers are kept with your account.
      </Empty>,
    );
  }

  if (itinerary === null) {
    return frame(
      <Empty
        title="We couldn't find that journey"
        action={
          <div className="terminal-empty-actions">
            <Button variant="primary" to="/fly/bookings">
              My bookings
            </Button>
            <Button to="/">Dashboard</Button>
          </div>
        }
      >
        It may have been removed, or it belongs to another account.
      </Empty>,
    );
  }

  const journeyHref = `/fly/journey/${itinerary.id}`;

  if (!data) {
    return frame(
      <>
        <Notice tone="danger">{error}</Notice>
        <div className="terminal-empty-actions">
          <Button variant="primary" onClick={() => loadLayover().catch((e) => setError(itineraryErrorMessage(e)))}>
            Try again
          </Button>
          <Button to={journeyHref}>View journey</Button>
        </div>
      </>,
    );
  }

  const layover = data.layover;
  if (!layover) {
    return frame(
      <Empty
        title="No layover right now"
        action={
          <div className="terminal-empty-actions">
            <Button variant="primary" to={journeyHref}>
              View journey
            </Button>
            <Button to="/">Dashboard</Button>
          </div>
        }
      >
        The terminal opens once a leg of this journey has been boarded and the next one is still to come.
      </Empty>,
    );
  }

  const legs = itinerary.legs;
  const nextLeg = legs[layover.afterLegIndex + 1];
  const nextFlight = nextLeg?.boardingPass.flightNumber ?? "your connection";
  const nextCity = nextLeg?.boardingPass.destination.city ?? itinerary.destination.city;
  const msTo = (t: DisplayTime) => Math.max(0, t.epochMs - now);
  const airport = layover.airport;
  const focus = layover.focus;
  const showFocus = FOCUS_PHASES.has(layover.phase);

  let hero: ReactNode;
  switch (layover.phase) {
    case "not_started":
      hero = <GateCountdown label="Landing in" ms={msTo(layover.startsAt)} sub="Your arriving flight hasn't landed yet" />;
      break;
    case "deplaning":
      hero = (
        <>
          <GateCountdown label="Validate your arrival within" ms={msTo(layover.deplaningEndsAt)} tone="amber" sub={`${legLabel(layover.afterLegIndex, legs.length)} earns its credit once you validate`} />
          <div className="terminal-hero-actions">
            <Button variant="primary" size="lg" to="/fly/arrival">
              Validate arrival
            </Button>
          </div>
        </>
      );
      break;
    case "in_terminal":
      hero = <GateCountdown label="Boarding opens in" ms={msTo(layover.boardingOpensAt)} sub={`Gate for ${nextFlight}`} />;
      break;
    case "boarding_open": {
      const ms = msTo(layover.boardingClosesAt);
      hero = (
        <>
          <GateCountdown label="Boarding closes in" ms={ms} tone={ms < CLOSING_SOON_MS ? "amber" : "signal"} sub={`${nextFlight} to ${nextCity}`} />
          <div className="terminal-hero-actions">
            <Button variant="primary" size="lg" to={`/fly/boarding/${layover.nextBookingId}`}>
              Board {nextFlight}
            </Button>
          </div>
        </>
      );
      break;
    }
    case "missed":
      hero = (
        <>
          <Notice tone="danger">You missed this connection. Completed legs keep their credit.</Notice>
          <div className="terminal-hero-actions">
            <Button variant="primary" to={journeyHref}>
              Rebook
            </Button>
            <Button to={journeyHref}>View journey</Button>
          </div>
        </>
      );
      break;
    case "departed":
      hero = (
        <>
          <Notice tone="signal">You're aboard.</Notice>
          <div className="terminal-hero-actions">
            <Button variant="primary" to="/fly/active">
              Return to your flight
            </Button>
          </div>
        </>
      );
      break;
    case "cancelled":
      hero = (
        <>
          <Notice>This connection was cancelled.</Notice>
          <div className="terminal-hero-actions">
            <Button to={journeyHref}>View journey</Button>
          </div>
        </>
      );
      break;
  }

  return (
    <div className="terminal">
      <header className="terminal-header">
        <div className="terminal-airport">
          <span className="code terminal-code">{airport.iata}</span>
          <div className="terminal-airport-text">
            <h1 className="display terminal-title">{airport.name}</h1>
            <p className="terminal-city">{airport.city}</p>
          </div>
        </div>
        <div className="terminal-meta">
          <LocalClock seconds />
          <div className="terminal-facts numeral">
            <span>Layover {formatDuration(layover.layoverMs)}</span>
            <span>
              {legLabel(layover.afterLegIndex + 1, legs.length)} departs {formatClock(layover.departsAt, timeZone)}
            </span>
          </div>
          <Link to={journeyHref} className="terminal-journey-link">
            View journey
          </Link>
        </div>
      </header>

      {/* Polite region: the phase label announces changes; the countdown itself is aria-live="off". */}
      <section className="terminal-hero" aria-live="polite" aria-labelledby="terminal-phase">
        <p id="terminal-phase" className="terminal-phase">
          <Badge tone={PHASE_TONE[layover.phase]} icon="layover">
            {LAYOVER_PHASE_LABELS[layover.phase]}
          </Badge>
        </p>
        {hero}
      </section>

      {error && <Notice tone="amber">{error}</Notice>}
      {actionError && (
        <Notice tone="danger">
          <span>{actionError}</span>
          <Button size="sm" variant="quiet" onClick={() => setActionError(null)}>
            Dismiss
          </Button>
        </Notice>
      )}

      <section className="terminal-section" aria-labelledby="departures-title">
        <h2 id="departures-title">Departures</h2>
        <DeparturesBoard departures={data.departures} timeZone={timeZone} />
      </section>

      <div className="terminal-grid">
        {/* Lounges are presentation only and never locked by progression (FR-066). */}
        <section className={`terminal-panel terminal-lounge ${layover.lounge.premium ? "is-premium" : ""}`} aria-labelledby="lounge-title">
          <h2 id="lounge-title">{layover.lounge.premium ? "Premium lounge" : "Terminal seating"}</h2>
          {layover.lounge.premium ? (
            <>
              <Badge tone="premium" icon="sun">
                Lounge access
              </Badge>
              <p>Quiet seating, a long table and good light. Your cabin on this journey gives you access.</p>
            </>
          ) : (
            <p>A seat by the gate with the board in view. Settle in; the countdown above keeps time for you.</p>
          )}
        </section>

        {showFocus && (
          <section className="terminal-panel terminal-focus" aria-labelledby="focus-title">
            <h2 id="focus-title">Layover focus</h2>
            <div className="terminal-focus-row">
              <Badge tone={focusing ? "signal" : "neutral"}>{focusing ? "Focus on" : focus?.final ? "Credit final" : "Not running"}</Badge>
              <span className="terminal-counter numeral">
                <span className="muted small">Focused</span>
                {formatDuration(focus?.focusMs ?? 0)}
              </span>
              <span className="terminal-counter numeral">
                <span className="muted small">Credited</span>
                {formatDuration(focus?.creditedMs ?? 0)}
              </span>
              <span className="terminal-counter numeral">
                <span className="muted small">Unattended spans</span>
                {focus?.unattended.length ?? 0}
              </span>
            </div>
            {!focus?.final && (
              <div className="terminal-focus-actions">
                {focusing ? (
                  <Button variant="secondary" icon={<Icon name="pause" />} busy={busy} onClick={() => void run(() => api.stopLayoverFocus(id))}>
                    Stop focusing
                  </Button>
                ) : (
                  <Button variant="primary" icon={<Icon name="play" />} busy={busy} onClick={() => void run(() => api.startLayoverFocus(id))}>
                    Start focusing
                  </Button>
                )}
              </div>
            )}
            <p className="small muted">Only attended time inside the layover counts, and never while a flight is in the air.</p>
          </section>
        )}
      </div>

      {footer}
    </div>
  );
}
