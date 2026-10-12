import type { BoardingPass, Itinerary } from "@aerofocus/client";
import { levelFor, nextLevelProgress, type NextLevelProgress, type ProgressStats } from "@aerofocus/core";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { LocalClock, Page } from "../app/Shell";
import { passStatus } from "../components/BoardingPassCard";
import { ItineraryStatusBadge } from "../components/JourneyChain";
import { FlightIdent, RouteCodes } from "../components/RouteCodes";
import { api, errorMessage } from "../lib/api";
import { apiExt, type HistoryItem } from "../lib/api-ext";
import { airportView, hasActiveFlight, listBookings } from "../lib/flights";
import { formatClock, formatDate, formatDuration, formatHours, formatRelativeDay } from "../lib/format";
import { currentStep, findOpenItinerary, journeyCodes, type JourneyStep } from "../lib/itineraries";
import { useSession, writeLocal } from "../lib/session";
import { Badge, Board, Button, Cell, Empty, Facts, Field, Icon, Notice, Section, Select, Skeleton, useToast } from "../ui";
import "./Dashboard.css";

type RowStatus = "booked" | "boarding" | "boarded" | "other";

/** Same rules as the pass and bookings pages, so a lapsed booking never reads "Booked" here. */
function rowStatus(pass: BoardingPass, now: number): RowStatus {
  const s = passStatus(pass, now);
  if (s === "boarded") return "boarded";
  if (s === "boarding_open") return "boarding";
  if (s === "booked") return "booked";
  return "other";
}

interface Flying {
  stats: ProgressStats;
  levelName: string;
  next: NextLevelProgress | null;
  last: { flightNumber: string | null; airline: string; origin: string; destination: string; departure: number } | null;
}

/** The current step as one sentence plus its action (docs/UI-PLAN.md Phase 7 item 6). */
function journeyStepView(it: Itinerary, step: JourneyStep, now: number, tz: string): { sentence: string; label: string; to: string; primary: boolean } {
  const total = it.legs.length;
  const view = { label: "View journey", to: `/fly/journey/${encodeURIComponent(it.id)}`, primary: false };
  switch (step.kind) {
    case "board": {
      const n = step.legIndex + 1;
      if (now >= step.opensAt && now <= step.closesAt) {
        return { sentence: `Leg ${n} of ${total} is boarding until ${formatClock(step.closesAt, tz)}.`, label: `Board leg ${n}`, to: `/fly/boarding/${encodeURIComponent(step.bookingId)}`, primary: true };
      }
      return { ...view, sentence: `Leg ${n} of ${total} boards at ${formatClock(step.opensAt, tz)}.` };
    }
    case "in_flight":
      return { sentence: `Leg ${step.legIndex + 1} of ${total} is in the air.`, label: "Return to your flight", to: "/fly/active", primary: true };
    case "validate":
      return { sentence: `Leg ${step.legIndex + 1} of ${total} has landed. Validate your arrival.`, label: `Validate leg ${step.legIndex + 1}`, to: "/fly/arrival", primary: true };
    case "layover": {
      const hub = it.layovers.find((l) => l.afterLegIndex === step.legIndex)?.airport ?? it.currentAirport;
      const next = it.legs[step.legIndex + 1];
      const opens = next ? ` Boarding opens ${formatClock(next.boardingPass.boardingOpensAt, tz)}.` : "";
      return { sentence: `In the terminal at ${hub.city}.${opens}`, label: "Go to the terminal", to: `/fly/layover/${encodeURIComponent(it.id)}`, primary: true };
    }
    default:
      return { ...view, sentence: "Your journey is booked." };
  }
}

/** "3.5 more focus hours and 2 more flights" from the next level's missing requirement. */
function missingSentence(next: NextLevelProgress | null): string {
  if (!next) return "You have reached the top level.";
  const parts: string[] = [];
  const m = next.missing;
  if (m.focusHours > 0) parts.push(`${Math.ceil(m.focusHours * 10) / 10} more focus hours`);
  if (m.flights > 0) parts.push(`${m.flights} more ${m.flights === 1 ? "flight" : "flights"}`);
  if (m.countries > 0) parts.push(`${m.countries} more ${m.countries === 1 ? "country" : "countries"}`);
  if (m.specialAchievements > 0) parts.push(`${m.specialAchievements} more special ${m.specialAchievements === 1 ? "achievement" : "achievements"}`);
  return parts.length ? `${next.level.name}: ${parts.join(" and ")}.` : `${next.level.name}: ready on your next flight.`;
}

