import {
  ACHIEVEMENTS,
  buildTravelMark,
  computeStats,
  createFlightPlan,
  earnedAchievements,
  greatCircleDistanceKm,
  itineraryLegBoardingDecision,
  levelFor,
  loungeAccess,
  nextVisitNumber,
  nextLevelProgress,
  planForSession,
  routeFacts,
  sessionView,
  summarize,
  unlockStateFor,
  type FlightRecord,
  type FlightSessionData,
  type Instant,
  type ProgressStats,
  type ScheduleSnapshot,
  type UnlockState,
} from "@aerofocus/core";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDeps } from "../context";
import {
  achievements,
  attendanceSignals,
  bookings,
  flightSessions,
  focusEvents,
  importedFlights,
  itineraries,
  scheduleSnapshots,
  travelMarks,
  users,
} from "../db/schema";
import { ApiError, notFound } from "../errors";
import { airportOrThrow, findSnapshot } from "./catalogue";
import { refreshItineraryById, refreshUserItineraries } from "./itineraries";

export type BookingRow = typeof bookings.$inferSelect;
export type SessionRow = typeof flightSessions.$inferSelect;

export interface LoadedSession {
  row: SessionRow;
  booking: BookingRow;
  snapshot: ScheduleSnapshot;
  data: FlightSessionData;
}

const FINAL_OUTCOMES = new Set(["complete", "invalid", "ended_early"]);

export async function loadSession(deps: AppDeps, sessionId: string, userId: string): Promise<LoadedSession> {
  const [joined] = await deps.db
    .select({ row: flightSessions, booking: bookings })
    .from(flightSessions)
    .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
    .where(and(eq(flightSessions.id, sessionId), eq(flightSessions.userId, userId)))
    .limit(1);
  if (!joined) throw notFound("Flight session");
  return hydrate(deps, joined.row, joined.booking);
}

async function hydrate(deps: AppDeps, row: SessionRow, booking: BookingRow): Promise<LoadedSession> {
  const [events, signals, snapshot] = await Promise.all([
    deps.db.select().from(focusEvents).where(eq(focusEvents.sessionId, row.id)).orderBy(asc(focusEvents.at), asc(focusEvents.id)),
    deps.db
      .select()
      .from(attendanceSignals)
      .where(eq(attendanceSignals.sessionId, row.id))
      .orderBy(asc(attendanceSignals.at), asc(attendanceSignals.id)),
    findSnapshot(deps, booking.snapshotId),
  ]);
  if (!snapshot) throw new ApiError(500, "snapshot_missing", "Booked schedule snapshot is missing");
  const data: FlightSessionData = {
    mode: booking.mode,
    snapshotId: booking.snapshotId,
    cabin: booking.cabin,
    seat: booking.seat,
    boardedAt: row.boardedAt,
    departure: row.departure,
    arrival: row.arrival,
    focusStart: row.focusStart,
    breakSchedule: booking.breakSchedule,
    events: events.map((e) => ({ type: e.type, at: e.at })),
    signals: signals.map((s) => ({ kind: s.kind, at: s.at })),
    exitedAt: row.exitedAt,
    validatedAt: row.validatedAt,
    confirmedUnattendedStarts: row.confirmedUnattendedStarts,
    isPublic: row.isPublic,
    studyGoal: booking.studyGoal,
    goalCompleted: row.goalCompleted,
  };
  return { row, booking, snapshot, data };
}

/** Persists the difference between the loaded session and its next state. Events are append-only. */
export async function saveSession(deps: AppDeps, loaded: LoadedSession, next: FlightSessionData): Promise<LoadedSession> {
  const newEvents = next.events.slice(loaded.data.events.length);
  const newSignals = next.signals.slice(loaded.data.signals.length);
  await deps.db.transaction(async (tx) => {
    if (newEvents.length > 0) {
      await tx.insert(focusEvents).values(newEvents.map((e) => ({ sessionId: loaded.row.id, type: e.type, at: e.at })));
    }
    if (newSignals.length > 0) {
      await tx.insert(attendanceSignals).values(newSignals.map((s) => ({ sessionId: loaded.row.id, kind: s.kind, at: s.at })));
    }
    if (
      next.exitedAt !== loaded.data.exitedAt ||
      next.validatedAt !== loaded.data.validatedAt ||
      next.isPublic !== loaded.data.isPublic ||
      next.goalCompleted !== loaded.data.goalCompleted ||
      next.confirmedUnattendedStarts !== loaded.data.confirmedUnattendedStarts
    ) {
      await tx
        .update(flightSessions)
        .set({
          exitedAt: next.exitedAt,
          validatedAt: next.validatedAt,
          isPublic: next.isPublic,
          goalCompleted: next.goalCompleted,
          confirmedUnattendedStarts: next.confirmedUnattendedStarts,
        })
        .where(eq(flightSessions.id, loaded.row.id));
    }
  });
  return { ...loaded, data: next };
}

