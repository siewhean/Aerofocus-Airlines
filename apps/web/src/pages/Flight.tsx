/**
 * In-flight (/fly/active). Drives the flight as docs/API.md "How the UI should drive a flight"
 * describes: the clock comes from useFlightClock (never a bare timer), the session is polled every
 * 45 s and after every action, attendance is reported, prompts are surfaced, and the window is lit
 * from the scenery endpoint (users) or core lighting (guests).
 */
import { AttendanceReporter, type Itinerary } from "@aerofocus/client";
import { daylightEventsDuringFlight, describeLocation, routeFacts, routeGeometry, routeTimeline, windowLightingAt, windowSideOf, type LatLon } from "@aerofocus/core";
import { AIRPORTS } from "@aerofocus/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { CaptionStrip, useAnnouncements } from "../components/Announcements";
import { CabinFrame } from "../components/CabinFrame";
import { FlightPlan } from "../components/FlightPlan";
import { Countdown } from "../components/Countdown";
import { FlightControls } from "../components/FlightControls";
import { FocusPanel, FocusPill } from "../components/FocusPanel";
import { RouteMap } from "../components/RouteMap";
import { RouteTimeline } from "../components/RouteTimeline";
import { FlightIdent, RouteCodes } from "../components/RouteCodes";
import { Window } from "../components/Window";
import { errorMessage } from "../lib/api";
import type { SceneryResponse } from "../lib/api-ext";
import { CabinAudio } from "../lib/audio";
import { actOnFlight, loadActiveFlight, loadActiveLegContext, loadScenery, refreshFlight, type FlightAction, type FlightView, type LoadedFlight } from "../lib/flightSession";
import { legLabel } from "../lib/itineraries";
import { altitudeLabel, formatClock, phaseLabel } from "../lib/format";
import { notify, requestNotificationPermission } from "../lib/notify";
import { useSession } from "../lib/session";
import { isCoarsePointer, prefersReducedMotion, setTheme } from "../lib/theme";
import { useFlightClock } from "../lib/useFlightClock";
import { Badge, Button, Dialog, Empty, Notice, Skeleton, Toggle } from "../ui";
import "./Flight.css";

/** Set while a flight page is open in this tab. Absent on mount means the app was started from closed. */
const OPEN_FLAG = "aerofocus.flightOpen";

const POLL_MS = 45_000;
const SCENERY_MS = 60_000;

function coords(p: LatLon): string {
  const lat = `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? "E" : "W"}`;
  return `${lat} ${lon}`;
}

