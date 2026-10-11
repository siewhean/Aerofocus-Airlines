import {
  ACHIEVEMENTS,
  buildGreatCircleRoute,
  buildTravelMark,
  localDate,
  splitAtAntimeridian,
  computeStats,
  isValidPassportColour,
  nextVisitNumber,
  validateGuestImport,
  type GuestFlightImport,
  type ScheduleSnapshot,
} from "@aerofocus/core";
import { AIRPORTS_BY_IATA } from "@aerofocus/data";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser, type AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { achievements, bookings, flightSessions, importedFlights, scheduleSnapshots, travelMarks, userSettings, users } from "../db/schema";
import { ApiError, parseJson, parseQuery } from "../errors";
import { aircraftView, airportView, findSnapshot, storeSnapshot } from "../services/catalogue";
import { finalizeOpenSessions, markNoShows, progressionFor, refreshAchievements, userRecords } from "../services/sessions";
import { getSettings, getUser, settingsView } from "../services/users";
import { breakScheduleSchema, timeZoneSchema } from "./common";

const settingsPatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).nullable(),
    timeZone: timeZoneSchema,
    homeAirport: z
      .string()
      .refine((iata) => AIRPORTS_BY_IATA.has(iata), "Unsupported airport")
      .nullable(),
    passportColour: z.string().refine(isValidPassportColour, "Unsupported passport colour"),
    breakSchedule: breakScheduleSchema,
    shareFlightsByDefault: z.boolean(),
    showCommunityFlights: z.boolean(),
    preferredAirlines: z.array(z.string().max(3)).max(50),
    notifications: z.object({
      boardingReminder: z.boolean(),
      breakEnd: z.boolean(),
      landing: z.boolean(),
      channel: z.enum(["push", "sound", "both", "none"]),
    }),
    uiPreferences: z.record(z.string(), z.unknown()),
  })
  .partial();

const guestRecordSchema = z.object({
  snapshotId: z.string(),
  outcome: z.enum(["complete", "invalid", "ended_early", "no_show"]),
  departure: z.number(),
  arrival: z.number(),
  blockMs: z.number(),
  creditedFocusMs: z.number().min(0),
  breakMs: z.number().min(0),
  creditedFlightMs: z.number().min(0),
  origin: z.string(),
  destination: z.string(),
  destinationCountry: z.string(),
  airline: z.string(),
  aircraftType: z.string().nullable(),
  distanceKm: z.number().min(0),
  validatedAt: z.number().nullable(),
  studyGoal: z.string().max(500).nullable(),
  goalCompleted: z.boolean().nullable(),
});