/**
 * Records the final outcome once it is known: complete, invalid or ended early. Idempotent: the
 * update only applies while finalized_at is null, so rewards are never awarded twice (NFR-007).
 */
export async function finalizeIfDone(deps: AppDeps, loaded: LoadedSession, userTimeZone: string, now: Instant): Promise<boolean> {
  if (loaded.row.finalizedAt !== null) return false;
  const summary = summarize(loaded.data, now);
  if (!FINAL_OUTCOMES.has(summary.outcome)) return false;
  const destination = airportOrThrow(loaded.snapshot.destination);
  const finalized = await deps.db.transaction(async (tx) => {
    // Per-user lock: concurrent finalisations into the same country must not read the same previous
    // marks and get the same visitNumber (FR-050). Held until the mark is inserted.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, loaded.row.userId)).for("update");
    const updated = await tx
      .update(flightSessions)
      .set({
        outcome: summary.outcome,
        creditedFocusMs: summary.creditedFocusMs,
        breakMs: summary.breakMs,
        creditedFlightMs: summary.creditedFlightMs,
        finalizedAt: now,
      })
      .where(and(eq(flightSessions.id, loaded.row.id), isNull(flightSessions.finalizedAt)))
      .returning({ id: flightSessions.id });
    if (updated.length === 0) return false;
    if (summary.outcome === "complete") {
      // Intermediate airports of an itinerary get a transit mark; the final destination a normal
      // arrival mark (FR-048, FR-049). visitNumber counts transit and final arrivals (FR-050).
      let isTransit = false;
      const { itineraryId, legIndex } = loaded.booking;
      if (itineraryId !== null && legIndex !== null) {
        const legs = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.itineraryId, itineraryId));
        isTransit = legIndex < legs.length - 1;
      }
      const previous = await tx
        .select({ country: travelMarks.country })
        .from(travelMarks)
        .where(and(eq(travelMarks.userId, loaded.row.userId), eq(travelMarks.country, destination.country)));
      const mark = buildTravelMark({
        snapshot: loaded.snapshot,
        destinationCountry: destination.country,
        arrival: loaded.data.arrival,
        userTimeZone,
        designs: deps.designs,
        isTransit,
        visitNumber: nextVisitNumber(previous, destination.country),
      });
      await tx
        .insert(travelMarks)
        .values({ userId: loaded.row.userId, sessionId: loaded.row.id, ...mark, createdAt: now })
        .onConflictDoNothing();
    }
    return true;
  });
  if (finalized) {
    // Journey achievements need the itinerary's refreshed status (FR-045).
    if (loaded.booking.itineraryId !== null) await refreshItineraryById(deps, loaded.booking.itineraryId, now);
    await refreshAchievements(deps, loaded.row.userId, userTimeZone, now);
  }
  return finalized;
}

/** Finalises every session of a user whose outcome is now known (e.g. validation window lapsed). */
export async function finalizeOpenSessions(deps: AppDeps, userId: string, userTimeZone: string, now: Instant): Promise<void> {
  const open = await deps.db
    .select({ row: flightSessions, booking: bookings })
    .from(flightSessions)
    .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
    .where(and(eq(flightSessions.userId, userId), isNull(flightSessions.finalizedAt)));
  for (const { row, booking } of open) {
    const loaded = await hydrate(deps, row, booking);
    await finalizeIfDone(deps, loaded, userTimeZone, now);
  }
}

