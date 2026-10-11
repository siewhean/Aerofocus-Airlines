import {
  assignSeat,
  boardFlight,
  checkBookingRequest,
  communityFlightKey,
  displayTime,
  isItineraryClosed,
  isWithinBookingWindow,
  itineraryLegBoardingWindow,
  legBoardingBlock,
  legBoardingTimes,
  plannedTimes,
  recomputeItineraryTimes,
  type DepartureMode,
  type ScheduleSnapshot,
} from "@aerofocus/core";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser, type AppEnv } from "../auth";
import { invalidateCommunityCache, type AppDeps } from "../context";
import { attendanceSignals, bookings, flightSessions } from "../db/schema";
import { ApiError, notFound, parseJson } from "../errors";
import {
  aircraftView,
  airlineTier,
  airportOrThrow,
  airportView,
  snapshotForIndividualDate,
  snapshotOrThrow,
  storeSnapshot,
  verifyRandomDraw,
} from "../services/catalogue";
import { assertNoFlightConflict, findFlightConflict, legProgress, loadItinerary, refreshItinerary } from "../services/itineraries";
import { finalizeOpenSessions, markNoShows, progressionFor, type BookingRow } from "../services/sessions";
import { getSettings } from "../services/users";
import { AIRLINES_BY_IATA, seatMapFor } from "@aerofocus/data";
import { breakScheduleSchema, cabinSchema, idParam } from "./common";

const bookingSchema = z.object({
  snapshotId: z.string().min(1),
  mode: z.enum(["community", "depart_now", "custom"]),
  cabin: cabinSchema,
  chosenDeparture: z.number().nullish(),
  studyWindow: z.object({ start: z.number(), end: z.number() }).nullish(),
  studyGoal: z.string().trim().max(500).nullish(),
  breakSchedule: breakScheduleSchema.nullish(),
  drawToken: z.string().nullish(),
});

/**
 * Virtual boarding pass (FR-008). Times are shown in the user's local time zone. Connecting legs of
 * an itinerary show the connecting-leg boarding window (15 minutes before departure until takeoff).
 */