export function meRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const user = requireUser(c.get("user"));
    const [profile, settings] = await Promise.all([getUser(deps, user.id), getSettings(deps, user.id)]);
    return c.json({ user: profile, settings: settingsView(settings) });
  });

  app.patch("/settings", async (c) => {
    const user = requireUser(c.get("user"));
    const { displayName, ...patch } = await parseJson(c, settingsPatchSchema);
    if (Object.keys(patch).length > 0) await deps.db.update(userSettings).set(patch).where(eq(userSettings.userId, user.id));
    if (displayName !== undefined) {
      await deps.db.update(users).set({ displayName }).where(eq(users.id, user.id));
    }
    // Changing passport colour never touches collected marks (AC-12).
    return c.json({ settings: settingsView(await getSettings(deps, user.id)) });
  });

  app.get("/progression", async (c) => {
    const user = requireUser(c.get("user"));
    const tz = (await getSettings(deps, user.id)).timeZone;
    const p = await progressionFor(deps, user.id, tz, deps.clock.now());
    return c.json(p);
  });

  app.get("/stats", async (c) => {
    const user = requireUser(c.get("user"));
    const tz = (await getSettings(deps, user.id)).timeZone;
    const now = deps.clock.now();
    await finalizeOpenSessions(deps, user.id, tz, now);
    await markNoShows(deps, user.id, now);
    return c.json({ stats: computeStats(await userRecords(deps, user.id), now, tz) });
  });

  app.get("/history", async (c) => {
    const user = requireUser(c.get("user"));
    const { limit } = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
    const tz = (await getSettings(deps, user.id)).timeZone;
    const now = deps.clock.now();
    await finalizeOpenSessions(deps, user.id, tz, now);
    const rows = await deps.db
      .select({ session: flightSessions, booking: bookings, snapshot: scheduleSnapshots.data })
      .from(flightSessions)
      .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
      .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, bookings.snapshotId))
      .where(eq(flightSessions.userId, user.id))
      .orderBy(desc(flightSessions.departure))
      .limit(limit);
    const marks = await deps.db.select().from(travelMarks).where(eq(travelMarks.userId, user.id));
    const markBySession = new Map(marks.map((m) => [m.sessionId, m]));
    return c.json({
      flights: rows.map(({ session, booking, snapshot }) => ({
        sessionId: session.id,
        flightNumber: `${snapshot.operatingAirline}${snapshot.flightNumber}`,
        airline: snapshot.operatingAirline,
        origin: snapshot.origin,
        destination: snapshot.destination,
        aircraft: aircraftView(snapshot.aircraftType),
        cabin: booking.cabin,
        mode: booking.mode,
        itineraryId: booking.itineraryId,
        legIndex: booking.legIndex,
        scheduledBlockMs: snapshot.arrival - snapshot.departure,
        departure: session.departure,
        arrival: session.arrival,
        status: session.outcome ?? "in_flight",
        creditedFocusMs: session.creditedFocusMs,
        breakMs: session.breakMs,
        studyGoal: booking.studyGoal,
        goalCompleted: session.goalCompleted,
        travelMark: markBySession.get(session.id) ?? null,
        dataSource: snapshot.sourceStatus,
      })),
    });
  });

  /**
   * Personal globe (FR-053): every completed leg as its own route line, visited airports with visit
   * counts, and countries. Filters: airline, country (ISO alpha-2 of destination), from/to (epoch ms).
   * Positions are great-circle estimates; distances are virtual, not physical travel (FR-054).
   */
  app.get("/globe", async (c) => {
    const user = requireUser(c.get("user"));
    const q = parseQuery(
      c,
      z.object({
        airline: z.string().max(3).optional(),
        country: z.string().length(2).optional(),
        from: z.coerce.number().optional(),
        to: z.coerce.number().optional(),
      }),
    );
    const settings = await getSettings(deps, user.id);
    await finalizeOpenSessions(deps, user.id, settings.timeZone, deps.clock.now());
    const sessions = await deps.db
      .select({ session: flightSessions, snapshot: scheduleSnapshots.data, itineraryId: bookings.itineraryId, legIndex: bookings.legIndex })
      .from(flightSessions)
      .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
      .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, bookings.snapshotId))
      .where(eq(flightSessions.userId, user.id));
    const marks = await deps.db
      .select({ sessionId: travelMarks.sessionId, isTransit: travelMarks.isTransit })
      .from(travelMarks)
      .where(eq(travelMarks.userId, user.id));
    const transitSessions = new Set(marks.filter((m) => m.isTransit).map((m) => m.sessionId));
    const imported = await deps.db
      .select({ row: importedFlights, snapshot: scheduleSnapshots.data })
      .from(importedFlights)
      .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, importedFlights.snapshotId))
      .where(eq(importedFlights.userId, user.id));
    const legs = [
      ...sessions
        .filter((r) => r.session.outcome === "complete")
        .map((r) => ({
          id: r.session.id, snapshot: r.snapshot, departure: r.session.departure, arrival: r.session.arrival,
          itineraryId: r.itineraryId, legIndex: r.legIndex, isTransit: transitSessions.has(r.session.id),
        })),
      ...imported
        .filter((r) => r.row.outcome === "complete")
        .map((r) => ({ id: r.row.id, snapshot: r.snapshot, departure: r.row.departure, arrival: r.row.arrival, itineraryId: null, legIndex: null, isTransit: false })),
    ]
      .filter((l) => !q.airline || l.snapshot.operatingAirline === q.airline)
      .filter((l) => !q.country || AIRPORTS_BY_IATA.get(l.snapshot.destination)?.country === q.country)
      .filter((l) => (q.from === undefined || l.departure >= q.from) && (q.to === undefined || l.departure <= q.to))
      .sort((a, b) => a.departure - b.departure);

    const visits = new Map<string, number>();
    const features: unknown[] = legs.map((l) => {
      const origin = AIRPORTS_BY_IATA.get(l.snapshot.origin)!;
      const destination = AIRPORTS_BY_IATA.get(l.snapshot.destination)!;
      visits.set(origin.iata, (visits.get(origin.iata) ?? 0) + 1);
      visits.set(destination.iata, (visits.get(destination.iata) ?? 0) + 1);
      return {
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates: splitAtAntimeridian(buildGreatCircleRoute(origin, destination, 48).points) },
        properties: {
          kind: "leg",
          legId: l.id,
          flightNumber: `${l.snapshot.operatingAirline}${l.snapshot.flightNumber}`,
          airline: l.snapshot.operatingAirline,
          origin: origin.iata,
          destination: destination.iata,
          destinationCountry: destination.country,
          departure: l.departure,
          arrivalDate: localDate(l.arrival, settings.timeZone),
          blockMs: l.arrival - l.departure,
          itineraryId: l.itineraryId,
          legIndex: l.legIndex,
          /** Landed at an intermediate (layover) airport (FR-048). */
          isTransit: l.isTransit,
          estimated: true,
        },
      };
    });
    for (const [iata, count] of visits) {
      const a = AIRPORTS_BY_IATA.get(iata)!;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        properties: { kind: "airport", iata, name: a.name, city: a.city, country: a.country, visits: count },
      });
    }
    const countries = [...new Set(legs.map((l) => AIRPORTS_BY_IATA.get(l.snapshot.destination)?.country).filter(Boolean))];
    return c.json({ type: "FeatureCollection", features, countries, legCount: legs.length });
  });

  app.get("/passport", async (c) => {
    const user = requireUser(c.get("user"));
    const settings = await getSettings(deps, user.id);
    await finalizeOpenSessions(deps, user.id, settings.timeZone, deps.clock.now());
    const marks = await deps.db.select().from(travelMarks).where(eq(travelMarks.userId, user.id)).orderBy(travelMarks.createdAt);
    // Visits per country, split into transit and final arrivals (FR-050).
    const visits = new Map<string, { visits: number; transit: number; final: number }>();
    for (const m of marks) {
      const v = visits.get(m.country) ?? { visits: 0, transit: 0, final: 0 };
      v.visits++;
      if (m.isTransit) v.transit++;
      else v.final++;
      visits.set(m.country, v);
    }
    return c.json({
      cover: settings.passportColour,
      marks,
      countries: [...visits].map(([country, v]) => ({ country, ...v })),
      airports: [...new Set(marks.map((m) => m.airport))].map((iata) => {
        const a = AIRPORTS_BY_IATA.get(iata);
        return a ? airportView(a) : { iata };
      }),
    });
  });

  app.get("/achievements", async (c) => {
    const user = requireUser(c.get("user"));
    const earned = await deps.db.select().from(achievements).where(eq(achievements.userId, user.id));
    const earnedAt = new Map(earned.map((e) => [e.achievementId, e.earnedAt]));
    return c.json({
      achievements: ACHIEVEMENTS.map(({ id, name, description, category, special }) => ({
        id, name, description, category, special, earnedAt: earnedAt.get(id) ?? null,
      })),
    });
  });

  /** Imports device-stored guest history after account creation (FR-071, AC-21). */
  app.post("/import-guest", async (c) => {
    const user = requireUser(c.get("user"));
    const { records } = await parseJson(c, z.object({ records: z.array(guestRecordSchema).max(1000) }));
    const settings = await getSettings(deps, user.id);
    const now = deps.clock.now();
    const snapshots = new Map<string, ScheduleSnapshot>();
    for (const id of new Set(records.map((r) => r.snapshotId))) {
      const s = await findSnapshot(deps, id);
      if (s) snapshots.set(id, s);
    }
    // Server-side facts override anything the device claims about the flight.
    const normalized: GuestFlightImport[] = records.map((r) => {
      const s = snapshots.get(r.snapshotId);
      const destination = s ? AIRPORTS_BY_IATA.get(s.destination) : undefined;
      return s && destination
        ? { ...r, origin: s.origin, destination: s.destination, destinationCountry: destination.country, airline: s.operatingAirline, aircraftType: s.aircraftType }
        : r;
    });
    const result = validateGuestImport(normalized, snapshots, now);
    let imported = 0;
    for (const record of result.accepted) {
      const snapshot = snapshots.get(record.snapshotId);
      if (!snapshot) continue;
      await storeSnapshot(deps, snapshot);
      const inserted = await deps.db
        .insert(importedFlights)
        .values({
          userId: user.id,
          snapshotId: record.snapshotId,
          outcome: record.outcome,
          departure: record.departure,
          arrival: record.arrival,
          creditedFocusMs: record.creditedFocusMs,
          breakMs: record.breakMs,
          creditedFlightMs: record.creditedFlightMs,
          studyGoal: record.studyGoal,
          goalCompleted: record.goalCompleted,
          importedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: importedFlights.id });
      if (inserted.length === 0) continue;
      imported++;
      if (record.outcome === "complete") {
        const previous = await deps.db
          .select({ country: travelMarks.country })
          .from(travelMarks)
          .where(eq(travelMarks.userId, user.id));
        const mark = buildTravelMark({
          snapshot,
          destinationCountry: record.destinationCountry,
          arrival: record.arrival,
          userTimeZone: settings.timeZone,
          designs: deps.designs,
          visitNumber: nextVisitNumber(previous, record.destinationCountry),
        });
        await deps.db.insert(travelMarks).values({ userId: user.id, sessionId: null, ...mark, createdAt: now });
      }
    }
    await refreshAchievements(deps, user.id, settings.timeZone, now);
    if (imported === 0 && result.accepted.length > 0) {
      throw new ApiError(409, "already_imported", "These flights were already imported");
    }
    return c.json({
      imported,
      rejected: result.rejected.map((r) => ({ snapshotId: r.record.snapshotId, departure: r.record.departure, reason: r.reason })),
    });
  });

  return app;
}
