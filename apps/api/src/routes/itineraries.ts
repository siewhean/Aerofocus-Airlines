import {
  assignSeat,
  bookingWindowEnd,
  checkBookingRequest,
  CLOSED_ITINERARY_STATUSES,
  communityFlightKey,
  displayTime,
  fitsStudyWindow,
  HOUR,
  itineraryPlannedTimes,
  layoverEventError,
  MINUTE,
  OPEN_ITINERARY_STATUSES,
  publishedLayoverMs,
  searchConnections,
  serviceKey,
  validateItinerary,
  type Instant,
  type ItineraryMode,
  type LayoverEventType,
  type ItineraryStatus,
  type ScheduleSnapshot,
  type StudyWindow,
} from "@aerofocus/core";
import { AIRPORTS_BY_IATA, seatMapFor } from "@aerofocus/data";
import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireUser, type AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { bookings, itineraries, layoverEvents } from "../db/schema";
import { ApiError, parseJson, parseQuery } from "../errors";
import {
  aircraftView,
  airlineTier,
  airportOrThrow,
  airportView,
  offerView,
  snapshotForIndividualDate,
  snapshotOrThrow,
  storeSnapshot,
  type OfferContext,
} from "../services/catalogue";
import {
  assertNoFlightConflict,
  canAbandon,
  currentAirport,
  currentLayoverIndex,
  hasOtherOpenFlight,
  layoverContext,
  layoverEventsIn,
  layoverFocusFor,
  layoverStateFor,
  layoverWindow,
  loadItineraries,
  loadItinerary,
  notificationPlanFor,
  refreshItinerary,
  type LayoverContext,
  type LoadedItinerary,
} from "../services/itineraries";
import { finalizeOpenSessions, markNoShows, progressionFor } from "../services/sessions";
import { getSettings } from "../services/users";
import { boardingPass } from "./bookings";
import { breakScheduleSchema, cabinSchema, idParam } from "./common";
import { offerContext } from "./flights";

/*
 * Connecting flights (FR-041–FR-045, FR-048–FR-050). Each leg is an ordinary booking + flight
 * session; this router creates them together and serves itinerary, layover and rebooking views.
 */

const iata = z.string().regex(/^[A-Z0-9]{2,3}$/);

/** Departures listed this far back still board (Community Flights board until takeoff). */
const SEARCH_LOOKBACK_MS = 30 * MINUTE;
/** An individual study window starting later than this from now becomes a Custom Departure. */
const CUSTOM_START_MIN_LEAD_MS = MINUTE;
/** Layover departure board: how far ahead it looks and how many flights it lists. */
const DEPARTURE_BOARD_HORIZON_MS = 12 * HOUR;
const DEPARTURE_BOARD_SIZE = 12;
/** Itineraries that already rebook another one; a second rebooking is refused. */
const REBOOKING_STATUSES: readonly ItineraryStatus[] = [...OPEN_ITINERARY_STATUSES, "complete"];

/** Whether `id` already has a live (open or complete) rebooking. */
async function liveRebooking(db: Pick<AppDeps["db"], "select">, id: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: itineraries.id })
    .from(itineraries)
    .where(and(eq(itineraries.rebookedFromId, id), inArray(itineraries.status, [...REBOOKING_STATUSES])))
    .limit(1);
  return existing !== undefined;
}

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** createdAt cursor: only itineraries created before this instant (the previous page's nextBefore). */
  before: z.coerce.number().int().optional(),
});

const searchSchema = z
  .object({
    origin: iata,
    destination: iata,
    studyStart: z.coerce.number().optional(),
    studyEnd: z.coerce.number().optional(),
    mode: z.enum(["community", "individual"]).default("community"),
    maxConnections: z.coerce.number().int().min(1).max(2).default(2),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    timeZone: z.string().optional(),
  })
  .refine((q) => (q.studyStart === undefined) === (q.studyEnd === undefined), "studyStart and studyEnd go together")
  .refine((q) => q.studyStart === undefined || q.studyEnd! > q.studyStart, "studyEnd must be after studyStart");