export default function Flight() {
  const session = useSession();
  const navigate = useNavigate();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [loaded, setLoaded] = useState<LoadedFlight | null | undefined>(undefined);
  const [view, setView] = useState<FlightView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenery, setScenery] = useState<SceneryResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [leg, setLeg] = useState<{ itinerary: Itinerary; legIndex: number } | null>(null);
  const audio = useRef<CabinAudio | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const plan = loaded?.plan ?? null;
  const { state, now } = useFlightClock(plan);
  const { prefs, updatePrefs, timeZone } = session;
  const mode = prefs.focusMode;
  const sessionId = loaded?.view.sessionId ?? null;
  const empty = loaded === null;
  const channel = session.settings?.notifications.channel ?? "sound";

  // Atmosphere: air while a flight is shown, ground for the empty state.
  useEffect(() => {
    const root = document.documentElement;
    if (empty) {
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
  }, [empty]);

  // Load (AC-10 restore).
  useEffect(() => {
    if (!session.ready) return;
    let cancelled = false;
    loadActiveFlight(sessionRef.current)
      .then((l) => {
        if (cancelled) return;
        setLoaded(l);
        setView(l?.view ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [session.ready, session.mode]);

  // Journey context (Phase 7): loaded once per pass that belongs to an itinerary.
  const itineraryId = view?.boardingPass.itineraryId ?? null;
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !itineraryId) {
      setLeg(null);
      return;
    }
    let cancelled = false;
    loadActiveLegContext(sessionRef.current, v)
      .then((l) => {
        if (!cancelled) setLeg(l);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itineraryId]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const v = await refreshFlight(sessionRef.current, sessionId);
    if (v) setView(v);
    else navigate("/fly/arrival", { replace: true });
  }, [sessionId, navigate]);

  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(() => refresh().catch(() => undefined), POLL_MS);
    return () => clearInterval(id);
  }, [sessionId, refresh]);

  const act = useCallback(
    async (action: FlightAction) => {
      if (!sessionId) return;
      setBusy(true);
      try {
        const v = await actOnFlight(sessionRef.current, sessionId, action);
        if (v) setView(v);
        else navigate("/fly/arrival", { replace: true });
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [sessionId, navigate],
  );

  // Attendance (FR-013a). `document` must be passed or mobile background/resume never fire.
  useEffect(() => {
    if (!sessionId) return;
    let reopened = false;
    try {
      reopened = sessionStorage.getItem(OPEN_FLAG) === null;
      sessionStorage.setItem(OPEN_FLAG, sessionId);
    } catch {
      /* storage unavailable: treat as a warm start */
    }
    const reporter = new AttendanceReporter({
      send: (kind) =>
        actOnFlight(sessionRef.current, sessionId, { type: "heartbeat", kind })
          .then((v) => {
            if (v) setView(v);
          })
          .catch(() => undefined),
      platform: isCoarsePointer() ? "mobile" : "desktop",
      reopened,
      document,
    });
    reporter.start();
    return () => reporter.stop();
  }, [sessionId]);

  // Scenery for signed-in users (FR-022/023); guests light the window locally below.
  useEffect(() => {
    if (!sessionId || sessionRef.current.mode !== "user") return;
    let cancelled = false;
    const load = () =>
      loadScenery(sessionRef.current, sessionId)
        .then((s) => {
          if (!cancelled && s) setScenery(s);
        })
        .catch(() => undefined);
    load();
    const id = setInterval(load, SCENERY_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId]);

  // Landed locally: fetch the server's view right away so the validate prompt appears without waiting for the poll.
  const arrivedHandled = useRef(false);
  useEffect(() => {
    if (state?.status === "arrived" && !arrivedHandled.current) {
      arrivedHandled.current = true;
      refresh().catch(() => undefined);
    }
  }, [state?.status, refresh]);

  // Prompts and outcomes (docs/API.md steps 3 and 4).
  const breakNotified = useRef(false);
  const landingNotified = useRef(false);
  useEffect(() => {
    if (!view) return;
    const { prompt, outcome } = view.focus;
    const city = view.boardingPass.destination.city;
    if (prompt === "confirm_back") {
      if (!breakNotified.current) {
        breakNotified.current = true;
        notify(channel, "break", "Break's over", "Tell us when you're back so focus can resume.", prefs.audio.notifications);
      }
    } else {
      breakNotified.current = false;
    }
    if (prompt === "validate" || outcome === "awaiting_validation") {
      if (!landingNotified.current) {
        landingNotified.current = true;
        notify(channel, "landing", `Welcome to ${city}`, "Validate your arrival within 10 minutes.", prefs.audio.notifications);
      }
      navigate("/fly/arrival", { replace: true });
      return;
    }
    if (outcome === "complete" || outcome === "invalid" || outcome === "ended_early") navigate("/fly/arrival", { replace: true });
  }, [view, channel, navigate, prefs.audio.notifications]);

  useEffect(() => {
    if (channel === "push" || channel === "both") requestNotificationPermission().catch(() => undefined);
  }, [channel]);

  // Cabin audio (FR-037): created once, started only from a user gesture.
  useEffect(() => {
    audio.current ??= new CabinAudio(prefs.audio);
    return () => {
      audio.current?.stop().catch(() => undefined);
      audio.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    audio.current?.apply(prefs.audio);
  }, [prefs.audio]);
  const phase = state?.phase ?? null;
  useEffect(() => {
    audio.current?.setPhase(phase);
  }, [phase]);
  const toggleAudio = useCallback(async () => {
    const a = audio.current;
    if (!a) return;
    if (a.running) {
      await a.stop();
      setAudioOn(false);
    } else {
      await a.start();
      setAudioOn(a.running);
    }
  }, []);

  const [cabinLog, setCabinLog] = useState<{ at: number; text: string }[]>([]);
  const caption = useAnnouncements({
    enabled: Boolean(view && state),
    phase,
    focusState: view?.focus.state ?? null,
    destinationCity: view?.boardingPass.destination.city ?? "",
    mode: prefs.announcements,
    audio,
    voiceVolume: prefs.audio.muted ? 0 : prefs.audio.voice * prefs.audio.master,
    chimeVolume: prefs.audio.notifications,
  });

  // Window lighting: scenery when we have it, core lighting otherwise (guests always).
  const seatSide = view ? windowSideOf(view.boardingPass.seat) : null;
  const localLighting = useMemo(() => (plan && state ? windowLightingAt(plan, now, seatSide) : null), [plan, state, now, seatSide]);
  const lighting = scenery?.window ?? localLighting;
  const placeLabel = useMemo(() => {
    if (scenery) return scenery.scenery.placeLabel;
    if (!state) return null;
    return describeLocation(state.position, AIRPORTS) ?? coords(state.position);
  }, [scenery, state]);

  useEffect(() => {
    if (!caption) return;
    setCabinLog((log) => (log[log.length - 1]?.text === caption ? log : [...log.slice(-19), { at: sessionRef.current.now(), text: caption }]));
  }, [caption]);

  // Route map mode: users have the server geometry; guests compute it once per plan.
  const routeData = useMemo(() => {
    if (mode !== "map" || !plan) return null;
    const facts = routeFacts(plan);
    if (loaded?.route) {
      return { geometry: loaded.route.geometry, timeline: loaded.route.timeline, facts, daylightEvents: loaded.route.daylightEvents.map((e) => ({ type: e.type, instant: e.instant })) };
    }
    return {
      geometry: routeGeometry(plan),
      timeline: routeTimeline(plan, timeZone, { describe: (p) => describeLocation(p, AIRPORTS) }),
      facts,
      daylightEvents: daylightEventsDuringFlight(plan).map((e) => ({ type: e.type, instant: e.instant })),
    };
  }, [mode, plan, loaded?.route, timeZone]);

  if (loaded === undefined) {
    return (
      <div className="flight flight-loading">
        <Skeleton lines={4} />
      </div>
    );
  }

  if (loaded === null || !view) {
    return (
      <Page title="Flight">
        {error && <Notice tone="danger">{error}</Notice>}
        <Empty
          title="No flight in progress"
          action={
            <div className="flight-empty-actions">
              <Button variant="primary" to="/fly/search">
                Find a flight
              </Button>
              <Button to="/fly/bookings">My bookings</Button>
            </div>
          }
        >
          Book a flight that fits your study time, then board when the gate opens.
        </Empty>
      </Page>
    );
  }

  const pass = view.boardingPass;
  const reduced = prefs.lighting.reducedEffects || prefersReducedMotion();
  const windowProps = {
    lighting,
    phase,
    altitudeFt: state?.altitudeFt ?? 0,
    clouds: scenery?.scenery.clouds ?? null,
    surface: scenery?.scenery.surface ?? null,
    readingLight: prefs.lighting.readingLight,
    cabinBrightness: prefs.lighting.cabinBrightness,
    reducedEffects: reduced,
    placeLabel,
  };

  const header = (
    <header className="flight-header">
      <div className="flight-ident-row">
        <FlightIdent flightNumber={pass.flightNumber} airline={pass.airline.name} />
        <RouteCodes origin={pass.origin} destination={pass.destination} cities />
      </div>
      <div className="flight-header-aside">
        {leg && (
          <div className="flight-journey">
            <Badge tone="geo">{legLabel(leg.legIndex, leg.itinerary.legs.length)}</Badge>
            {leg.legIndex < leg.itinerary.legs.length - 1 && (
              <span className="flight-journey-line small muted">
                Connecting at {pass.destination.city}; journey ends in {leg.itinerary.destination.city}
              </span>
            )}
            <Button variant="quiet" size="sm" to={`/fly/journey/${leg.itinerary.id}`}>
              Journey
            </Button>
          </div>
        )}
        {pass.flightType === "community" ? (
          <Badge tone="geo" icon="community">
            Community Flight
          </Badge>
        ) : (
          <div className="flight-share">
            <Toggle label="Share my flight" checked={view.isPublic} onChange={(isPublic) => act({ type: "set_visibility", isPublic })} hint="Others see only your route and position, never your name." disabled={busy} />
          </div>
        )}
      </div>
    </header>
  );

  const status = state && (
    <div className="flight-status">
      <Countdown remainingMs={state.remainingMs} />
      <div className="flight-line">
        <span>{phaseLabel(state.phase)}</span>
        <span className="numeral">{altitudeLabel(state.altitudeFt)}</span>
      </div>
      {placeLabel && <div className="flight-place muted">{placeLabel}</div>}
      <div className="flight-lands muted">
        Lands at <span className="numeral">{formatClock(view.flight.arrival, timeZone)}</span>
      </div>
      <div className="flight-progress" role="progressbar" aria-label="Flight progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.timeProgress * 100)}>
        <div className="flight-progress-fill" style={{ width: `${state.timeProgress * 100}%` }} />
        <div className="flight-progress-distance" style={{ left: `${state.distanceFraction * 100}%` }} title="Distance covered" />
      </div>
    </div>
  );

  const focusPanel = <FocusPanel view={view} timeZone={timeZone} busy={busy} onBreakStart={() => act({ type: "break_start" })} onBreakEnd={() => act({ type: "break_end" })} />;

  const controls = (
    <FlightControls prefs={prefs} updatePrefs={updatePrefs} audioOn={audioOn} onAudioToggle={() => toggleAudio().catch(() => undefined)} onLeave={() => act({ type: "exit" })} busy={busy} tiny={mode === "minimal"} />
  );

  const footer = <p className="flight-footer small muted">Virtual journey on a real schedule. You are not aboard the real aircraft.</p>;

  const prompts = (
    <>
      <CaptionStrip caption={caption} />
      {error && (
        <div className="flight-error">
          <Notice tone="danger">
            <span>{error}</span>
            <Button size="sm" variant="quiet" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </Notice>
        </div>
      )}
      <Dialog
        open={view.focus.prompt === "confirm_back"}
        onClose={() => undefined}
        blocking
        title="Break's over. Are you back?"
        footer={
          <Button variant="primary" busy={busy} onClick={() => act({ type: "back" })}>
            I'm back
          </Button>
        }
      >
        <p>Focus resumes when you confirm. Time until then counts as waiting, not focus.</p>
      </Dialog>
    </>
  );

  if (mode === "ambient") {
    return (
      <div className="flight flight-mode-ambient">
        <div className="flight-window-full">
          <Window {...windowProps} size="full" />
        </div>
        {state && (
          <div className="flight-ambient-overlay">
            <Countdown remainingMs={state.remainingMs} />
            <div className="flight-ambient-pill">
              <FocusPill state={view.focus.state} />
            </div>
          </div>
        )}
        {controls}
        {prompts}
      </div>
    );
  }

  if (mode === "minimal") {
    return (
      <div className="flight flight-mode-minimal">
        <div className="flight-minimal-body">
          {state && <Countdown remainingMs={state.remainingMs} />}
          <FocusPill state={view.focus.state} />
          {controls}
        </div>
        {prompts}
      </div>
    );
  }

  if (mode === "compact") {
    return (
      <div className="flight flight-mode-compact">
        {header}
        <div className="flight-main">
          <CabinFrame readingLight={prefs.lighting.readingLight} cabinBrightness={prefs.lighting.cabinBrightness} cabin={view.boardingPass.cabin} side={seatSide ?? "left"} className="flight-cabin flight-cabin-mini">
            <Window {...windowProps} size="mini" />
          </CabinFrame>
          {status}
        </div>
        {focusPanel}
        {footer}
        {controls}
        {prompts}
      </div>
    );
  }

  return (
    <div className={`flight flight-mode-${mode}`}>
      {header}
      <div className="flight-main">
        <CabinFrame readingLight={prefs.lighting.readingLight} cabinBrightness={prefs.lighting.cabinBrightness} cabin={view.boardingPass.cabin} side={seatSide ?? "left"} className="flight-cabin">
          <Window {...windowProps} size="panel" className="flight-window" />
        </CabinFrame>
        {mode === "map" && routeData && plan ? (
          <div className="flight-map">
            {status}
            {/* Inspection runs locally and never touches the live flight (FR-017, FR-019). */}
            <RouteMap plan={plan} geometry={routeData.geometry} now={now} timeZone={timeZone} inspect sessionId={sessionRef.current.mode === "user" ? sessionId : null} height={360} />
            <RouteTimeline entries={routeData.timeline} timeZone={timeZone} activeOffsetMs={state?.elapsedMs} />
            <FlightPlan plan={plan} state={state} timeline={routeData.timeline} daylightEvents={routeData.daylightEvents} timeZone={timeZone} announcements={cabinLog} />
          </div>
        ) : (
          status
        )}
      </div>
      {focusPanel}
      {footer}
      {controls}
      {prompts}
    </div>
  );
}
