import {
  CLOSED_ITINERARY_STATUSES,
  canAbandonItinerary,
  currentItineraryAirport,
  isItineraryClosed,
  itineraryLegBoardingWindow,
  itineraryNotificationPlan,
  itineraryStatus,
  layoverFocus,
  layoverState,
  legsToCancel,
  loungeAccess,
  outcomeAt,
  validationDeadline,
  type Instant,
  type ItineraryLegProgress,
  type ItineraryStatus,
  type LayoverEvent,
  type LayoverFocusSummary,
  type ScheduleSnapshot,
  type SessionOutcome,
  type TimeSpan,
} from "@aerofocus/core";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, notInArray, or } from "drizzle-orm";
import type { AppDeps } from "../context";
import { bookings, flightSessions, itineraries, layoverEvents, scheduleSnapshots } from "../db/schema";
import { ApiError, notFound } from "../errors";

/*
 * Itinerary state on the server (FR-041–FR-045). Status, cancellations and layover focus credit are
 * refreshed lazily from booking and session rows, like finalizeOpenSessions / markNoShows. This
 * module only reads rows; it never imports the session service, so the session service can call it.
 */

export type ItineraryRow = typeof itineraries.$inferSelect;
type BookingRow = typeof bookings.$inferSelect;
type SessionRow = typeof flightSessions.$inferSelect;

export interface ItineraryLeg {
  booking: BookingRow;
  session: SessionRow | null;
  snapshot: ScheduleSnapshot;
  /** Final outcome once finalised, else the live outcome; null when not boarded. */
  outcome: SessionOutcome | null;
}

export interface LoadedItinerary {
  row: ItineraryRow;
  legs: ItineraryLeg[];
}

const CLOSED_STATUSES = [...CLOSED_ITINERARY_STATUSES];

function legOutcome(session: SessionRow | null, now: Instant): SessionOutcome | null {
  if (!session) return null;
  return session.outcome ?? outcomeAt(session, now);
}

/** Loads the legs of many itineraries in one query (no N+1). Order of `rows` is kept. */
export async function loadItineraries(deps: AppDeps, rows: readonly ItineraryRow[], now: Instant): Promise<LoadedItinerary[]> {
  if (rows.length === 0) return [];
  const legRows = await deps.db
    .select({ booking: bookings, session: flightSessions, snapshot: scheduleSnapshots.data })
    .from(bookings)
    .leftJoin(flightSessions, eq(flightSessions.bookingId, bookings.id))
    .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, bookings.snapshotId))
    .where(inArray(bookings.itineraryId, rows.map((r) => r.id)))
    .orderBy(asc(bookings.legIndex));
  const byItinerary = new Map<string, ItineraryLeg[]>();
  for (const r of legRows) {
    const id = r.booking.itineraryId as string;
    const legs = byItinerary.get(id) ?? [];
    legs.push({ booking: r.booking, session: r.session, snapshot: r.snapshot, outcome: legOutcome(r.session, now) });
    byItinerary.set(id, legs);
  }
  return rows.map((row) => ({ row, legs: byItinerary.get(row.id) ?? [] }));
}

async function loadLegs(deps: AppDeps, row: ItineraryRow, now: Instant): Promise<LoadedItinerary> {
  return (await loadItineraries(deps, [row], now))[0]!;
}