const createSchema = z.object({
  legs: z.array(z.object({ snapshotId: z.string().min(1), cabin: cabinSchema })).min(1).max(3),
  mode: z.enum(["community", "individual"]),
  chosenDeparture: z.number().nullish(),
  studyWindow: z.object({ start: z.number(), end: z.number() }).nullish(),
  studyGoal: z.string().trim().max(500).nullish(),
  breakSchedule: breakScheduleSchema.nullish(),
  rebookedFromId: z.string().uuid().nullish(),
});

const ITINERARY_ERRORS: Record<string, string> = {
  no_legs: "Choose at least one flight",
  too_many_legs: "An itinerary has at most 3 legs",
  not_chained: "Each leg must depart from the previous leg's destination",
  unknown_airport: "An airport on this itinerary is not supported",
  airport_revisited: "An itinerary cannot visit the same airport twice",
  below_minimum_connection: "The connection is shorter than the minimum connection time",
  layover_too_long: "Layovers can be at most 24 hours",
  outside_booking_window: "Flights can be booked up to 7 days ahead",
  departure_in_past: "That departure time has passed",
  boarding_closed: "Boarding for this flight has closed",
  cabin_not_offered: "This flight does not offer that cabin",
  cabin_locked: "That cabin class is not unlocked yet",
  airline_locked: "That airline is not unlocked yet",
  missing_chosen_departure: "Choose a departure time",
  does_not_fit_study_window: "This journey does not fit your study window",
  private_not_scheduled: "Private aviation is not available on scheduled flights",
};

const LAYOVER_EVENT_ERRORS: Record<string, string> = {
  outside_layover: "There is no layover in progress",
  flight_in_progress: "Finish or leave your current flight first",
  already_focusing: "A layover focus session is already running",
  not_focusing: "No layover focus session is running",
};

interface ItinerarySearch {
  origin: string;
  destination: string;
  mode: ItineraryMode;
  studyWindow: StudyWindow | null;
  maxConnections: number;
  limit: number;
}

/**
 * Connection offers (FR-041). Community: legs at published times; the whole journey must fit the
 * study window. Individual: each route is offered once, the first leg departs now (or at the study
 * window start) and later legs keep the published layovers. Every leg must depart within the
 * 7-day booking window at its planned time.
 */
