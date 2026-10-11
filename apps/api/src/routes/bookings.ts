import {
  assignSeat,
  boardFlight,
  boardingWindow,
  checkBookingRequest,
  communityFlightKey,
  displayTime,
  plannedTimes,
  type DepartureMode,
} from "@aerofocus/core";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser, type AppEnv } from "../auth";
import type { AppDeps } from "../context";
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
import { markNoShows, progressionFor, type BookingRow } from "../services/sessions";
import { getSettings } from "../services/users";
import { AIRLINES_BY_IATA, seatMapFor } from "@aerofocus/data";
import { breakScheduleSchema, cabinSchema } from "./common";

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

/** Virtual boarding pass (FR-008). Times are shown in the user's local time zone. */
export async function boardingPass(deps: AppDeps, b: BookingRow, timeZone: string, displayName: string | null) {
  const snapshot = await snapshotOrThrow(deps, b.snapshotId);
  const window = boardingWindow(b);
  return {
    bookingId: b.id,
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
    const active = await deps.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.userId, user.id), eq(bookings.status, "boarded")));
    const openSessions = active.length
      ? await deps.db
          .select({ id: flightSessions.id, finalizedAt: flightSessions.finalizedAt, arrival: flightSessions.arrival })
          .from(flightSessions)
          .where(inArray(flightSessions.bookingId, active.map((a) => a.id)))
      : [];
    const planned = plannedTimes(mode, snapshot, { now, chosenDeparture: chosen });
    if (openSessions.some((s) => s.finalizedAt === null && s.arrival > planned.departure)) {
      throw new ApiError(409, "flight_in_progress", "Finish or leave your current flight first");
    }

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
    await markNoShows(deps, user.id, deps.clock.now());
    const [b] = await deps.db.select().from(bookings).where(and(eq(bookings.id, c.req.param("id")), eq(bookings.userId, user.id)));
    if (!b) throw notFound("Booking");
    const tz = (await getSettings(deps, user.id)).timeZone;
    return c.json({ boardingPass: await boardingPass(deps, b, tz, user.displayName) });
  });

  app.delete("/:id", async (c) => {
    const user = requireUser(c.get("user"));
    const cancelled = await deps.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.id, c.req.param("id")), eq(bookings.userId, user.id), eq(bookings.status, "booked")))
      .returning({ id: bookings.id });
    if (cancelled.length === 0) throw new ApiError(409, "not_cancellable", "Only bookings not yet boarded can be cancelled");
    return c.json({ ok: true });
  });

  /** Board the flight: creates the flight session (FR-004, FR-009). */
  app.post("/:id/board", async (c) => {
    const user = requireUser(c.get("user"));
    const now = deps.clock.now();
    const [b] = await deps.db.select().from(bookings).where(and(eq(bookings.id, c.req.param("id")), eq(bookings.userId, user.id)));
    if (!b) throw notFound("Booking");
    if (b.status !== "booked") throw new ApiError(409, `booking_${b.status}`, `Booking is ${b.status.replace("_", "-")}`);
    const settings = await getSettings(deps, user.id);
    const result = boardFlight({
      booking: b,
      snapshotId: b.snapshotId,
      cabin: b.cabin,
      seat: b.seat,
      breakSchedule: b.breakSchedule,
      studyGoal: b.studyGoal,
      isPublic: settings.shareFlightsByDefault,
      now,
    });
    if (!result.ok) {
      if (result.error === "no_show") await deps.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, b.id));
      throw new ApiError(409, result.error, result.error === "too_early" ? "Boarding has not opened yet" : "Boarding has closed");
    }
    const s = result.session;
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
    deps.communityCache = null;
    return c.json({ sessionId }, 201);
  });

  return app;
}

