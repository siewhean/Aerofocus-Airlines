/**
 * Confirm a flight (PRD §4, FR-008). Loads the snapshot via the plan endpoint (there is no
 * "offer by id"), previews departure and arrival with core `plannedTimes` / `fitsStudyWindow`
 * (booking.ts:41-66), and books through lib/flights for either session mode.
 */
import type { Offer } from "@aerofocus/client";
import {
  bookingWindowEnd,
  DAY,
  DEFAULT_BREAK_SCHEDULE,
  MINUTE,
  displayTime,
  fitsStudyWindow,
  localParts,
  offeredCabins,
  plannedTimes,
  zonedToInstant,
  type BreakSchedule,
  type CabinClass,
  type DepartureMode,
  type UnlockState,
} from "@aerofocus/core";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Page } from "../app/Shell";
import { BreakScheduleFields } from "../components/BreakScheduleFields";
import { RouteMap } from "../components/RouteMap";
import { RoutePreview } from "../components/RoutePreview";
import { errorMessage } from "../lib/api";
import { apiExt, type AirlineView, type FlightPlanFull } from "../lib/api-ext";
import { aircraftView, airportView, bookFlight } from "../lib/flights";
import { cabinLabel, formatClock, formatDateTime, formatDuration, formatRelativeDay, modeLabel } from "../lib/format";
import { useSession } from "../lib/session";
import { Button, Facts, Field, LockedBadge, Notice, SampleBadge, Section, Skeleton, Textarea } from "../ui";
import "./Book.css";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" in the user's zone, for datetime-local. */
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
const isMode = (v: string | null): v is DepartureMode => v === "community" || v === "depart_now" || v === "custom";

interface Loaded {
  full: FlightPlanFull;
  airline: AirlineView | null;
  unlocks: UnlockState;
}