async function searchItineraryOffers(ctx: OfferContext, q: ItinerarySearch) {
  const { deps, now, userTimeZone } = ctx;
  const departures = await deps.provider.listDepartures({ from: now - SEARCH_LOOKBACK_MS, to: bookingWindowEnd(now, userTimeZone) });
  const options = searchConnections({
    departures,
    origin: q.origin,
    destination: q.destination,
    airportsByIata: AIRPORTS_BY_IATA,
    maxConnections: q.maxConnections,
    studyWindow: q.mode === "community" ? q.studyWindow : null,
  });
  const chosenDeparture =
    q.mode === "individual" && q.studyWindow && q.studyWindow.start > now + CUSTOM_START_MIN_LEAD_MS ? q.studyWindow.start : null;
  const permissive = { airlineTier: Number.POSITIVE_INFINITY, cabinClasses: ["economy" as const] };
  const seen = new Set<string>();
  const offers = [];
  for (const option of options) {
    if (q.mode === "individual") {
      const key = option.legs.map(serviceKey).join(">");
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const errors = validateItinerary(option.legs, AIRPORTS_BY_IATA, { now, userTimeZone, mode: q.mode, chosenDeparture });
    if (errors.length > 0) continue;
    const plans = itineraryPlannedTimes(q.mode, option.legs, { now, chosenDeparture });
    const first = plans[0]!;
    const last = plans[plans.length - 1]!;
    if (q.studyWindow && !fitsStudyWindow({ departure: first.departure, arrival: last.arrival }, q.studyWindow)) continue;
    const legErrors = option.legs.flatMap((s, i) =>
      checkBookingRequest({
        mode: plans[i]!.mode, snapshot: s, cabin: "economy", now, userTimeZone,
        chosenDeparture: plans[i]!.mode === "custom" ? plans[i]!.departure : null,
        unlocks: permissive, airlineTier: 0,
      }).filter((e) => e !== "cabin_not_offered"),
    );
    if (legErrors.length > 0) continue;
    const legs = option.legs.map((s, i) => ({ legIndex: i, ...offerView(ctx, s, plans[i]!.mode, plans[i]!.departure) }));
    offers.push({
      mode: q.mode,
      chosenDeparture,
      legs,
      layovers: option.layovers.map((l, i) => ({
        afterLegIndex: i,
        airport: airportView(airportOrThrow(l.airport)),
        layoverMs: plans[i + 1]!.departure - plans[i]!.arrival,
        minimumConnectionMs: l.minimumConnectionMs,
        domestic: l.domestic,
      })),
      departure: displayTime(first.departure, userTimeZone),
      arrival: displayTime(last.arrival, userTimeZone),
      totalMs: last.arrival - first.departure,
      connections: option.connections,
      direct: option.direct,
      bookable: legs.every((l) => l.bookable),
    });
    if (offers.length >= q.limit) break;
  }
  return offers;
}

export function itineraryRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  /** Refreshes sessions, no-shows and itinerary statuses, then loads one itinerary. */
  async function fresh(c: Context<AppEnv>) {
    const user = requireUser(c.get("user"));
    const settings = await getSettings(deps, user.id);
    const now = deps.clock.now();
    await finalizeOpenSessions(deps, user.id, settings.timeZone, now);
    await markNoShows(deps, user.id, now);
    const it = await loadItinerary(deps, idParam(c, "Itinerary"), user.id, now);
    return { user, settings, now, it };
  }

  function layoverView(it: LoadedItinerary, legIndex: number, ctx: LayoverContext, tz: string, now: Instant) {
    const { state, lounge } = layoverStateFor(it, legIndex, now);
    const window = layoverWindow(it, legIndex);
    const focus = layoverFocusFor(it, legIndex, ctx, now);
    return {
      afterLegIndex: legIndex,
      nextBookingId: it.legs[legIndex + 1]!.booking.id,
      airport: airportView(airportOrThrow(state.airport)),
      phase: state.phase,
      startsAt: displayTime(state.startsAt, tz),
      departsAt: displayTime(state.departsAt, tz),
      layoverMs: state.layoverMs,
      deplaningEndsAt: displayTime(state.deplaningEndsAt, tz),
      boardingOpensAt: displayTime(state.boardingOpensAt, tz),
      boardingClosesAt: displayTime(state.boardingClosesAt, tz),
      msToBoardingOpen: state.msToBoardingOpen,
      msToBoardingClose: state.msToBoardingClose,
      msToDeparture: state.msToDeparture,
      lounge: { access: lounge, premium: lounge === "premium" },
      focus: focus && {
        focusing: focus.focusing,
        focusMs: focus.focusMs,
        creditedMs: focus.creditedMs,
        final: focus.final,
        unattended: focus.unattended,
        window: window!,
      },
    };
  }

  async function itineraryView(it: LoadedItinerary, tz: string, displayName: string | null, now: Instant, ctx?: LayoverContext) {
    const current = currentLayoverIndex(it);
    const first = it.legs[0]!;
    const last = it.legs[it.legs.length - 1]!;
    return {
      id: it.row.id,
      mode: it.row.mode,
      status: it.row.status,
      origin: airportView(airportOrThrow(it.row.origin)),
      destination: airportView(airportOrThrow(it.row.destination)),
      currentAirport: airportView(airportOrThrow(currentAirport(it))),
      rebookedFromId: it.row.rebookedFromId,
      createdAt: it.row.createdAt,
      abandonedAt: it.row.abandonedAt,
      canAbandon: canAbandon(it),
      departure: displayTime(first.session?.departure ?? first.booking.plannedDeparture, tz),
      arrival: displayTime(last.session?.arrival ?? last.booking.plannedArrival, tz),
      legs: await Promise.all(
        it.legs.map(async (l, i) => ({
          legIndex: i,
          bookingId: l.booking.id,
          sessionId: l.session?.id ?? null,
          outcome: l.outcome,
          creditedFocusMs: l.session?.creditedFocusMs ?? null,
          boardingPass: await boardingPass(deps, l.booking, tz, displayName, l.snapshot),
        })),
      ),
      layovers: it.legs.slice(0, -1).map((l, i) => {
        const next = it.legs[i + 1]!;
        const arrival = l.session?.arrival ?? l.booking.plannedArrival;
        return {
          afterLegIndex: i,
          airport: airportView(airportOrThrow(l.snapshot.destination)),
          publishedLayoverMs: publishedLayoverMs(l.snapshot, next.snapshot),
          layoverMs: (next.session?.departure ?? next.booking.plannedDeparture) - arrival,
          lounge: layoverStateFor(it, i, now).lounge,
          creditedFocusMs: l.booking.layoverFocusMs,
        };
      }),
      layover: current === null ? null : layoverView(it, current, ctx ?? (await layoverContext(deps, it.row.userId, [it])), tz, now),
      notifications: notificationPlanFor(it),
    };
  }

  /**
   * Individual itineraries with a chosen departure fly the services operating on that date (FR-003),
   * like single Custom Departures. Later legs move by the same number of days so the connection
   * stays on one day's schedule; the itinerary is then validated as usual.
   */
  async function useOperatingDate(snapshots: ScheduleSnapshot[], chosenDeparture: Instant): Promise<void> {
    const first = snapshots[0]!;
    const resolved = await snapshotForIndividualDate(deps, first, chosenDeparture);
    if (resolved.id === first.id) return;
    const shift = resolved.departure - first.departure;
    snapshots[0] = resolved;
    for (let i = 1; i < snapshots.length; i++) {
      snapshots[i] = await snapshotForIndividualDate(deps, snapshots[i]!, snapshots[i]!.departure + shift);
    }
  }

  /** Connection search (guest-capable with ?timeZone=). */
  app.get("/search", async (c) => {
    const q = parseQuery(c, searchSchema);
    const ctx = await offerContext(c, deps);
    const offers = await searchItineraryOffers(ctx, {
      origin: q.origin,
      destination: q.destination,
      mode: q.mode,
      studyWindow: q.studyStart !== undefined ? { start: q.studyStart, end: q.studyEnd! } : null,
      maxConnections: q.maxConnections,
      limit: q.limit,
    });
    return c.json({ offers, unlocks: ctx.unlocks });
  });

  /** Books every leg of an itinerary at once. */
  app.post("/", async (c) => {
    const user = requireUser(c.get("user"));
    const body = await parseJson(c, createSchema);
    const now = deps.clock.now();
    const settings = await getSettings(deps, user.id);
    const tz = settings.timeZone;
    const snapshots: ScheduleSnapshot[] = [];
    for (const leg of body.legs) snapshots.push(await snapshotOrThrow(deps, leg.snapshotId));
    const mode: ItineraryMode = body.mode;
    const chosenDeparture = mode === "individual" ? body.chosenDeparture ?? null : null;
    if (chosenDeparture !== null && chosenDeparture < now) {
      throw new ApiError(422, "departure_in_past", ITINERARY_ERRORS.departure_in_past!);
    }
    if (chosenDeparture !== null) await useOperatingDate(snapshots, chosenDeparture);

    const structural = validateItinerary(snapshots, AIRPORTS_BY_IATA, { now, userTimeZone: tz, mode, chosenDeparture });
    if (structural.length > 0) {
      const code = structural[0]!.error;
      throw new ApiError(422, code, ITINERARY_ERRORS[code] ?? "Itinerary not allowed", { errors: structural });
    }
    const plans = itineraryPlannedTimes(mode, snapshots, { now, chosenDeparture });

    // Per-leg booking rules (unlocks, cabins, boarding still open). Random Flight draws are not
    // supported for itineraries, so locked airlines and classes stay locked.
    const { unlocks } = await progressionFor(deps, user.id, tz, now);
    const legErrors = snapshots.flatMap((snapshot, legIndex) =>
      checkBookingRequest({
        mode: plans[legIndex]!.mode,
        snapshot,
        cabin: body.legs[legIndex]!.cabin,
        now,
        userTimeZone: tz,
        chosenDeparture: plans[legIndex]!.mode === "custom" ? plans[legIndex]!.departure : null,
        unlocks,
        airlineTier: airlineTier(deps, snapshot.operatingAirline),
      }).map((error) => ({ legIndex, error })),
    );
    if (legErrors.length > 0) {
      const code = legErrors[0]!.error;
      throw new ApiError(422, code, ITINERARY_ERRORS[code] ?? "Booking not allowed", { errors: legErrors });
    }
    const journey = { departure: plans[0]!.departure, arrival: plans[plans.length - 1]!.arrival };
    if (body.studyWindow && !fitsStudyWindow(journey, body.studyWindow)) {
      throw new ApiError(422, "does_not_fit_study_window", ITINERARY_ERRORS.does_not_fit_study_window!);
    }

    const origin = snapshots[0]!.origin;
    const destination = snapshots[snapshots.length - 1]!.destination;
    if (body.rebookedFromId) {
      await finalizeOpenSessions(deps, user.id, tz, now);
      await markNoShows(deps, user.id, now);
      const old = await loadItinerary(deps, body.rebookedFromId, user.id, now);
      if (old.row.status !== "incomplete" && old.row.status !== "abandoned") {
        throw new ApiError(409, "not_rebookable", "Only incomplete or abandoned itineraries can be rebooked");
      }
      if (origin !== currentAirport(old) || destination !== old.row.destination) {
        throw new ApiError(422, "rebook_route_mismatch", "A rebooking must go from where you are to the original destination");
      }
      // Checked again under a lock when inserting; checked here first so it wins over overlap errors.
      if (await liveRebooking(deps.db, body.rebookedFromId)) {
        throw new ApiError(409, "already_rebooked", "This itinerary has already been rebooked");
      }
    }

    await markNoShows(deps, user.id, now);
    await assertNoFlightConflict(deps, user.id, plans, now, { itinerary: true });
    for (const s of snapshots) await storeSnapshot(deps, s);

    const id = await deps.db.transaction(async (tx) => {
      if (body.rebookedFromId) {
        // Lock the rebooked itinerary so concurrent rebookings are serialised, then allow only one
        // live (open or complete) rebooking of it.
        await tx.select({ id: itineraries.id }).from(itineraries).where(eq(itineraries.id, body.rebookedFromId)).for("update");
        if (await liveRebooking(tx, body.rebookedFromId)) {
          throw new ApiError(409, "already_rebooked", "This itinerary has already been rebooked");
        }
      }
      const [row] = await tx
        .insert(itineraries)
        .values({ userId: user.id, mode, status: "booked", origin, destination, rebookedFromId: body.rebookedFromId ?? null, createdAt: now })
        .returning({ id: itineraries.id });
      await tx.insert(bookings).values(
        snapshots.map((snapshot, legIndex) => {
          const plan = plans[legIndex]!;
          const cabin = body.legs[legIndex]!.cabin;
          return {
            userId: user.id,
            snapshotId: snapshot.id,
            mode: plan.mode,
            cabin,
            seat: assignSeat(plan.mode, seatMapFor(snapshot.aircraftType, aircraftView(snapshot.aircraftType).family), cabin, deps.random),
            plannedDeparture: plan.departure,
            plannedArrival: plan.arrival,
            studyWindowStart: body.studyWindow?.start ?? null,
            studyWindowEnd: body.studyWindow?.end ?? null,
            studyGoal: body.studyGoal ?? null,
            breakSchedule: body.breakSchedule ?? settings.breakSchedule,
            isRandomDraw: false,
            communityKey: plan.mode === "community" ? communityFlightKey(snapshot) : null,
            itineraryId: row!.id,
            legIndex,
            createdAt: now,
          };
        }),
      );
      return row!.id;
    });
    const it = await loadItinerary(deps, id, user.id, now);
    return c.json({ itinerary: await itineraryView(it, tz, user.displayName, now) }, 201);
  });

  app.get("/", async (c) => {
    const user = requireUser(c.get("user"));
    const q = parseQuery(c, listSchema);
    const settings = await getSettings(deps, user.id);
    const now = deps.clock.now();
    await finalizeOpenSessions(deps, user.id, settings.timeZone, now);
    await markNoShows(deps, user.id, now);
    const rows = await deps.db
      .select()
      .from(itineraries)
      .where(and(eq(itineraries.userId, user.id), q.before !== undefined ? lt(itineraries.createdAt, q.before) : undefined))
      .orderBy(desc(itineraries.createdAt), desc(itineraries.id))
      .limit(q.limit);
    const its = await loadItineraries(deps, rows, now);
    const ctx = await layoverContext(deps, user.id, its);
    const views = [];
    for (const it of its) views.push(await itineraryView(it, settings.timeZone, user.displayName, now, ctx));
    const nextBefore = rows.length === q.limit ? rows[rows.length - 1]!.createdAt : null;
    return c.json({ itineraries: views, nextBefore, serverTime: now });
  });

  app.get("/:id", async (c) => {
    const { user, settings, now, it } = await fresh(c);
    return c.json({ itinerary: await itineraryView(it, settings.timeZone, user.displayName, now), serverTime: now });
  });

  /**
   * Abandon (FR-044): later unboarded legs are cancelled; a leg in flight is not affected (exit it
   * separately); completed legs keep their rewards. Refused when nothing is left to cancel.
   */
  app.post("/:id/abandon", async (c) => {
    const { user, settings, now, it } = await fresh(c);
    if (!canAbandon(it)) {
      throw new ApiError(409, "not_abandonable", "There are no remaining flights to abandon");
    }
    const updated = await deps.db
      .update(itineraries)
      .set({ status: "abandoned", abandonedAt: now })
      .where(and(eq(itineraries.id, it.row.id), notInArray(itineraries.status, [...CLOSED_ITINERARY_STATUSES])))
      .returning({ id: itineraries.id });
    if (updated.length === 0) {
      // Closed concurrently: fine if that was another abandon, otherwise nothing is left to abandon.
      const [row] = await deps.db.select({ status: itineraries.status }).from(itineraries).where(eq(itineraries.id, it.row.id));
      if (row?.status !== "abandoned") throw new ApiError(409, "not_abandonable", "There are no remaining flights to abandon");
    }
    const refreshed = await refreshItinerary(deps, await loadItinerary(deps, it.row.id, user.id, now), now);
    return c.json({ itinerary: await itineraryView(refreshed, settings.timeZone, user.displayName, now), serverTime: now });
  });

  /** Rebooking offers from where the passenger is now to the original destination (FR-044). */
  app.get("/:id/rebook", async (c) => {
    const q = parseQuery(
      c,
      z.object({
        mode: z.enum(["community", "individual"]).optional(),
        maxConnections: z.coerce.number().int().min(1).max(2).default(2),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
    );
    const { now, it } = await fresh(c);
    if (it.row.status !== "incomplete" && it.row.status !== "abandoned") {
      throw new ApiError(409, "not_rebookable", "Only incomplete or abandoned itineraries can be rebooked");
    }
    const from = currentAirport(it);
    if (from === it.row.destination) throw new ApiError(409, "already_at_destination", "You have already reached the destination");
    const ctx = await offerContext(c, deps);
    const offers = await searchItineraryOffers(ctx, {
      origin: from,
      destination: it.row.destination,
      mode: q.mode ?? it.row.mode,
      studyWindow: null,
      maxConnections: q.maxConnections,
      limit: q.limit,
    });
    return c.json({
      rebookedFromId: it.row.id,
      from: airportView(airportOrThrow(from)),
      to: airportView(airportOrThrow(it.row.destination)),
      offers,
      serverTime: now,
    });
  });

  /** Terminal state, gate countdowns, lounge, layover focus and the airport's departure board (FR-042, FR-043). */
  async function layoverResponse(it: LoadedItinerary, tz: string, now: Instant) {
    const index = currentLayoverIndex(it);
    if (index === null) return { layover: null, departures: [], serverTime: now };
    const view = layoverView(it, index, await layoverContext(deps, it.row.userId, [it]), tz, now);
    const nextSnapshotId = it.legs[index + 1]!.booking.snapshotId;
    let board: ScheduleSnapshot[] = [];
    try {
      board = await deps.provider.listDepartures({ from: now, to: now + DEPARTURE_BOARD_HORIZON_MS, origin: view.airport.iata });
    } catch (err) {
      // Provider unavailable: the layover still works without the board.
      console.warn("layover departure board unavailable", { airport: view.airport.iata, error: err instanceof Error ? err.message : String(err) });
      board = [];
    }
    const departures = board
      .sort((a, b) => a.departure - b.departure)
      .slice(0, DEPARTURE_BOARD_SIZE)
      .map((s) => ({
        snapshotId: s.id,
        flightNumber: `${s.operatingAirline}${s.flightNumber}`,
        airline: s.operatingAirline,
        destination: airportView(airportOrThrow(s.destination)),
        departure: displayTime(s.departure, tz),
        yours: s.id === nextSnapshotId,
        dataSource: s.sourceStatus,
      }));
    return { layover: view, departures, serverTime: now };
  }

  app.get("/:id/layover", async (c) => {
    const { settings, now, it } = await fresh(c);
    return c.json(await layoverResponse(it, settings.timeZone, now));
  });

  async function layoverEvent(c: Context<AppEnv>, type: LayoverEventType) {
    const { user, settings, now, it } = await fresh(c);
    const index = currentLayoverIndex(it);
    const window = index === null ? null : layoverWindow(it, index);
    if (index === null || window === null) throw new ApiError(409, "outside_layover", LAYOVER_EVENT_ERRORS.outside_layover!);
    // Focus time is never counted twice: no layover focus while another flight is in progress.
    if (type !== "focus_stop" && (await hasOtherOpenFlight(deps, user.id, it))) {
      throw new ApiError(409, "flight_in_progress", LAYOVER_EVENT_ERRORS.flight_in_progress!);
    }
    const ctx = await layoverContext(deps, user.id, [it]);
    const error = layoverEventError(layoverEventsIn(ctx, it, index), type, window, now);
    if (error) throw new ApiError(409, error, LAYOVER_EVENT_ERRORS[error] ?? error);
    await deps.db.insert(layoverEvents).values({ itineraryId: it.row.id, legIndex: index, type, at: now });
    return c.json(await layoverResponse(it, settings.timeZone, now));
  }

  /** Optional layover focus session (FR-043): credited only for attended time inside the layover. */
  app.post("/:id/layover/focus/start", (c) => layoverEvent(c, "focus_start"));
  app.post("/:id/layover/focus/stop", (c) => layoverEvent(c, "focus_stop"));
  app.post("/:id/layover/heartbeat", (c) => layoverEvent(c, "beat"));

  return app;
}
