import type { AirportView, ItineraryOffer, Offer } from "@aerofocus/client";
import { localParts, zonedToInstant, MINUTE, HOUR, type CabinClass } from "@aerofocus/core";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Page } from "../app/Shell";
import { ItineraryOffersBoard } from "../components/JourneyChain";
import { FlightIdent, RouteCodes } from "../components/RouteCodes";
import { api, errorMessage } from "../lib/api";
import { formatClock, formatDuration, formatRelativeDay, cabinLabel } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Board, Button, Cell, Empty, Field, Icon, Input, Notice, SampleBadge, Section, Select, Skeleton } from "../ui";
import "./Search.css";

const CABINS: CabinClass[] = ["economy", "premium_economy", "business", "first"];
type DepartureType = "all" | "community" | "individual";
type Connections = 0 | 1 | 2;
const RESULT_LIMIT = 50;
/** Itinerary offers sort by total time, so direct flights fill a small limit first (docs/API.md). */
const ITINERARY_LIMIT = 60;

function parseConnections(value: string | null): Connections {
  return value === "1" ? 1 : value === "2" ? 2 : 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Epoch → "YYYY-MM-DDTHH:MM" wall clock in the user's zone, for datetime-local inputs. */
function toLocalInput(epoch: number, tz: string): string {
  const p = localParts(epoch, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:MM" wall clock in the user's zone → epoch, or null when unparseable. */
function fromLocalInput(value: string, tz: string): number | null {
  const [date, time] = value.split("T");
  if (!date || !time) return null;
  try {
    return zonedToInstant(date, time.slice(0, 5), tz);
  } catch {
    return null;
  }
}

function roundUpToFiveMinutes(epoch: number): number {
  const step = 5 * MINUTE;
  return Math.ceil(epoch / step) * step;
}

function parseEpoch(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface Draft {
  start: string;
  end: string;
  from: string;
  to: string;
  cabin: CabinClass;
  type: DepartureType;
  conn: Connections;
}

export default function Search() {
  const session = useSession();
  const tz = session.timeZone;
  const [params, setParams] = useSearchParams();

  // The URL is the source of truth; the draft is what the form shows before submit.
  const urlState = useMemo(() => {
    const now = session.now();
    const start = parseEpoch(params.get("start")) ?? roundUpToFiveMinutes(now);
    const end = parseEpoch(params.get("end")) ?? start + 2 * HOUR;
    const cabinParam = params.get("cabin");
    const typeParam = params.get("type");
    return {
      start,
      end,
      from: params.get("from") ?? params.get("origin") ?? session.homeAirport ?? "",
      to: params.get("to") ?? "",
      cabin: (CABINS.includes(cabinParam as CabinClass) ? cabinParam : "economy") as CabinClass,
      type: (typeParam === "community" || typeParam === "individual" ? typeParam : "all") as DepartureType,
      conn: parseConnections(params.get("conn")),
      submitted: params.has("start") && params.has("end"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, session.homeAirport]);

  const [draft, setDraft] = useState<Draft>(() => ({
    start: toLocalInput(urlState.start, tz),
    end: toLocalInput(urlState.end, tz),
    from: urlState.from,
    to: urlState.to,
    cabin: urlState.cabin,
    type: urlState.type,
    conn: urlState.conn,
  }));
  const [formError, setFormError] = useState<string | null>(null);

  // Back/forward: resync the form with the URL.
  useEffect(() => {
    setDraft({
      start: toLocalInput(urlState.start, tz),
      end: toLocalInput(urlState.end, tz),
      from: urlState.from,
      to: urlState.to,
      cabin: urlState.cabin,
      type: urlState.type,
      conn: urlState.conn,
    });
  }, [urlState, tz]);

  const [airports, setAirports] = useState<AirportView[] | null>(null);
  const [airportsError, setAirportsError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .airports()
      .then((res) => {
        if (!cancelled) setAirports([...res.airports].sort((a, b) => a.city.localeCompare(b.city)));
      })
      .catch((e) => {
        if (!cancelled) setAirportsError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [journeys, setJourneys] = useState<ItineraryOffer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Connections need both ends; "conn" is ignored otherwise.
  const journeySearch = urlState.conn > 0 && urlState.from !== "" && urlState.to !== "";

  useEffect(() => {
    if (!urlState.submitted) {
      setOffers(null);
      setJourneys(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSearchError(null);

    if (journeySearch) {
      setOffers(null);
      // The itinerary search has no "all" mode: run both and merge (docs/API.md Phase 3).
      const modes: ("community" | "individual")[] = urlState.type === "all" ? ["community", "individual"] : [urlState.type];
      Promise.all(
        modes.map((mode) =>
          api.searchItineraries({
            origin: urlState.from,
            destination: urlState.to,
            studyStart: urlState.start,
            studyEnd: urlState.end,
            mode,
            maxConnections: urlState.conn as 1 | 2,
            limit: ITINERARY_LIMIT,
            ...(session.mode === "guest" ? { timeZone: tz } : {}),
          }),
        ),
      )
        .then((results) => {
          if (cancelled) return;
          const seen = new Set<string>();
          const merged: ItineraryOffer[] = [];
          for (const res of results) {
            for (const o of res.offers) {
              const key = `${o.mode}:${o.legs.map((l) => l.snapshotId).join(",")}`;
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(o);
            }
          }
          const unlocks = session.mode === "guest" ? session.guest.unlocks() : null;
          const graded = unlocks
            ? merged.map((o) => {
                const legs = o.legs.map((l) => {
                  const airlineLocked = l.airline.tier > unlocks.airlineTier;
                  return {
                    ...l,
                    airline: { ...l.airline, locked: airlineLocked },
                    cabins: l.cabins.map((c) => ({ ...c, locked: !unlocks.cabinClasses.includes(c.cabin) })),
                    bookable: !airlineLocked,
                  };
                });
                return { ...o, legs, bookable: legs.every((l) => l.bookable) };
              })
            : merged;
          setJourneys([...graded].sort((a, b) => a.departure.epochMs - b.departure.epochMs));
        })
        .catch((e) => {
          if (!cancelled) setSearchError(errorMessage(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setJourneys(null);
    api
      .search({
        studyStart: urlState.start,
        studyEnd: urlState.end,
        mode: urlState.type,
        origin: urlState.from || undefined,
        destination: urlState.to || undefined,
        cabin: urlState.cabin,
        limit: RESULT_LIMIT,
        ...(session.mode === "guest" ? { timeZone: tz } : {}),
      })
      .then((res) => {
        if (cancelled) return;
        // Guests: the server grades locks against zero progress; apply the device unlocks instead.
        const unlocks = session.mode === "guest" ? session.guest.unlocks() : null;
        const graded = unlocks
          ? res.offers.map((o) => {
              const airlineLocked = o.airline.tier > unlocks.airlineTier;
              return {
                ...o,
                airline: { ...o.airline, locked: airlineLocked },
                cabins: o.cabins.map((c) => ({ ...c, locked: !unlocks.cabinClasses.includes(c.cabin) })),
                bookable: !airlineLocked,
              };
            })
          : res.offers;
        setOffers([...graded].sort((a, b) => a.departure.epochMs - b.departure.epochMs));
      })
      .catch((e) => {
        if (!cancelled) setSearchError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urlState, journeySearch, session.mode, tz]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const start = fromLocalInput(draft.start, tz);
    const end = fromLocalInput(draft.end, tz);
    if (start === null || end === null) {
      setFormError("Enter both a start and an end time.");
      return;
    }
    if (end <= start) {
      setFormError("The end time must be after the start time.");
      return;
    }
    setFormError(null);
    const next = new URLSearchParams();
    next.set("start", String(start));
    next.set("end", String(end));
    if (draft.from) next.set("from", draft.from);
    if (draft.to) next.set("to", draft.to);
    next.set("cabin", draft.cabin);
    next.set("type", draft.type);
    if (draft.from && draft.to && draft.conn > 0) next.set("conn", String(draft.conn));
    setParams(next);
  };

  const now = session.now();
  const windowDays = session.rules?.bookingWindowDays;
  const count = journeySearch ? (journeys?.length ?? 0) : (offers?.length ?? 0);
  const studyWindow = { start: urlState.start, end: urlState.end };

  return (
    <Page title="Book a flight" lead="Tell us when you can study. We'll show real services that fit, in your own time.">
      <form className="search-form" onSubmit={onSubmit} noValidate>
        <div className="search-row">
          <Field label="Study from" error={formError}>
            {(id, describedBy) => (
              <Input id={id} aria-describedby={describedBy} type="datetime-local" step={300} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} required />
            )}
          </Field>
          <Field label="until">
            {(id) => <Input id={id} type="datetime-local" step={300} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} required />}
          </Field>
          <Field label="From">
            {(id) => (
              <Select id={id} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} disabled={!airports}>
                <option value="">Anywhere</option>
                {airports?.map((a) => (
                  <option key={a.iata} value={a.iata}>
                    {a.city} ({a.iata})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <Select id={id} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} disabled={!airports}>
                <option value="">Anywhere</option>
                {airports?.map((a) => (
                  <option key={a.iata} value={a.iata}>
                    {a.city} ({a.iata})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Cabin">
            {(id) => (
              <Select id={id} value={draft.cabin} onChange={(e) => setDraft({ ...draft, cabin: e.target.value as CabinClass })}>
                {CABINS.map((c) => (
                  <option key={c} value={c}>
                    {cabinLabel(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Departure type">
            {(id) => (
              <Select id={id} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as DepartureType })}>
                <option value="all">All</option>
                <option value="community">Community Flights</option>
                <option value="individual">Individual</option>
              </Select>
            )}
          </Field>
          {draft.from !== "" && draft.to !== "" && (
            <Field label="Connections">
              {(id) => (
                <Select id={id} value={String(draft.conn)} onChange={(e) => setDraft({ ...draft, conn: parseConnections(e.target.value) })}>
                  <option value="0">Direct only</option>
                  <option value="1">Up to 1 connection</option>
                  <option value="2">Up to 2 connections</option>
                </Select>
              )}
            </Field>
          )}
          <div className="search-submit">
            <Button type="submit" variant="primary" busy={loading}>
              Find flights
            </Button>
          </div>
        </div>
        <p className="search-note">{windowDays !== undefined ? `Booking window: today to ${windowDays} days ahead.` : "Booking window: loading the airline rules."}</p>
      </form>

      {airportsError && <Notice tone="danger">{airportsError}</Notice>}
      {searchError && <Notice tone="danger">{searchError}</Notice>}

      {urlState.submitted && (
        <Section
          title="Flights that fit"
          aside={
            <span aria-live="polite">
              {loading
                ? "Searching"
                : journeySearch
                  ? journeys
                    ? `${count} ${count === 1 ? "journey fits" : "journeys fit"}`
                    : ""
                  : offers
                    ? `${count} ${count === 1 ? "flight fits" : "flights fit"}`
                    : ""}
            </span>
          }
        >
          {((offers && offers.some((o) => o.dataSource === "sample")) || (journeys && journeys.some((j) => j.legs.some((l) => l.dataSource === "sample")))) && (
            <Notice>
              <SampleBadge dataSource="sample" />
              <span className="small muted">Times shown are illustrative while the schedule provider is a sample. They are not published airline schedules.</span>
            </Notice>
          )}
          {journeySearch && session.mode === "guest" && journeys && journeys.length > 0 && (
            <Notice>
              <span>
                Connecting flights need an account. <Link to="/account/sign-in">Create one</Link> to book.
              </span>
            </Notice>
          )}
          {journeySearch ? (
            loading && journeys === null ? (
              <Skeleton lines={4} />
            ) : journeys && journeys.length === 0 ? (
              <Empty title="No journeys fit that window">Try a longer window, fewer connections, or a different route.</Empty>
            ) : journeys ? (
              <ItineraryOffersBoard offers={journeys} now={now} timeZone={tz} cabin={urlState.cabin} studyWindow={studyWindow} canBook={session.mode === "user"} caption="Journeys that fit your study window" />
            ) : null
          ) : loading && offers === null ? (
            <Skeleton lines={4} />
          ) : offers && offers.length === 0 ? (
            <Empty title="No flights fit that window">Try a longer window, or a different departure airport.</Empty>
          ) : offers ? (
            <Board caption="Flights that fit your study window">
              <thead>
                <tr>
                  <Cell head>Departs</Cell>
                  <Cell head>Flight</Cell>
                  <Cell head>Route</Cell>
                  <Cell head>Aircraft</Cell>
                  <Cell head num>Duration</Cell>
                  <Cell head num>Lands</Cell>
                  <Cell head>Type</Cell>
                  <Cell head>Cabins</Cell>
                  <Cell head>
                    <span className="visually-hidden">Action</span>
                  </Cell>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const day = formatRelativeDay(o.departure, now, tz);
                  const bookHref = `/fly/book/${encodeURIComponent(o.snapshotId)}?mode=${o.mode}&departure=${o.departure.epochMs}&cabin=${urlState.cabin}&start=${urlState.start}&end=${urlState.end}`;
                  const lockReason = o.airline.locked ? "This airline is locked. Keep flying to unlock it." : "This flight cannot be booked right now.";
                  return (
                    <tr key={`${o.snapshotId}-${o.mode}-${o.departure.epochMs}`} className={o.airline.locked ? "is-locked" : undefined}>
                      <Cell>
                        <span className="search-time">
                          <span className="numeral">{formatClock(o.departure, tz)}</span>
                          {day !== "today" && <span className="muted small">{day}</span>}
                        </span>
                      </Cell>
                      <Cell>
                        <FlightIdent flightNumber={o.flightNumber} airline={o.airline.name} locked={o.airline.locked} />
                      </Cell>
                      <Cell>
                        <RouteCodes origin={o.origin} destination={o.destination} cities />
                      </Cell>
                      <Cell>{o.aircraft.known ? o.aircraft.name : <span className="muted">Aircraft not confirmed</span>}</Cell>
                      <Cell num>
                        <span className="numeral">{formatDuration(o.blockMs)}</span>
                      </Cell>
                      <Cell num>
                        <span className="numeral">{formatClock(o.arrival, tz)}</span>
                      </Cell>
                      <Cell>{o.mode === "community" ? <Badge tone="geo">Community Flight</Badge> : "Individual"}</Cell>
                      <Cell>
                        <span className="search-cabins">
                          {o.cabins.map((c, i) => (
                            <span key={c.cabin} className={c.locked ? "search-cabin-locked" : undefined}>
                              {c.locked && <Icon name="lock" size={12} title="Locked" />}
                              {cabinLabel(c.cabin)}
                              {i < o.cabins.length - 1 ? "," : ""}
                            </span>
                          ))}
                        </span>
                      </Cell>
                      <Cell num>
                        <span className="search-action">
                          {o.bookable ? (
                            <Button variant="primary" size="sm" to={bookHref}>
                              Book
                            </Button>
                          ) : (
                            <Button variant="primary" size="sm" disabled title={lockReason}>
                              Book
                            </Button>
                          )}
                        </span>
                      </Cell>
                    </tr>
                  );
                })}
              </tbody>
            </Board>
          ) : null}
        </Section>
      )}
    </Page>
  );
}