export default function Dashboard() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const tz = session.timeZone;

  const [bookings, setBookings] = useState<BoardingPass[] | null>(null);
  const [journey, setJourney] = useState<Itinerary | null>(null);
  const [active, setActive] = useState(false);
  const [flying, setFlying] = useState<Flying | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boarding, setBoarding] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Departures: bookings, active flight, progression. Guest data comes from the device store.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        // hasActiveFlight may finalize a landed guest flight; list bookings only after that.
        const hasActive = await hasActiveFlight(session);
        const list = await listBookings(session);
        if (cancelled) return;
        setBookings(list);
        setActive(hasActive);
        if (session.mode === "user") {
          const [prog, hist, openJourney] = await Promise.all([apiExt.progression(), apiExt.history(1), findOpenItinerary().catch(() => null)]);
          if (cancelled) return;
          setJourney(openJourney);
          const h: HistoryItem | undefined = hist.flights[0];
          setFlying({
            stats: prog.stats,
            levelName: prog.level.name,
            next: prog.next,
            last: h ? { flightNumber: h.flightNumber, airline: h.airline, origin: h.origin, destination: h.destination, departure: h.departure } : null,
          });
        } else {
          setJourney(null);
          const s = session.guest.stats(tz);
          const stats: ProgressStats = { creditedFocusMs: s.creditedFocusMs, completedFlights: s.completedFlights, countries: s.countriesCollected, specialAchievements: 0 };
          const history = session.guest.load().history;
          const h = history[history.length - 1];
          setFlying({
            stats,
            levelName: levelFor(stats).name,
            next: nextLevelProgress(stats),
            last: h ? { flightNumber: null, airline: h.airline, origin: h.origin, destination: h.destination, departure: h.departure } : null,
          });
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mode, session.guestState, tz]);

  // Re-evaluate boarding windows without refetching.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const onBoard = useCallback(
    async (bookingId: string) => {
      // The boarding page plays the sequence and boards at its end (FR-009).
      setBoarding(bookingId);
      navigate(`/fly/boarding/${encodeURIComponent(bookingId)}`);
    },
    [session, navigate, toast],
  );

  const home = session.homeAirport ? airportView(session.homeAirport) : null;
  const now = session.now();

  return (
    <Page
      title={
        home ? (
          <span className="dash-title">
            <span>{home.name}</span>
            <span className="code">{home.iata}</span>
          </span>
        ) : (
          "Departures"
        )
      }
      lead={home ? undefined : "Choose a home airport and searches will start from it."}
      aside={
        <div className="dash-clock">
          <LocalClock seconds />
          <span className="muted small">{tz}</span>
        </div>
      }
    >
      {!home && <HomeAirportPicker />}

      {active && (
        <div className="dash-actions">
          <Button variant="primary" size="lg" to="/fly/active">
            Return to your flight
          </Button>
        </div>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {journey && (
        <Section title="Your journey" aside={<ItineraryStatusBadge status={journey.status} />}>
          {(() => {
            const step = journeyStepView(journey, currentStep(journey, now), now, tz);
            const codes = journeyCodes(journey);
            return (
              <div className="dash-journey">
                <span className="dash-journey-codes" aria-label={codes.join(" to ")}>
                  {codes.map((c, i) => (
                    <span key={`${c}-${i}`} className="dash-journey-node">
                      {i > 0 && <Icon name="plane" size={16} className="dash-journey-plane" title="to" />}
                      <span className="code">{c}</span>
                    </span>
                  ))}
                </span>
                <p className="dash-journey-step">{step.sentence}</p>
                <div className="dash-journey-actions">
                  <Button variant={step.primary ? "primary" : "secondary"} to={step.to}>
                    {step.label}
                  </Button>
                  {step.primary && (
                    <Link to={`/fly/journey/${encodeURIComponent(journey.id)}`}>View journey</Link>
                  )}
                </div>
              </div>
            );
          })()}
        </Section>
      )}

      <Section title="Departures" aside={bookings && bookings.length > 0 ? `${bookings.length} ${bookings.length === 1 ? "flight" : "flights"}` : undefined}>
        {bookings === null ? (
          <Skeleton lines={3} />
        ) : bookings.length === 0 ? (
          <Empty title="No flights booked" action={<Button variant="primary" to="/fly/search">Find a flight</Button>}>
            Tell us when you can study and we'll find a flight that fits.
          </Empty>
        ) : (
          <Board caption="Your booked departures">
            <thead>
              <tr>
                <Cell head>Time</Cell>
                <Cell head>Flight</Cell>
                <Cell head>Route</Cell>
                <Cell head num>Duration</Cell>
                <Cell head>Type</Cell>
                <Cell head>Status</Cell>
                <Cell head>
                  <span className="visually-hidden">Action</span>
                </Cell>
              </tr>
            </thead>
            <tbody>
              {bookings.map((p) => {
                const status = rowStatus(p, now);
                return (
                  <tr key={p.bookingId}>
                    <Cell>
                      <span className="dash-time">
                        <span className="numeral">{formatClock(p.departure, tz)}</span>
                        <span className="muted small">{formatRelativeDay(p.departure, now, tz)}</span>
                      </span>
                    </Cell>
                    <Cell>
                      <span className="dash-flight">
                        <FlightIdent flightNumber={p.flightNumber} airline={p.airline.name} />
                        {p.itineraryId !== null && p.legIndex !== null && <Badge tone="geo">Leg {p.legIndex + 1}</Badge>}
                      </span>
                    </Cell>
                    <Cell>
                      <RouteCodes origin={p.origin} destination={p.destination} />
                    </Cell>
                    <Cell num>
                      <span className="numeral">{formatDuration(p.studyDurationMs)}</span>
                    </Cell>
                    <Cell>{p.flightType === "community" ? "Community Flight" : "Individual"}</Cell>
                    <Cell>
                      {status === "boarding" ? (
                        <Badge tone="signal">Boarding open</Badge>
                      ) : status === "boarded" ? (
                        <Badge tone="geo">Boarded</Badge>
                      ) : status === "booked" ? (
                        <Badge>Booked</Badge>
                      ) : (
                        <Badge tone="amber">{p.status === "no_show" ? "Missed" : "Cancelled"}</Badge>
                      )}
                    </Cell>
                    <Cell num>
                      {status === "boarding" ? (
                        <Button variant="primary" size="sm" busy={boarding === p.bookingId} onClick={() => onBoard(p.bookingId)}>
                          Board
                        </Button>
                      ) : p.itineraryId !== null ? (
                        <Link to={`/fly/journey/${encodeURIComponent(p.itineraryId)}`}>View journey</Link>
                      ) : (
                        <Link to={`/fly/pass/${p.bookingId}`}>View pass</Link>
                      )}
                    </Cell>
                  </tr>
                );
              })}
            </tbody>
          </Board>
        )}
      </Section>

      <div className="dash-actions">
        <Button size="lg" to="/fly/search">
          I can study until…
        </Button>
        <Button size="lg" variant="quiet" to="/fly/random">
          Random flight
        </Button>
      </div>

      <section className="dash-flying" aria-label="Your flying">
        {flying === null && !error ? (
          <Skeleton lines={1} />
        ) : flying ? (
          <p className="dash-flying-line">
            {flying.stats.completedFlights === 0 ? (
              <>No flights landed yet. Your first validated arrival starts the log.</>
            ) : (
              <>
                {formatHours(flying.stats.creditedFocusMs)} of focus across {flying.stats.completedFlights} {flying.stats.completedFlights === 1 ? "flight" : "flights"} and{" "}
                {flying.stats.countries} {flying.stats.countries === 1 ? "country" : "countries"}.
              </>
            )}{" "}
            {flying.levelName}
            {flying.next ? `; ${missingSentence(flying.next)}` : "."}
            {flying.last && (
              <>
                {" "}
                Last flight {flying.last.flightNumber ?? flying.last.airline}, {flying.last.origin} to {flying.last.destination}, {formatDate(flying.last.departure, tz)}.
              </>
            )}
          </p>
        ) : null}
      </section>

      {session.mode === "guest" && (
        <Notice tone="amber">
          <span>
            You are flying as a guest. Your flights, passport and stats stay on this device and expire on {formatDate(session.guest.expiresAt(), tz)}.{" "}
            <Link to="/account/sign-in">Create an account</Link> to keep them.
          </span>
        </Notice>
      )}
    </Page>
  );
}

function HomeAirportPicker() {
  const session = useSession();
  const toast = useToast();
  const [airports, setAirports] = useState<{ iata: string; name: string; city: string }[] | null>(null);
  const [choice, setChoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .airports()
      .then((res) => {
        if (!cancelled) setAirports([...res.airports].sort((a, b) => a.city.localeCompare(b.city)));
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      if (session.mode === "user") {
        await session.updateSettings({ homeAirport: choice });
      } else {
        writeLocal("aerofocus.homeAirport", choice);
        // The session value re-reads localStorage when guest state changes.
        session.refreshGuest();
      }
      toast.show("Home airport saved.", "signal");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!airports) return <Skeleton lines={1} />;
  return (
    <div className="dash-home">
      <Field label="Home airport" hint="Searches start here by default.">
        {(id, describedBy) => (
          <Select id={id} aria-describedby={describedBy} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose an airport</option>
            {airports.map((a) => (
              <option key={a.iata} value={a.iata}>
                {a.city} ({a.iata}) – {a.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button variant="primary" onClick={save} disabled={!choice} busy={saving}>
        Save
      </Button>
    </div>
  );
}
