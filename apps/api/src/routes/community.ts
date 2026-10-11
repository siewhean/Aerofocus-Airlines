import {
  blockDurationMs,
  communityFlightKey,
  isUnattendedAt,
  toPublicAirport,
  type PublicFlightDescriptor,
} from "@aerofocus/core";
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { attendanceSignals, bookings, flightSessions, scheduleSnapshots } from "../db/schema";
import { ApiError, parseJson } from "../errors";
import { airportOrThrow } from "../services/catalogue";

const COMMUNITY_KEY_RE = /^([A-Z0-9]{2})(\d{1,4}):(\d{4}-\d{2}-\d{2})$/;

export function communityRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  /**
   * Active public flights (FR-055, FR-056). Only origin, destination and what is needed to compute
   * the position are returned; viewers compute positions locally (FR-062). Hiding other flights is
   * a client setting and does not affect the viewer's own flight (FR-057).
   */
  app.get("/flights", async (c) => {
    const now = deps.clock.now();
    const rows = await deps.db
      .select({ session: flightSessions, booking: bookings, snapshot: scheduleSnapshots.data })
      .from(flightSessions)
      .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
      .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, bookings.snapshotId))
      .where(
        and(
          isNull(flightSessions.exitedAt),
          isNull(flightSessions.finalizedAt),
          lte(flightSessions.departure, now),
          gt(flightSessions.arrival, now),
        ),
      );

    const ids = rows.map((r) => r.session.id);
    const signals = ids.length
      ? await deps.db
          .select()
          .from(attendanceSignals)
          .where(and(inArray(attendanceSignals.sessionId, ids), gt(attendanceSignals.at, now - 6 * 60 * 60_000)))
      : [];
    const signalsBySession = new Map<string, { at: number; kind: (typeof signals)[number]["kind"] }[]>();
    for (const s of signals) signalsBySession.set(s.sessionId, [...(signalsBySession.get(s.sessionId) ?? []), { at: s.at, kind: s.kind }]);
    const attended = (sessionId: string, focusStart: number): boolean =>
      !isUnattendedAt(signalsBySession.get(sessionId) ?? [], Math.max(focusStart, now - 6 * 60 * 60_000), now);

    const flights: PublicFlightDescriptor[] = [];
    const community = new Map<string, { descriptor: PublicFlightDescriptor; count: number }>();

    for (const { session, booking, snapshot } of rows) {
      if (booking.mode === "community") {
        const key = communityFlightKey(snapshot);
        let entry = community.get(key);
        if (!entry) {
          entry = {
            descriptor: {
              id: key,
              kind: "community",
              origin: toPublicAirport(airportOrThrow(snapshot.origin)),
              destination: toPublicAirport(airportOrThrow(snapshot.destination)),
              departure: snapshot.departure,
              blockMs: blockDurationMs(snapshot),
            },
            count: 0,
          };
          community.set(key, entry);
        }
        if (attended(session.id, session.focusStart)) entry.count++;
      } else if (session.isPublic && attended(session.id, session.focusStart)) {
        // Hidden while unattended; reappears when the user returns (FR-061).
        flights.push({
          id: session.publicId,
          kind: "individual",
          origin: toPublicAirport(airportOrThrow(snapshot.origin)),
          destination: toPublicAirport(airportOrThrow(snapshot.destination)),
          departure: session.departure,
          blockMs: session.arrival - session.departure,
        });
      }
    }

    // Guests aboard Community Flights are counted anonymously from in-memory presence.
    for (const key of deps.presence.keys()) {
      const existing = community.get(key);
      if (existing) {
        existing.count += deps.presence.count(key);
        continue;
      }
      const snapshot = await communitySnapshot(deps, key);
      if (!snapshot || snapshot.departure > now || snapshot.arrival <= now) continue;
      community.set(key, {
        descriptor: {
          id: key,
          kind: "community",
          origin: toPublicAirport(airportOrThrow(snapshot.origin)),
          destination: toPublicAirport(airportOrThrow(snapshot.destination)),
          departure: snapshot.departure,
          blockMs: blockDurationMs(snapshot),
        },
        count: deps.presence.count(key),
      });
    }

    for (const { descriptor, count } of community.values()) {
      if (count > 0) flights.push({ ...descriptor, passengerCount: count });
    }
    return c.json({ flights, serverTime: now });
  });

  /** Passenger count for one Community Flight. */
  app.get("/flights/:key", async (c) => {
    const key = c.req.param("key");
    const snapshot = await communitySnapshot(deps, key);
    if (!snapshot) throw new ApiError(404, "not_found", "Community Flight not found");
    const now = deps.clock.now();
    const rows = await deps.db
      .select({ id: flightSessions.id, focusStart: flightSessions.focusStart })
      .from(flightSessions)
      .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
      .where(and(eq(bookings.communityKey, key), isNull(flightSessions.exitedAt), isNull(flightSessions.finalizedAt)));
    return c.json({
      key,
      origin: snapshot.origin,
      destination: snapshot.destination,
      departure: snapshot.departure,
      arrival: snapshot.arrival,
      passengerCount: rows.length + deps.presence.count(key),
      serverTime: now,
    });
  });

  /** Anonymous guest presence on a Community Flight; nothing is stored (FR-069). Send every minute. */
  app.post("/presence", async (c) => {
    const body = await parseJson(
      c,
      z.object({ communityKey: z.string().regex(COMMUNITY_KEY_RE), presenceId: z.uuid(), leaving: z.boolean().default(false) }),
    );
    const snapshot = await communitySnapshot(deps, body.communityKey);
    const now = deps.clock.now();
    if (!snapshot || now > snapshot.arrival || now < snapshot.departure - 15 * 60_000) {
      throw new ApiError(409, "not_boarding", "This Community Flight is not boarding or flying");
    }
    if (body.leaving) deps.presence.leave(body.communityKey, body.presenceId);
    else deps.presence.touch(body.communityKey, body.presenceId);
    return c.json({ passengerCount: deps.presence.count(body.communityKey) });
  });

  return app;
}

async function communitySnapshot(deps: AppDeps, key: string) {
  const m = COMMUNITY_KEY_RE.exec(key);
  if (!m) return null;
  const [, airline, flightNumber, date] = m as unknown as [string, string, string, string];
  try {
    const occ = await deps.provider.serviceOccurrences(airline, flightNumber, date, date);
    return occ[0] ?? null;
  } catch {
    return null;
  }
}