export async function loadItinerary(deps: AppDeps, id: string, userId: string, now: Instant): Promise<LoadedItinerary> {
  const [row] = await deps.db
    .select()
    .from(itineraries)
    .where(and(eq(itineraries.id, id), eq(itineraries.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Itinerary");
  return loadLegs(deps, row, now);
}

export function legProgress(it: LoadedItinerary): ItineraryLegProgress[] {
  return it.legs.map((l) => ({ bookingStatus: l.booking.status, outcome: l.outcome }));
}

export function canAbandon(it: LoadedItinerary): boolean {
  if (isItineraryClosed(it.row.status)) return false;
  return canAbandonItinerary(legProgress(it));
}

/** Where the passenger is now (FR-044 rebooking). */
export function currentAirport(it: LoadedItinerary): string {
  return currentItineraryAirport(
    it.row.origin,
    it.legs.map((l) => ({ destination: l.snapshot.destination, outcome: l.outcome })),
  );
}

// ---------------------------------------------------------------------------------------------
// Layovers
// ---------------------------------------------------------------------------------------------

/**
 * Layover window after leg `legIndex` (FR-042, FR-043): from that leg's actual arrival until the next
 * leg is boarded, or, if it is not, until the earliest of its boarding close (missed connection),
 * the abandon instant, or the arriving leg's validation deadline when it ended invalid. Every end is
 * a fixed instant, so the credit is deterministic once final. Null when there is no layover (final
 * leg, arriving leg not boarded or ended early).
 */
export function layoverWindow(it: LoadedItinerary, legIndex: number): TimeSpan | null {
  const arriving = it.legs[legIndex];
  const next = it.legs[legIndex + 1];
  if (!arriving?.session || !next || arriving.outcome === "ended_early") return null;
  const start = arriving.session.arrival;
  let end: Instant;
  if (next.session) end = next.session.boardedAt;
  else {
    end = itineraryLegBoardingWindow(next.booking, legIndex + 1).closesAt;
    if (it.row.abandonedAt !== null) end = Math.min(end, it.row.abandonedAt);
    if (arriving.outcome === "invalid") end = Math.min(end, validationDeadline(start));
  }
  return { start, end: Math.max(start, end) };
}

/** Index of the leg whose layover is current: the last boarded leg, if a later leg exists and is not boarded. */
export function currentLayoverIndex(it: LoadedItinerary): number | null {
  let last = -1;
  it.legs.forEach((l, i) => {
    if (l.session) last = i;
  });
  if (last < 0 || last >= it.legs.length - 1) return null;
  return last;
}

export async function layoverEventsFor(deps: AppDeps, itineraryId: string, legIndex: number): Promise<LayoverEvent[]> {
  const rows = await deps.db
    .select({ type: layoverEvents.type, at: layoverEvents.at })
    .from(layoverEvents)
    .where(and(eq(layoverEvents.itineraryId, itineraryId), eq(layoverEvents.legIndex, legIndex)))
    .orderBy(asc(layoverEvents.at), asc(layoverEvents.id));
  return rows;
}

const eventKey = (itineraryId: string, legIndex: number) => `${itineraryId}:${legIndex}`;

/** A flight session's span, during which layover focus is never credited. */
interface FlightSpan {
  bookingId: string;
  span: TimeSpan;
}

/**
 * Per-request data for layover focus credit, loaded once for many itineraries: layover events and
 * the user's flight sessions (from boarding until exit or arrival).
 */
export interface LayoverContext {
  events: Map<string, LayoverEvent[]>;
  flights: FlightSpan[];
}

export async function layoverContext(deps: AppDeps, userId: string, its: readonly LoadedItinerary[]): Promise<LayoverContext> {
  const events = new Map<string, LayoverEvent[]>();
  if (its.length === 0) return { events, flights: [] };
  const eventRows = await deps.db
    .select({ itineraryId: layoverEvents.itineraryId, legIndex: layoverEvents.legIndex, type: layoverEvents.type, at: layoverEvents.at })
    .from(layoverEvents)
    .where(inArray(layoverEvents.itineraryId, its.map((it) => it.row.id)))
    .orderBy(asc(layoverEvents.at), asc(layoverEvents.id));
  for (const e of eventRows) {
    const key = eventKey(e.itineraryId, e.legIndex);
    const list = events.get(key) ?? [];
    list.push({ type: e.type, at: e.at });
    events.set(key, list);
  }
  // Only sessions that can overlap a layover of these itineraries: arriving after the earliest leg start.
  const starts = its.flatMap((it) => it.legs.map((l) => Math.min(l.booking.plannedDeparture, l.session?.boardedAt ?? Infinity)));
  const from = starts.length > 0 ? Math.min(...starts) : 0;
  const sessionRows = await deps.db
    .select({ bookingId: flightSessions.bookingId, boardedAt: flightSessions.boardedAt, arrival: flightSessions.arrival, exitedAt: flightSessions.exitedAt })
    .from(flightSessions)
    .where(and(eq(flightSessions.userId, userId), gt(flightSessions.arrival, from)));
  const flights = sessionRows.map((r) => ({
    bookingId: r.bookingId,
    span: { start: r.boardedAt, end: r.exitedAt !== null ? Math.min(r.exitedAt, r.arrival) : r.arrival },
  }));
  return { events, flights };
}

/** Spans of the user's flight sessions that are not legs of this itinerary. */
function otherFlightSpans(it: LoadedItinerary, ctx: LayoverContext): TimeSpan[] {
  const own = new Set(it.legs.map((l) => l.booking.id));
  return ctx.flights.filter((f) => !own.has(f.bookingId)).map((f) => f.span);
}

export function layoverEventsIn(ctx: LayoverContext, it: LoadedItinerary, legIndex: number): LayoverEvent[] {
  return ctx.events.get(eventKey(it.row.id, legIndex)) ?? [];
}

/**
 * Layover focus summary after leg `legIndex` (FR-043), or null when there is no layover window. Time
 * that overlaps any other flight session of the user is never credited, so focus time is never
 * counted twice.
 */
export function layoverFocusFor(it: LoadedItinerary, legIndex: number, ctx: LayoverContext, now: Instant): LayoverFocusSummary | null {
  const window = layoverWindow(it, legIndex);
  if (!window) return null;
  return layoverFocus(layoverEventsIn(ctx, it, legIndex), window, now, otherFlightSpans(it, ctx));
}

/**
 * Whether the user has a boarded, unfinalised flight session other than this itinerary's legs (the
 * arriving leg of a layover may still await validation). Layover focus is refused meanwhile.
 */
export async function hasOtherOpenFlight(deps: AppDeps, userId: string, it: LoadedItinerary): Promise<boolean> {
  const open = await deps.db
    .select({ bookingId: flightSessions.bookingId })
    .from(flightSessions)
    .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
    .where(and(eq(flightSessions.userId, userId), eq(bookings.status, "boarded"), isNull(flightSessions.finalizedAt)));
  const own = new Set(it.legs.map((l) => l.booking.id));
  return open.some((s) => !own.has(s.bookingId));
}

/** Pure view of one layover: terminal phase, gate countdowns and lounge (FR-042, FR-043). */
export function layoverStateFor(it: LoadedItinerary, legIndex: number, now: Instant) {
  const arriving = it.legs[legIndex]!;
  const next = it.legs[legIndex + 1]!;
  const arrival = arriving.session?.arrival ?? arriving.booking.plannedArrival;
  const state = layoverState({
    airport: arriving.snapshot.destination,
    arrival,
    validatedAt: arriving.session?.validatedAt ?? null,
    next: next.booking,
    nextStatus: next.booking.status,
    nextBoardedAt: next.session?.boardedAt ?? null,
    now,
  });
  return { state, lounge: loungeAccess(arriving.booking.cabin, next.booking.cabin) };
}

// ---------------------------------------------------------------------------------------------
// Lazy refresh
// ---------------------------------------------------------------------------------------------

/**
 * Recomputes an itinerary's status from its legs, cancels later unboarded legs once it is closed and
 * stores final layover focus credit. Closed statuses never change again. Idempotent.
 */
export async function refreshItinerary(
  deps: AppDeps,
  it: LoadedItinerary,
  now: Instant,
  ctx?: LayoverContext,
): Promise<LoadedItinerary> {
  let status = it.row.status;
  if (!isItineraryClosed(status)) {
    const next = itineraryStatus(legProgress(it));
    if (next !== status) {
      const updated = await deps.db
        .update(itineraries)
        .set({ status: next })
        .where(and(eq(itineraries.id, it.row.id), notInArray(itineraries.status, CLOSED_STATUSES)))
        .returning({ status: itineraries.status });
      if (updated.length > 0) status = next;
      else {
        const [fresh] = await deps.db.select({ status: itineraries.status }).from(itineraries).where(eq(itineraries.id, it.row.id));
        status = fresh?.status ?? status;
      }
    }
  }
  const cancel = legsToCancel(legProgress(it), status)
    .map((i) => it.legs[i]!.booking.id);
  if (cancel.length > 0) {
    await deps.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(inArray(bookings.id, cancel), eq(bookings.status, "booked")));
  }

  // Store layover focus credit once its window has ended (FR-043).
  for (let i = 0; i < it.legs.length - 1; i++) {
    const leg = it.legs[i]!;
    if (leg.booking.layoverFocusMs !== null) continue;
    const window = layoverWindow(it, i);
    if (!window || now < window.end) continue;
    ctx ??= await layoverContext(deps, it.row.userId, [it]);
    const summary = layoverFocusFor(it, i, ctx, now)!;
    await deps.db
      .update(bookings)
      // Takeoff instants can be fractional milliseconds; stored credit is whole milliseconds.
      .set({ layoverFocusMs: Math.round(summary.creditedMs) })
      .where(and(eq(bookings.id, leg.booking.id), isNull(bookings.layoverFocusMs)));
  }

  if (status === it.row.status && cancel.length === 0) return it;
  const [row] = await deps.db.select().from(itineraries).where(eq(itineraries.id, it.row.id));
  return loadLegs(deps, row ?? { ...it.row, status }, now);
}

/** Refreshes every itinerary of a user that is open or still has booked legs (batched loads). */
export async function refreshUserItineraries(deps: AppDeps, userId: string, now: Instant): Promise<void> {
  const withBookedLegs = deps.db
    .selectDistinct({ id: bookings.itineraryId })
    .from(bookings)
    .where(and(eq(bookings.userId, userId), isNotNull(bookings.itineraryId), eq(bookings.status, "booked")));
  // Layover credit needs no separate pass: every layover window has ended by the time an itinerary
  // closes, and the refresh that closes it stores the credit.
  const rows = await deps.db
    .select()
    .from(itineraries)
    .where(
      and(
        eq(itineraries.userId, userId),
        or(notInArray(itineraries.status, CLOSED_STATUSES), inArray(itineraries.id, withBookedLegs)),
      ),
    );
  if (rows.length === 0) return;
  const its = await loadItineraries(deps, rows, now);
  const needsCredit = its.some((it) =>
    it.legs.some((l, i) => i < it.legs.length - 1 && l.booking.layoverFocusMs === null && l.session !== null),
  );
  const ctx = needsCredit ? await layoverContext(deps, userId, its) : { events: new Map(), flights: [] };
  for (const it of its) await refreshItinerary(deps, it, now, ctx);
}

export async function refreshItineraryById(deps: AppDeps, id: string, now: Instant): Promise<void> {
  const [row] = await deps.db.select().from(itineraries).where(eq(itineraries.id, id));
  if (row) await refreshItinerary(deps, await loadLegs(deps, row, now), now);
}

/** Connecting-flight notification plan for the client to schedule locally. */
export function notificationPlanFor(it: LoadedItinerary) {
  return itineraryNotificationPlan(
    it.legs.map((l) => ({
      times: l.booking,
      cabin: l.booking.cabin,
      status: l.booking.status,
      arrival: l.session?.arrival ?? null,
      boardedAt: l.session?.boardedAt ?? null,
      validatedAt: l.session?.validatedAt ?? null,
      outcome: l.outcome,
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// One active flight at a time
// ---------------------------------------------------------------------------------------------

/**
 * The span an itinerary reserves (keeps focus time unambiguous: no separate flight during a
 * layover). Open itineraries reserve from the first leg's departure (actual once boarded) to the
 * last leg's planned arrival. Closed itineraries stop reserving when they closed: the abandon
 * instant, else the last finalised leg's end, else now; one that never boarded a leg reserves nothing.
 */
export function itineraryReservation(it: LoadedItinerary, now: Instant): TimeSpan | null {
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  if (!first || !last) return null;
  const start = first.session?.departure ?? first.booking.plannedDeparture;
  let end = last.booking.plannedArrival;
  if (isItineraryClosed(it.row.status)) {
    const finalised = it.legs.filter((l) => l.session?.finalizedAt != null).map((l) => l.session!.exitedAt ?? l.session!.arrival);
    if (it.row.abandonedAt !== null) end = it.row.abandonedAt;
    else if (finalised.length > 0) end = Math.max(...finalised);
    else if (it.legs.some((l) => l.session !== null)) end = now;
    else return null;
  }
  return end > start ? { start, end } : null;
}

export type FlightConflict = "flight_in_progress" | "itinerary_conflict";

/**
 * "One active flight at a time". A new flight (or itinerary, as its whole journey span) may not
 * depart before an open (unfinalised) boarded flight lands and may not overlap the span an
 * itinerary reserves (itineraryReservation). A new itinerary may also not overlap a booked single
 * flight. `excludeItineraryId` skips an itinerary's own legs (re-timing its later legs).
 */
export async function findFlightConflict(
  deps: AppDeps,
  userId: string,
  planned: readonly { departure: Instant; arrival: Instant }[],
  now: Instant,
  options: { itinerary?: boolean; excludeItineraryId?: string } = {},
): Promise<FlightConflict | null> {
  if (planned.length === 0) return null;
  const span = { start: Math.min(...planned.map((p) => p.departure)), end: Math.max(...planned.map((p) => p.arrival)) };
  const exclude = options.excludeItineraryId;
  const open = await deps.db
    .select({ arrival: flightSessions.arrival, itineraryId: bookings.itineraryId })
    .from(flightSessions)
    .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
    .where(and(eq(flightSessions.userId, userId), eq(bookings.status, "boarded"), isNull(flightSessions.finalizedAt)));
  if (open.some((s) => s.arrival > span.start && (exclude === undefined || s.itineraryId !== exclude))) return "flight_in_progress";

  // Itineraries that can still reserve time after span.start (by planned or actual arrival).
  const candidates = await deps.db
    .selectDistinct({ id: bookings.itineraryId })
    .from(bookings)
    .leftJoin(flightSessions, eq(flightSessions.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.userId, userId),
        isNotNull(bookings.itineraryId),
        exclude !== undefined ? ne(bookings.itineraryId, exclude) : undefined,
        or(gt(bookings.plannedArrival, span.start), gt(flightSessions.arrival, span.start)),
      ),
    );
  const ids = candidates.map((c) => c.id).filter((id): id is string => id !== null);
  if (ids.length > 0) {
    const rows = await deps.db.select().from(itineraries).where(inArray(itineraries.id, ids));
    for (const it of await loadItineraries(deps, rows, now)) {
      const r = itineraryReservation(it, now);
      if (r && span.start < r.end && r.start < span.end) return "itinerary_conflict";
    }
  }
  if (options.itinerary) {
    const [single] = await deps.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, userId),
          isNull(bookings.itineraryId),
          eq(bookings.status, "booked"),
          gt(bookings.plannedArrival, span.start),
          lt(bookings.plannedDeparture, span.end),
        ),
      )
      .limit(1);
    if (single) return "itinerary_conflict";
  }
  return null;
}

const CONFLICT_MESSAGES: Record<FlightConflict, string> = {
  flight_in_progress: "Finish or leave your current flight first",
  itinerary_conflict: "This overlaps a connecting flight journey you have booked",
};

export async function assertNoFlightConflict(
  deps: AppDeps,
  userId: string,
  planned: readonly { departure: Instant; arrival: Instant }[],
  now: Instant,
  options: { itinerary?: boolean } = {},
): Promise<void> {
  const conflict = await findFlightConflict(deps, userId, planned, now, options);
  if (conflict) throw new ApiError(409, conflict, CONFLICT_MESSAGES[conflict]);
}