/**
 * Marks bookings whose boarding window has closed as no-shows (FR-004), then refreshes itineraries.
 * Connecting legs use the connecting-leg window (missed connection) and are only marked once the
 * previous leg was boarded; otherwise the itinerary refresh cancels them.
 */
export async function markNoShows(deps: AppDeps, userId: string, now: Instant): Promise<void> {
  const open = await deps.db.select().from(bookings).where(and(eq(bookings.userId, userId), eq(bookings.status, "booked")));
  const itineraryIds = [...new Set(open.map((b) => b.itineraryId).filter((id): id is string => id !== null))];
  const legs = itineraryIds.length
    ? await deps.db
        .select({ itineraryId: bookings.itineraryId, legIndex: bookings.legIndex, status: bookings.status })
        .from(bookings)
        .where(inArray(bookings.itineraryId, itineraryIds))
    : [];
  const previousBoarded = (b: BookingRow): boolean =>
    legs.some((l) => l.itineraryId === b.itineraryId && l.legIndex === (b.legIndex ?? 0) - 1 && l.status === "boarded");
  const lapsed = open
    .filter((b) => b.itineraryId === null || (b.legIndex ?? 0) === 0 || previousBoarded(b))
    .filter((b) => itineraryLegBoardingDecision(b, b.legIndex ?? 0, now) === "no_show")
    .map((b) => b.id);
  if (lapsed.length > 0) {
    await deps.db.update(bookings).set({ status: "no_show" }).where(and(inArray(bookings.id, lapsed), eq(bookings.status, "booked")));
  }
  await refreshUserItineraries(deps, userId, now);
}

export async function userRecords(deps: AppDeps, userId: string): Promise<FlightRecord[]> {
  const sessions = await deps.db
    .select({ row: flightSessions, snapshot: scheduleSnapshots.data, mode: bookings.mode, booking: bookings })
    .from(flightSessions)
    .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
    .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, bookings.snapshotId))
    .where(eq(flightSessions.userId, userId));
  const imported = await deps.db
    .select({ row: importedFlights, snapshot: scheduleSnapshots.data })
    .from(importedFlights)
    .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, importedFlights.snapshotId))
    .where(eq(importedFlights.userId, userId));
  const noShows = await deps.db
    .select({ booking: bookings, snapshot: scheduleSnapshots.data })
    .from(bookings)
    .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, bookings.snapshotId))
    .where(and(eq(bookings.userId, userId), eq(bookings.status, "no_show")));

  // Itinerary fields (FR-041, FR-050): legs, status, transit, layover and lounge per leg.
  const userItineraries = await deps.db
    .select({ id: itineraries.id, status: itineraries.status })
    .from(itineraries)
    .where(eq(itineraries.userId, userId));
  const itineraryLegs = userItineraries.length
    ? await deps.db
        .select({ booking: bookings, departure: flightSessions.departure, arrival: flightSessions.arrival })
        .from(bookings)
        .leftJoin(flightSessions, eq(flightSessions.bookingId, bookings.id))
        .where(inArray(bookings.itineraryId, userItineraries.map((i) => i.id)))
    : [];
  const statusById = new Map(userItineraries.map((i) => [i.id, i.status]));
  const itineraryFields = (b: BookingRow, arrival: Instant | null): Partial<FlightRecord> => {
    if (b.itineraryId === null || b.legIndex === null) return {};
    const legs = itineraryLegs.filter((l) => l.booking.itineraryId === b.itineraryId);
    const next = legs.find((l) => l.booking.legIndex === (b.legIndex as number) + 1);
    const isTransit = next !== undefined;
    return {
      itineraryId: b.itineraryId,
      legIndex: b.legIndex,
      itineraryLegs: legs.length,
      itineraryStatus: statusById.get(b.itineraryId) ?? null,
      isTransit,
      layoverMs: next && next.departure !== null && arrival !== null ? next.departure - arrival : null,
      premiumLounge: next ? loungeAccess(b.cabin, next.booking.cabin) === "premium" : false,
      layoverFocusMs: b.layoverFocusMs,
    };
  };

  const base = (s: ScheduleSnapshot) => {
    const origin = airportOrThrow(s.origin);
    const destination = airportOrThrow(s.destination);
    return {
      origin: s.origin,
      destination: s.destination,
      destinationCountry: destination.country,
      airline: s.operatingAirline,
      aircraftType: s.aircraftType,
      distanceKm: greatCircleDistanceKm(origin, destination),
    };
  };
  /** Route facts for achievements, only needed for completed flights. */
  const facts = (s: ScheduleSnapshot, departure: number, arrival: number) =>
    routeFacts(
      createFlightPlan({ origin: airportOrThrow(s.origin), destination: airportOrThrow(s.destination), departure, blockMs: arrival - departure }),
    );
  const records: FlightRecord[] = [];
  for (const { row, snapshot, mode, booking } of sessions) {
    if (row.outcome === null || !FINAL_OUTCOMES.has(row.outcome)) continue;
    records.push({
      ...base(snapshot),
      ...itineraryFields(booking, row.arrival),
      mode,
      ...(row.outcome === "complete" ? { facts: facts(snapshot, row.departure, row.arrival) } : {}),
      outcome: row.outcome as FlightRecord["outcome"],
      departure: row.departure,
      arrival: row.arrival,
      blockMs: row.arrival - row.departure,
      creditedFocusMs: row.creditedFocusMs ?? 0,
      breakMs: row.breakMs ?? 0,
      creditedFlightMs: row.creditedFlightMs ?? 0,
    });
  }
  for (const { row, snapshot } of imported) {
    records.push({
      ...base(snapshot),
      ...(row.outcome === "complete" ? { facts: facts(snapshot, row.departure, row.arrival) } : {}),
      outcome: row.outcome as FlightRecord["outcome"],
      departure: row.departure,
      arrival: row.arrival,
      blockMs: row.arrival - row.departure,
      creditedFocusMs: row.creditedFocusMs,
      breakMs: row.breakMs,
      creditedFlightMs: row.creditedFlightMs,
    });
  }
  for (const { booking, snapshot } of noShows) {
    records.push({
      ...base(snapshot),
      ...itineraryFields(booking, null),
      outcome: "no_show",
      departure: booking.plannedDeparture,
      arrival: booking.plannedArrival,
      blockMs: booking.plannedArrival - booking.plannedDeparture,
      creditedFocusMs: 0,
      breakMs: 0,
      creditedFlightMs: 0,
    });
  }
  return records.sort((a, b) => a.departure - b.departure);
}