export default function Book() {
  const session = useSession();
  const navigate = useNavigate();
  const { snapshotId = "" } = useParams();
  const [params] = useSearchParams();
  const tz = session.timeZone;

  const modeParam = params.get("mode");
  const departureParam = numParam(params.get("departure"));
  const cabinParam = params.get("cabin");
  const studyWindow = useMemo(() => {
    const start = numParam(params.get("start"));
    const end = numParam(params.get("end"));
    return start !== null && end !== null && end > start ? { start, end } : null;
  }, [params]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FlightPlanFull | null>(null);

  const [now, setNow] = useState(() => session.now());
  useEffect(() => {
    const id = setInterval(() => setNow(session.now()), 30_000);
    return () => clearInterval(id);
  }, [session]);

  const [mode, setMode] = useState<DepartureMode>(isMode(modeParam) ? modeParam : "depart_now");
  const [chosenDeparture, setChosenDeparture] = useState<number | null>(modeParam === "custom" ? departureParam : null);
  const [cabin, setCabin] = useState<CabinClass>("economy");
  const [goal, setGoal] = useState("");
  const [breaks, setBreaks] = useState<BreakSchedule>(session.settings?.breakSchedule ?? session.rules?.defaultBreakSchedule ?? DEFAULT_BREAK_SCHEDULE);
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // Load snapshot, plan, airline and unlocks together.
  useEffect(() => {
    if (!snapshotId) return;
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    (async () => {
      try {
        const [full, airlines, unlocks] = await Promise.all([
          apiExt.flightPlanFull(snapshotId, departureParam ?? undefined, tz),
          apiExt.airlines(),
          session.mode === "user" ? apiExt.progression().then((p) => p.unlocks) : Promise.resolve(session.guest.unlocks()),
        ]);
        if (cancelled) return;
        const airline = airlines.airlines.find((a) => a.iata === full.snapshot.operatingAirline) ?? null;
        setLoaded({ full, airline, unlocks });
        setPreview(full);
        const cabins = offeredCabins(full.snapshot);
        const wanted = cabins.find((c) => c === cabinParam && unlocks.cabinClasses.includes(c));
        const first = cabins.find((c) => unlocks.cabinClasses.includes(c)) ?? cabins[0] ?? "economy";
        setCabin(wanted ?? first);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotId, departureParam, tz, cabinParam, session.mode, session.guest]);

  useEffect(() => {
    const preset = session.settings?.breakSchedule ?? session.rules?.defaultBreakSchedule;
    if (preset) setBreaks(preset);
  }, [session.settings?.breakSchedule, session.rules?.defaultBreakSchedule]);

  const snapshot = loaded?.full.snapshot ?? null;
  const windowDays = session.rules?.bookingWindowDays ?? null;
  // Core defines the window end as local midnight after today + N days (booking.ts:22-24).
  const windowEnd = windowDays !== null ? bookingWindowEnd(now, tz) : null;

  const communityAvailable = snapshot !== null && (modeParam === "community" || (snapshot.departure > now && (windowEnd === null || snapshot.departure < windowEnd)));

  // Fall back to depart_now if the preselected mode cannot be offered.
  useEffect(() => {
    if (!snapshot) return;
    if (mode === "community" && !communityAvailable) setMode("depart_now");
  }, [snapshot, mode, communityAvailable]);

  const planned = useMemo(() => {
    if (!snapshot) return null;
    try {
      return plannedTimes(mode, snapshot, { now, chosenDeparture });
    } catch {
      return null;
    }
  }, [snapshot, mode, now, chosenDeparture]);

  const fits = planned && studyWindow ? fitsStudyWindow(planned, studyWindow) : null;

  // Re-plan the preview when the planned departure moves (rounded to 5 minutes so the clock tick does not refetch).
  const previewKey = planned ? Math.floor(planned.departure / (5 * MINUTE)) : null;
  useEffect(() => {
    if (!loaded || !planned || previewKey === null) return;
    if (mode === "community") {
      setPreview(loaded.full);
      return;
    }
    let cancelled = false;
    apiExt
      .flightPlanFull(snapshotId, planned.departure, tz)
      .then((full) => {
        if (!cancelled) setPreview(full);
      })
      .catch(() => {
        /* keep the previous preview; booking still validates server-side */
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, mode, previewKey, snapshotId, tz]);

  const offer: Offer | null = useMemo(() => {
    if (!loaded || !snapshot) return null;
    const a = loaded.airline;
    const tier = a?.tier ?? 0;
    const cabins = offeredCabins(snapshot).map((c) => ({ cabin: c, locked: !loaded.unlocks.cabinClasses.includes(c) }));
    const locked = tier > loaded.unlocks.airlineTier;
    return {
      snapshotId: snapshot.id,
      mode,
      flightNumber: `${snapshot.operatingAirline}${snapshot.flightNumber}`,
      airline: { iata: snapshot.operatingAirline, name: a?.name ?? snapshot.operatingAirline, type: a?.type ?? "full_service", tier, locked },
      marketingAirline: snapshot.marketingAirline,
      origin: airportView(snapshot.origin),
      destination: airportView(snapshot.destination),
      aircraft: aircraftView(snapshot.aircraftType),
      operatingDate: snapshot.operatingDate,
      blockMs: snapshot.arrival - snapshot.departure,
      departure: displayTime(snapshot.departure, tz),
      arrival: displayTime(snapshot.arrival, tz),
      cabins,
      bookable: !locked,
      dataSource: snapshot.sourceStatus,
    };
  }, [loaded, snapshot, mode, tz]);

  const presets = useMemo<BreakSchedule[]>(() => {
    const base = session.rules?.defaultBreakSchedule ?? DEFAULT_BREAK_SCHEDULE;
    return [
      { ...base, focusMinutes: 50, breakMinutes: 10 },
      { ...base, focusMinutes: 25, breakMinutes: 5 },
      { ...base, focusMinutes: 90, breakMinutes: 15 },
    ];
  }, [session.rules?.defaultBreakSchedule]);

  const selectedCabinLocked = offer?.cabins.find((c) => c.cabin === cabin)?.locked ?? false;
  const customMissing = mode === "custom" && chosenDeparture === null;
  const canBook = Boolean(offer && planned && !offer.airline.locked && !selectedCabinLocked && !customMissing && !busy);

  async function submit() {
    if (!offer || !canBook) return;
    setBusy(true);
    setBookError(null);
    try {
      const pass = await bookFlight(session, {
        offer,
        mode,
        cabin,
        chosenDeparture: mode === "custom" ? chosenDeparture : null,
        // The server rejects a window the flight does not fit; book without it in that case (FR-006).
        studyWindow: fits === false ? null : studyWindow,
        studyGoal: goal.trim() ? goal.trim().slice(0, 140) : null,
        breakSchedule: breaks,
      });
      navigate(`/fly/pass/${encodeURIComponent(pass.bookingId)}`);
    } catch (e) {
      setBookError(errorMessage(e));
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Page title="Confirm your flight">
        <Notice tone="danger">{loadError}</Notice>
        <div>
          <Button to="/fly/search">Back to search</Button>
        </div>
      </Page>
    );
  }
  if (!loaded || !snapshot || !offer) {
    return (
      <Page title="Confirm your flight">
        <Skeleton lines={6} />
      </Page>
    );
  }

  const modeChoices: { mode: DepartureMode; label: string; hint: string }[] = [
    ...(communityAvailable ? [{ mode: "community" as const, label: modeLabel("community"), hint: `Departs at the published time, ${formatDateTime(snapshot.departure, tz)}, with everyone else on this flight.` }] : []),
    { mode: "depart_now", label: modeLabel("depart_now"), hint: "Your own flight. The clock starts when the boarding sequence ends." },
    { mode: "custom", label: modeLabel("custom"), hint: windowDays !== null ? `Pick any time up to ${windowDays} days ahead.` : "Pick a time inside the booking window." },
  ];

  const bookLabel = busy ? "Booking" : "Book flight";

  return (
    <Page
      title="Confirm your flight"
      lead={
        <>
          <span className="code">{offer.flightNumber}</span> {offer.origin.city} to {offer.destination.city}, {formatDuration(offer.blockMs)}.
        </>
      }
      aside={<SampleBadge dataSource={offer.dataSource} />}
    >
      {session.mode === "guest" && <Notice>You're flying as a guest. This booking is stored on this device only.</Notice>}
      {offer.airline.locked && (
        <Notice tone="amber">
          <LockedBadge what="This airline" /> {offer.airline.name} unlocks at a higher level. Keep flying to reach it.
        </Notice>
      )}

      <div className="book-grid">
        <form
          className="book-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="book-fieldset">
            <legend className="book-legend">Departure</legend>
            <div className="choice-list">
              {modeChoices.map((c) => (
                <label key={c.mode} className={`choice ${mode === c.mode ? "is-selected" : ""}`}>
                  <input type="radio" name="mode" value={c.mode} checked={mode === c.mode} onChange={() => setMode(c.mode)} />
                  <span className="choice-text">
                    <span className="choice-label">{c.label}</span>
                    <span className="choice-hint small muted">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {mode === "custom" && (
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
            {planned && (
              <p className="book-times" aria-live="polite">
                Departs <strong className="numeral">{formatClock(planned.departure, tz)}</strong> {formatRelativeDay(planned.departure, now, tz)}, lands{" "}
                <strong className="numeral">{formatClock(planned.arrival, tz)}</strong> {formatRelativeDay(planned.arrival, now, tz)}.
              </p>
            )}
            {fits === false && studyWindow && (
              <Notice tone="amber">
                This flight does not fit inside your study window ({formatClock(studyWindow.start, tz)} to {formatClock(studyWindow.end, tz)}). You can still book it.
              </Notice>
            )}
          </fieldset>

          <fieldset className="book-fieldset">
            <legend className="book-legend">Cabin</legend>
            <div className="cabin-list" role="group" aria-label="Cabin">
              {offer.cabins.map((c) => (
                <button
                  key={c.cabin}
                  type="button"
                  className={`cabin ${cabin === c.cabin ? "is-selected" : ""}`}
                  aria-pressed={cabin === c.cabin}
                  disabled={c.locked}
                  onClick={() => setCabin(c.cabin)}
                >
                  <span>{cabinLabel(c.cabin)}</span>
                  {c.locked && <LockedBadge what="This cabin" />}
                </button>
              ))}
            </div>
            {snapshot.cabinClasses === null && <p className="small muted">The source does not confirm cabin classes for this flight, so only Economy is offered.</p>}
          </fieldset>

          <Field label="Study goal" hint={`Optional. You'll be asked at arrival whether you reached it. ${goal.length}/140`}>
            {(id, describedBy) => <Textarea id={id} aria-describedby={describedBy} maxLength={140} rows={2} value={goal} placeholder="Finish chapter 3" onChange={(e) => setGoal(e.target.value)} />}
          </Field>

          <fieldset className="book-fieldset">
            <legend className="book-legend">Breaks</legend>
            <BreakScheduleFields value={breaks} onChange={setBreaks} presets={presets} />
          </fieldset>

          {bookError && <Notice tone="danger">{bookError}</Notice>}

          <div className="book-actions">
            <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!canBook}>
              {bookLabel}
            </Button>
            <Button to="/fly/search">Back to search</Button>
          </div>
        </form>

        <aside className="book-side">
          <Section title="Your flight">
            <Facts
              items={[
                { label: "Flight", value: <span className="code">{offer.flightNumber}</span> },
                { label: "Airline", value: offer.airline.name },
                {
                  label: "Route",
                  value: (
                    <span className="code">
                      {offer.origin.iata} {offer.destination.iata}
                    </span>
                  ),
                },
                { label: "Aircraft", value: offer.aircraft.known ? offer.aircraft.name : <span className="muted">Not confirmed</span> },
                { label: "Study time", value: formatDuration(offer.blockMs) },
                { label: "Cabin", value: cabinLabel(cabin) },
              ]}
            />
          </Section>
          <Section title="Route">
            {preview ? (
              <>
                <RouteMap plan={preview.plan} geometry={preview.geometry} now={now} timeZone={tz} inspect snapshotId={snapshotId ?? null} height={260} />
                <RoutePreview plan={preview.plan} geometry={preview.geometry} timeline={preview.timeline} facts={preview.facts} timeZone={tz} />
              </>
            ) : (
              <Skeleton lines={4} />
            )}
          </Section>
        </aside>
      </div>
    </Page>
  );
}
