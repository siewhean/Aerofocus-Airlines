/**
 * Confirm a connecting journey (docs/UI-PLAN.md Phase 7 item 3). Loads every leg's snapshot via
 * the plan endpoint, previews planned times with core `itineraryPlannedTimes`, and books through
 * `api.bookItinerary`. Signed-in only: the server refuses itineraries for guests.
 */
import {
  bookingWindowEnd,
  DEFAULT_BREAK_SCHEDULE,
  localParts,
  loungeAccess,
  offeredCabins,
  zonedToInstant,
  type BreakSchedule,
  type CabinClass,
  type ItineraryLegPlan,
  type ItineraryMode,
  type UnlockState,
} from "@aerofocus/core";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Page } from "../app/Shell";
import { BreakScheduleFields } from "../components/BreakScheduleFields";
import { JourneyChain, type ChainLayover, type ChainLeg } from "../components/JourneyChain";
import { RouteMap } from "../components/RouteMap";
import { api, errorMessage } from "../lib/api";
import { apiExt, type AirlineView, type FlightPlanFull } from "../lib/api-ext";
import { airportView } from "../lib/flights";
import { cabinLabel, formatClock, formatDateTime, formatDuration, formatRelativeDay } from "../lib/format";
import { itineraryErrorMessage, legErrors, parseLegsParam, plannedLegsPreview, rememberOpenItinerary } from "../lib/itineraries";
import { useSession } from "../lib/session";
import { Button, Facts, Field, LockedBadge, Notice, SampleBadge, Section, Skeleton, Textarea } from "../ui";
import "./BookJourney.css";