export async function refreshAchievements(deps: AppDeps, userId: string, userTimeZone: string, now: Instant): Promise<void> {
  const records = await userRecords(deps, userId);
  const earned = earnedAchievements(computeStats(records, now, userTimeZone), records, now);
  if (earned.length === 0) return;
  await deps.db
    .insert(achievements)
    .values(earned.map((a) => ({ userId, achievementId: a.id, earnedAt: now })))
    .onConflictDoNothing();
}

export interface Progression {
  stats: ProgressStats;
  level: ReturnType<typeof levelFor>;
  next: ReturnType<typeof nextLevelProgress>;
  unlocks: UnlockState;
}

export async function progressionFor(deps: AppDeps, userId: string, userTimeZone: string, now: Instant): Promise<Progression> {
  await finalizeOpenSessions(deps, userId, userTimeZone, now);
  const records = await userRecords(deps, userId);
  const stats = computeStats(records, now, userTimeZone);
  const earned = await deps.db.select().from(achievements).where(eq(achievements.userId, userId));
  const special = new Set(ACHIEVEMENTS.filter((a) => a.special).map((a) => a.id));
  const progress: ProgressStats = {
    creditedFocusMs: stats.creditedFocusMs,
    completedFlights: stats.completedFlights,
    countries: stats.countriesCollected,
    specialAchievements: earned.filter((e) => special.has(e.achievementId)).length,
  };
  return { stats: progress, level: levelFor(progress), next: nextLevelProgress(progress), unlocks: unlockStateFor(progress) };
}

export function viewFor(loaded: LoadedSession, now: Instant) {
  const plan = planForSession(loaded.data, airportOrThrow(loaded.snapshot.origin), airportOrThrow(loaded.snapshot.destination));
  return { plan, view: sessionView(loaded.data, plan, now) };
}