export async function boardingPass(
  deps: AppDeps,
  b: BookingRow,
  timeZone: string,
  displayName: string | null,
  /** The booking's snapshot when the caller already has it (saves a lookup per leg). */
  known?: ScheduleSnapshot,
) {
  const snapshot = known?.id === b.snapshotId ? known : await snapshotOrThrow(deps, b.snapshotId);
  const window = itineraryLegBoardingWindow(b, b.legIndex ?? 0);
  return {
    bookingId: b.id,
    itineraryId: b.itineraryId,
    legIndex: b.legIndex,
    status: b.status,
    mode: b.mode,
    flightType: b.mode === "community" ? "community" : "individual",
    flightNumber: `${snapshot.operatingAirline}${snapshot.flightNumber}`,
    airline: { iata: snapshot.operatingAirline, name: AIRLINES_BY_IATA.get(snapshot.operatingAirline)?.name ?? snapshot.operatingAirline },
    passengerName: displayName,
    origin: airportView(airportOrThrow(snapshot.origin)),
    destination: airportView(airportOrThrow(snapshot.destination)),
    departure: displayTime(b.plannedDeparture, timeZone),
    arrival: displayTime(b.plannedArrival, timeZone),
    boardingOpensAt: displayTime(window.opensAt, timeZone),
    boardingClosesAt: displayTime(window.closesAt, timeZone),
    aircraft: aircraftView(snapshot.aircraftType),
    cabin: b.cabin,
    seat: b.seat,
    studyDurationMs: b.plannedArrival - b.plannedDeparture,
    studyGoal: b.studyGoal,
    breakSchedule: b.breakSchedule,
    isRandomDraw: b.isRandomDraw,
    operatingDate: snapshot.operatingDate,
    dataSource: snapshot.sourceStatus,
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  outside_booking_window: "Flights can be booked up to 7 days ahead",
  departure_in_past: "That departure time has passed",
  boarding_closed: "Boarding for this flight has closed",
  cabin_not_offered: "This flight does not offer that cabin",
  cabin_locked: "That cabin class is not unlocked yet",
  airline_locked: "That airline is not unlocked yet",
  missing_chosen_departure: "Choose a departure time",
  does_not_fit_study_window: "This flight does not fit your study window",
  private_not_scheduled: "Private aviation is not available on scheduled flights",
};

const LEG_BLOCK_MESSAGES: Record<string, string> = {
  itinerary_closed: "This itinerary has ended",
  previous_leg_not_boarded: "Fly the previous leg first",
  previous_leg_not_landed: "The previous leg has not landed yet",
  previous_leg_failed: "The previous leg was not completed",
};

export function bookingRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const user = requireUser(c.get("user"));
    const body = await parseJson(c, bookingSchema);
    const now = deps.clock.now();
    const settings = await getSettings(deps, user.id);
    const tz = settings.timeZone;
    let snapshot = await snapshotOrThrow(deps, body.snapshotId);
    const mode: DepartureMode = body.mode;

    let isRandomDraw = false;
    if (body.drawToken) {
      const claim = verifyRandomDraw(deps, body.drawToken, user.id, now);
      if (claim.snapshotId !== snapshot.id || claim.cabin !== body.cabin || mode === "community") {
        throw new ApiError(400, "invalid_draw_token", "Booking does not match the Random Flight draw");
      }
      isRandomDraw = true;
    }

    // Individual flights use the service's schedule for the chosen date (FR-003).
    const chosen = mode === "custom" ? body.chosenDeparture ?? null : null;
    if (mode === "custom" && chosen !== null && !isRandomDraw) snapshot = await snapshotForIndividualDate(deps, snapshot, chosen);

    const { unlocks } = await progressionFor(deps, user.id, tz, now);
    const errors = checkBookingRequest({
      mode,
      snapshot,
      cabin: body.cabin,
      now,
      userTimeZone: tz,
      chosenDeparture: chosen,
      studyWindow: body.studyWindow ?? null,
      unlocks,
      airlineTier: airlineTier(deps, snapshot.operatingAirline),
      isRandomDraw,
    });
    if (errors.length > 0) {
      throw new ApiError(422, errors[0]!, ERROR_MESSAGES[errors[0]!] ?? "Booking not allowed", { errors });
    }

    // One active booking at a time keeps the focus timer unambiguous.
    const planned = plannedTimes(mode, snapshot, { now, chosenDeparture: chosen });
    await markNoShows(deps, user.id, now);
    await assertNoFlightConflict(deps, user.id, [planned], now);

    await storeSnapshot(deps, snapshot);
    const aircraft = aircraftView(snapshot.aircraftType);
    const [created] = await deps.db
      .insert(bookings)
      .values({
        userId: user.id,
        snapshotId: snapshot.id,
        mode,
        cabin: body.cabin,
        seat: assignSeat(mode, seatMapFor(snapshot.aircraftType, aircraft.family), body.cabin, deps.random),
        plannedDeparture: planned.departure,
        plannedArrival: planned.arrival,
        studyWindowStart: body.studyWindow?.start ?? null,
        studyWindowEnd: body.studyWindow?.end ?? null,
        studyGoal: body.studyGoal ?? null,
        breakSchedule: body.breakSchedule ?? settings.breakSchedule,
        isRandomDraw,
        communityKey: mode === "community" ? communityFlightKey(snapshot) : null,
        createdAt: now,
      })
      .returning();
    return c.json({ boardingPass: await boardingPass(deps, created!, tz, user.displayName) }, 201);
  });

  app.get("/", async (c) => {
    const user = requireUser(c.get("user"));
    const now = deps.clock.now();
    await markNoShows(deps, user.id, now);
    const tz = (await getSettings(deps, user.id)).timeZone;
    const rows = await deps.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, user.id), inArray(bookings.status, ["booked", "boarded"]), gte(bookings.plannedArrival, now - 60 * 60_000)))
      .orderBy(asc(bookings.plannedDeparture));
    return c.json({ bookings: await Promise.all(rows.map((b) => boardingPass(deps, b, tz, user.displayName))) });
  });

  app.get("/:id", async (c) => {
    const user = requireUser(c.get("user"));
    const id = idParam(c, "Booking");
    await markNoShows(deps, user.id, deps.clock.now());
    const [b] = await deps.db.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.userId, user.id)));
    if (!b) throw notFound("Booking");
    const tz = (await getSettings(deps, user.id)).timeZone;
    return c.json({ boardingPass: await boardingPass(deps, b, tz, user.displayName) });
  });

  app.delete("/:id", async (c) => {
    const user = requireUser(c.get("user"));
    const id = idParam(c, "Booking");
    const [leg] = await deps.db
      .select({ itineraryId: bookings.itineraryId })
      .from(bookings)
      .where(and(eq(bookings.id, id), eq(bookings.userId, user.id)));
    if (leg?.itineraryId) {
      throw new ApiError(409, "itinerary_leg", "Connecting-flight legs are cancelled by abandoning the itinerary");
    }
    const cancelled = await deps.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.id, id), eq(bookings.userId, user.id), eq(bookings.status, "booked")))
      .returning({ id: bookings.id });
    if (cancelled.length === 0) throw new ApiError(409, "not_cancellable", "Only bookings not yet boarded can be cancelled");
    return c.json({ ok: true });
  });

  /**
   * Board the flight: creates the flight session (FR-004, FR-009). Itinerary legs: leg i+1 boards
   * only after leg i has landed; connecting legs board like Community Flights (15 minutes before
   * departure until takeoff, then the connection is missed); later individual legs are re-timed from
   * the boarded leg's actual times.
   */
  app.post("/:id/board", async (c) => {
    const user = requireUser(c.get("user"));
    const now = deps.clock.now();
    const settings = await getSettings(deps, user.id);
    const id = idParam(c, "Booking");
    const load = async () => (await deps.db.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.userId, user.id))))[0];
    let b = await load();
    if (!b) throw notFound("Booking");
    const legIndex = b.legIndex ?? 0;
    if (b.itineraryId !== null) {
      // Bring the itinerary up to date first: finalise landed legs, mark missed connections.
      await finalizeOpenSessions(deps, user.id, settings.timeZone, now);
      await markNoShows(deps, user.id, now);
      b = (await load())!;
    }
    if (b.status === "no_show" && b.itineraryId !== null && legIndex > 0) {
      throw new ApiError(409, "connection_missed", "Boarding has closed: connection missed");
    }
    if (b.status !== "booked") throw new ApiError(409, `booking_${b.status}`, `Booking is ${b.status.replace("_", "-")}`);
    if (b.itineraryId !== null) {
      const it = await loadItinerary(deps, b.itineraryId, user.id, now);
      const progress = legProgress(it).map((p, i) => ({ ...p, arrival: it.legs[i]!.session?.arrival ?? null }));
      const block = legBoardingBlock(progress, legIndex, now, { abandoned: it.row.status === "abandoned" });
      if (block !== null || isItineraryClosed(it.row.status)) {
        const code = block ?? "itinerary_closed";
        throw new ApiError(409, code, LEG_BLOCK_MESSAGES[code] ?? "This leg cannot be boarded");
      }
    }
    const result = boardFlight({
      booking: legBoardingTimes(b, legIndex),
      snapshotId: b.snapshotId,
      cabin: b.cabin,
      seat: b.seat,
      breakSchedule: b.breakSchedule,
      studyGoal: b.studyGoal,
      isPublic: settings.shareFlightsByDefault,
      now,
    });
    if (!result.ok) {
      if (result.error === "no_show") {
        await deps.db.update(bookings).set({ status: "no_show" }).where(and(eq(bookings.id, b.id), eq(bookings.status, "booked")));
        if (b.itineraryId !== null) await refreshItinerary(deps, await loadItinerary(deps, b.itineraryId, user.id, now), now);
      }
      const missed = result.error === "no_show" && legIndex > 0;
      throw new ApiError(
        409,
        missed ? "connection_missed" : result.error,
        result.error === "too_early" ? "Boarding has not opened yet" : missed ? "Boarding has closed: connection missed" : "Boarding has closed",
      );
    }
    // Connecting legs board with community rules but keep their own sharing rules.
    const s = { ...result.session, isPublic: b.mode === "community" ? false : settings.shareFlightsByDefault };
    const sessionId = await deps.db.transaction(async (tx) => {
      const updated = await tx
        .update(bookings)
        .set({ status: "boarded" })
        .where(and(eq(bookings.id, b.id), eq(bookings.status, "booked")))
        .returning({ id: bookings.id });
      if (updated.length === 0) throw new ApiError(409, "already_boarded", "Already boarded");
      const [row] = await tx
        .insert(flightSessions)
        .values({
          bookingId: b.id,
          userId: user.id,
          boardedAt: s.boardedAt,
          departure: s.departure,
          arrival: s.arrival,
          focusStart: s.focusStart,
          isPublic: s.isPublic,
        })
        .returning({ id: flightSessions.id });
      await tx.insert(attendanceSignals).values(s.signals.map((sig) => ({ sessionId: row!.id, kind: sig.kind, at: sig.at })));
      return row!.id;
    });
    if (b.itineraryId !== null) {
      const it = await loadItinerary(deps, b.itineraryId, user.id, now);
      if (it.row.mode === "individual") {
        // Later legs keep the published layover after this leg's actual arrival (FR-042).
        const plans = recomputeItineraryTimes(
          "individual",
          it.legs.map((l) => l.snapshot),
          it.legs.map((l, i) => ({ legIndex: i, mode: l.booking.mode, departure: l.booking.plannedDeparture, arrival: l.booking.plannedArrival })),
          { legIndex, departure: s.departure, arrival: s.arrival },
        );
        for (const leg of it.legs.slice(legIndex + 1)) {
          const plan = plans[leg.booking.legIndex ?? 0]!;
          if (leg.booking.status !== "booked") continue;
          if (plan.departure === leg.booking.plannedDeparture && plan.arrival === leg.booking.plannedArrival) continue;
          // A shifted leg must still be bookable: inside the booking window and not overlapping
          // another flight. Otherwise it is cancelled and the refresh below makes the itinerary
          // incomplete (and cancels any later legs) instead of silently keeping it.
          const allowed =
            isWithinBookingWindow(plan.departure, now, settings.timeZone) &&
            (await findFlightConflict(deps, user.id, [plan], now, { itinerary: true, excludeItineraryId: it.row.id })) === null;
          await deps.db
            .update(bookings)
            .set(allowed ? { plannedDeparture: plan.departure, plannedArrival: plan.arrival } : { status: "cancelled" })
            .where(and(eq(bookings.id, leg.booking.id), eq(bookings.status, "booked")));
          if (!allowed) break;
        }
      }
      await refreshItinerary(deps, await loadItinerary(deps, b.itineraryId, user.id, now), now);
    }
    invalidateCommunityCache(deps);
    return c.json({ sessionId }, 201);
  });

  return app;
}