const GOAL_MAX = 500;
const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInput(instant: number, tz: string): string {
  const p = localParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
function fromLocalInput(value: string, tz: string): number | null {
  const [date, time] = value.split("T");
  if (!date || !time) return null;
  try {
    const t = zonedToInstant(date, time.slice(0, 5), tz);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}
const numParam = (v: string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface Loaded {
  legs: FlightPlanFull[];
  airlines: AirlineView[];
  unlocks: UnlockState;
}

export default function BookJourney() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tz = session.timeZone;

  const mode: ItineraryMode = params.get("mode") === "individual" ? "individual" : "community";
  const legsParamValue = params.get("legs");
  const requested = useMemo(() => parseLegsParam(legsParamValue), [legsParamValue]);
  const departureParam = numParam(params.get("departure"));
  const rebookedFromId = params.get("rebookedFrom");
  const studyWindow = useMemo(() => {
    const start = numParam(params.get("start"));
    const end = numParam(params.get("end"));
    return start !== null && end !== null && end > start ? { start, end } : null;
  }, [params]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [now, setNow] = useState(() => session.now());
  useEffect(() => {
    const id = setInterval(() => setNow(session.now()), 30_000);
    return () => clearInterval(id);
  }, [session]);

  const [departNow, setDepartNow] = useState(departureParam === null);
  const [chosenDeparture, setChosenDeparture] = useState<number | null>(departureParam);
  const [cabins, setCabins] = useState<CabinClass[]>(() => requested.map((l) => l.cabin));
  const [goal, setGoal] = useState("");
  const [breaks, setBreaks] = useState<BreakSchedule>(session.settings?.breakSchedule ?? session.rules?.defaultBreakSchedule ?? DEFAULT_BREAK_SCHEDULE);
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [legErrs, setLegErrs] = useState<Map<number, string>>(new Map());

  const snapshotKey = requested.map((l) => l.snapshotId).join(",");

  useEffect(() => {
    if (requested.length === 0) {
      setLoadError("No flights were chosen for this journey.");
      return;
    }
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    (async () => {
      try {
        const [legs, airlines, unlocks] = await Promise.all([
          Promise.all(requested.map((l) => apiExt.flightPlanFull(l.snapshotId, undefined, tz))),
          apiExt.airlines(),
          session.mode === "user" ? apiExt.progression().then((p) => p.unlocks) : Promise.resolve(session.guest.unlocks()),
        ]);
        if (cancelled) return;
        setLoaded({ legs, airlines: airlines.airlines, unlocks });
        // Keep the requested cabin where it is offered and unlocked; otherwise the first unlocked one.
        setCabins(
          legs.map((full, i) => {
            const offered = offeredCabins(full.snapshot);
            const wanted = requested[i]?.cabin;
            if (wanted && offered.includes(wanted) && unlocks.cabinClasses.includes(wanted)) return wanted;
            return offered.find((c) => unlocks.cabinClasses.includes(c)) ?? offered[0] ?? "economy";
          }),
        );
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey, tz, session.mode]);

  useEffect(() => {
    const preset = session.settings?.breakSchedule ?? session.rules?.defaultBreakSchedule;
    if (preset) setBreaks(preset);
  }, [session.settings?.breakSchedule, session.rules?.defaultBreakSchedule]);

  const snapshots = useMemo(() => loaded?.legs.map((l) => l.snapshot) ?? [], [loaded]);
  const windowDays = session.rules?.bookingWindowDays ?? null;
  const windowEnd = windowDays !== null ? bookingWindowEnd(now, tz) : null;
  const effectiveDeparture = mode === "individual" && !departNow ? chosenDeparture : null;

  const plans: ItineraryLegPlan[] | null = useMemo(() => {
    if (snapshots.length === 0) return null;
    try {
      return plannedLegsPreview(snapshots, mode, now, effectiveDeparture);
    } catch {
      return null;
    }
  }, [snapshots, mode, now, effectiveDeparture]);

  const chain = useMemo((): { legs: ChainLeg[]; layovers: ChainLayover[] } | null => {
    if (!loaded || !plans) return null;
    const legs: ChainLeg[] = loaded.legs.map((full, i) => {
      const s = full.snapshot;
      const plan = plans[i];
      const airline = loaded.airlines.find((a) => a.iata === s.operatingAirline);
      const dep = plan?.departure ?? s.departure;
      const arr = plan?.arrival ?? s.arrival;
      const mk = (t: number) => ({ epochMs: t, utc: new Date(t).toISOString(), local: "", timeZone: tz });
      return {
        origin: airportView(s.origin),
        destination: airportView(s.destination),
        flightNumber: `${s.operatingAirline}${s.flightNumber}`,
        airline: airline?.name ?? s.operatingAirline,
        departure: mk(dep),
        arrival: mk(arr),
        cabin: cabins[i],
        locked: (airline?.tier ?? 0) > loaded.unlocks.airlineTier,
      };
    });
    const layovers: ChainLayover[] = [];
    for (let i = 0; i < loaded.legs.length - 1; i++) {
      const a = plans[i];
      const b = plans[i + 1];
      const hub = loaded.legs[i]?.snapshot.destination;
      if (!a || !b || !hub) continue;
      layovers.push({
        afterLegIndex: i,
        airport: airportView(hub),
        layoverMs: b.departure - a.arrival,
        lounge: loungeAccess(cabins[i] ?? "economy", cabins[i + 1] ?? "economy"),
      });
    }
    return { legs, layovers };
  }, [loaded, plans, cabins, tz]);

  const presets = useMemo<BreakSchedule[]>(() => {
    const base = session.rules?.defaultBreakSchedule ?? DEFAULT_BREAK_SCHEDULE;
    return [
      { ...base, focusMinutes: 50, breakMinutes: 10 },
      { ...base, focusMinutes: 25, breakMinutes: 5 },
      { ...base, focusMinutes: 90, breakMinutes: 15 },
    ];
  }, [session.rules?.defaultBreakSchedule]);

  const first = plans?.[0];
  const last = plans?.[plans.length - 1];
  const anyAirlineLocked = chain?.legs.some((l) => l.locked) ?? false;
  const anyCabinLocked = loaded ? cabins.some((c) => !loaded.unlocks.cabinClasses.includes(c)) : false;
  const customMissing = mode === "individual" && !departNow && chosenDeparture === null;
  const isUser = session.mode === "user";
  const canBook = Boolean(loaded && plans && isUser && !anyAirlineLocked && !anyCabinLocked && !customMissing && !busy);

  async function submit() {
    if (!loaded || !canBook) return;
    setBusy(true);
    setBookError(null);
    setLegErrs(new Map());
    try {
      const res = await api.bookItinerary({
        mode,
        legs: loaded.legs.map((l, i) => ({ snapshotId: l.snapshot.id, cabin: cabins[i] ?? "economy" })),
        chosenDeparture: effectiveDeparture,
        studyWindow,
        studyGoal: goal.trim() ? goal.trim().slice(0, GOAL_MAX) : null,
        breakSchedule: breaks,
        rebookedFromId: rebookedFromId ?? null,
      });
      rememberOpenItinerary(res.itinerary.id);
      navigate(`/fly/journey/${encodeURIComponent(res.itinerary.id)}`);
    } catch (e) {
      setBookError(itineraryErrorMessage(e));
      setLegErrs(legErrors(e));
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Page title="Confirm your journey">
        <Notice tone="danger">{loadError}</Notice>
        <div>
          <Button to="/fly/search">Back to search</Button>
        </div>
      </Page>
    );
  }
  if (!loaded || !chain || !plans || !first || !last) {
    return (
      <Page title="Confirm your journey">
        <Skeleton lines={6} />
      </Page>
    );
  }

  const firstLeg = loaded.legs[0];
  const origin = chain.legs[0]?.origin;
  const destination = chain.legs[chain.legs.length - 1]?.destination;
  const connections = chain.legs.length - 1;
  const sample = loaded.legs.some((l) => l.snapshot.sourceStatus === "sample");

  return (
    <Page
      title="Confirm your journey"
      lead={
        origin && destination ? (
          <>
            {origin.city} to {destination.city}, {connections === 0 ? "direct" : `${connections} ${connections === 1 ? "connection" : "connections"}`}, {formatDuration(last.arrival - first.departure)} door to door.
          </>
        ) : undefined
      }
      aside={sample ? <SampleBadge dataSource="sample" /> : undefined}
    >
      {!isUser && (
        <Notice tone="amber">
          <span>
            Connecting flights need an account. <Link to="/account/sign-in">Create one</Link> to book this journey.
          </span>
        </Notice>
      )}
      {rebookedFromId && <Notice>This booking continues an earlier journey. Completed legs keep their focus credit, stamps and rewards.</Notice>}
      {anyAirlineLocked && (
        <Notice tone="amber">
          <LockedBadge what="An airline" /> One of these airlines unlocks at a higher level. Keep flying to reach it.
        </Notice>
      )}

      <div className="bj-grid">
        <form
          className="bj-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="bj-fieldset">
            <legend className="bj-legend">Departure</legend>
            {mode === "community" ? (
              <p className="bj-times">
                Every leg is a Community Flight at its published time. Departs <strong className="numeral">{formatDateTime(first.departure, tz)}</strong>.
              </p>
            ) : (
              <>
                <div className="choice-list">
                  <label className={`choice ${departNow ? "is-selected" : ""}`}>
                    <input type="radio" name="departure" value="now" checked={departNow} onChange={() => setDepartNow(true)} />
                    <span className="choice-text">
                      <span className="choice-label">Depart now</span>
                      <span className="choice-hint small muted">Leg 1 starts when the boarding sequence ends. Later legs follow the published layovers.</span>
                    </span>
                  </label>
                  <label className={`choice ${!departNow ? "is-selected" : ""}`}>
                    <input type="radio" name="departure" value="custom" checked={!departNow} onChange={() => setDepartNow(false)} />
                    <span className="choice-text">
                      <span className="choice-label">Choose a time</span>
                      <span className="choice-hint small muted">{windowDays !== null ? `Any time up to ${windowDays} days ahead.` : "Pick a time inside the booking window."}</span>
                    </span>
                  </label>
                </div>
                {!departNow && (
                  <Field label="Departure time" hint={`Times are shown in ${tz}.`} error={customMissing ? "Choose a departure time." : null}>
                    {(id, describedBy) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        className="control"
                        type="datetime-local"
                        required
                        value={chosenDeparture !== null ? toLocalInput(chosenDeparture, tz) : ""}
                        min={toLocalInput(now, tz)}
                        max={windowEnd !== null ? toLocalInput(windowEnd, tz) : undefined}
                        onChange={(e) => setChosenDeparture(fromLocalInput(e.target.value, tz))}
                      />
                    )}
                  </Field>
                )}
                <p className="bj-times" aria-live="polite">
                  Departs <strong className="numeral">{formatClock(first.departure, tz)}</strong> {formatRelativeDay(first.departure, now, tz)}, lands{" "}
                  <strong className="numeral">{formatClock(last.arrival, tz)}</strong> {formatRelativeDay(last.arrival, now, tz)}.
                </p>
              </>
            )}
          </fieldset>

          <fieldset className="bj-fieldset">
            <legend className="bj-legend">Cabins</legend>
            <div className="bj-legs">
              {loaded.legs.map((full, i) => {
                const s = full.snapshot;
                const offered = offeredCabins(s);
                const err = legErrs.get(i) ?? null;
                return (
                  <div key={s.id} className={`bj-leg ${err ? "has-error" : ""}`}>
                    <div className="bj-leg-head">
                      <span className="small muted">Leg {i + 1}</span>
                      <span className="code">
                        {s.origin} {s.destination}
                      </span>
                      <span className="small muted">
                        {s.operatingAirline}
                        {s.flightNumber}
                      </span>
                    </div>
                    <div className="cabin-list" role="group" aria-label={`Cabin for leg ${i + 1}`}>
                      {offered.map((c) => {
                        const locked = !loaded.unlocks.cabinClasses.includes(c);
                        const selected = cabins[i] === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            className={`cabin ${selected ? "is-selected" : ""}`}
                            aria-pressed={selected}
                            disabled={locked}
                            onClick={() => setCabins((prev) => prev.map((x, j) => (j === i ? c : x)))}
                          >
                            <span>{cabinLabel(c)}</span>
                            {locked && <LockedBadge what="This cabin" />}
                          </button>
                        );
                      })}
                    </div>
                    {s.cabinClasses === null && <p className="small muted">The source does not confirm cabin classes for this flight, so only Economy is offered.</p>}
                    {err && (
                      <p className="bj-leg-error small" role="alert">
                        {err}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <Field label="Study goal" hint={`Optional. You'll be asked at the end whether you reached it. ${goal.length}/${GOAL_MAX}`}>
            {(id, describedBy) => <Textarea id={id} aria-describedby={describedBy} maxLength={GOAL_MAX} rows={3} value={goal} placeholder="Finish the literature review" onChange={(e) => setGoal(e.target.value)} />}
          </Field>

          <fieldset className="bj-fieldset">
            <legend className="bj-legend">Breaks</legend>
            <BreakScheduleFields value={breaks} onChange={setBreaks} presets={presets} />
          </fieldset>

          {bookError && <Notice tone="danger">{bookError}</Notice>}

          <div className="bj-actions">
            <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!canBook} title={!isUser ? "Create an account to book connecting flights." : undefined}>
              {busy ? "Booking" : "Book journey"}
            </Button>
            <Button to="/fly/search">Back to search</Button>
          </div>
        </form>

        <aside className="bj-side">
          <Section title="Your journey">
            <JourneyChain legs={chain.legs} layovers={chain.layovers} timeZone={tz} />
            <Facts
              items={[
                { label: "Journey time", value: formatDuration(last.arrival - first.departure) },
                { label: "Connections", value: connections === 0 ? "Direct" : connections },
                { label: "Departs", value: formatDateTime(first.departure, tz) },
                { label: "Lands", value: formatDateTime(last.arrival, tz) },
              ]}
            />
          </Section>
          {firstLeg && (
            <Section title="First leg">
              <RouteMap plan={firstLeg.plan} geometry={firstLeg.geometry} now={now} timeZone={tz} inspect={false} snapshotId={firstLeg.snapshot.id} height={220} />
            </Section>
          )}
        </aside>
      </div>
    </Page>
  );
}
