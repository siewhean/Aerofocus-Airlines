import {
  blockDurationMs,
  clusterByGrid,
  communityFlightKey,
  createFlightPlan,
  flightStateAt,
  isUnattendedAt,
  publicFlightPosition,
  routeGeometry,
  toPublicAirport,
  type BBox,
  type PublicFlightDescriptor,
} from "@aerofocus/core";
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { attendanceSignals, bookings, flightSessions, scheduleSnapshots } from "../db/schema";
import { ApiError, parseJson, parseQuery } from "../errors";
import { airportOrThrow } from "../services/catalogue";

const COMMUNITY_KEY_RE = /^([A-Z0-9]{2})(\d{1,4}):(\d{4}-\d{2}-\d{2})$/;
/** How long the public flight list may be reused between requests (FR-062). */
const CACHE_TTL_MS = 3_000;
const SIGNAL_LOOKBACK_MS = 6 * 60 * 60_000;

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

/**
 * All public flights in the air now (FR-055, FR-056). Individual flights appear only when shared
 * and attended (FR-058, FR-061); Community Flights appear once with an anonymous passenger count.
 */
async function loadPublicFlights(deps: AppDeps, now: number): Promise<PublicFlightDescriptor[]> {
  const rows = await deps.db
    .select({ session: flightSessions, booking: bookings, snapshot: scheduleSnapshots.data })
    .from(flightSessions)
    .innerJoin(bookings, eq(bookings.id, flightSessions.bookingId))
    .innerJoin(scheduleSnapshots, eq(scheduleSnapshots.id, bookings.snapshotId))
    .where(
      and(isNull(flightSessions.exitedAt), isNull(flightSessions.finalizedAt), lte(flightSessions.departure, now), gt(flightSessions.arrival, now)),
    );

  const ids = rows.map((r) => r.session.id);
  const signals = ids.length
    ? await deps.db
        .select()
        .from(attendanceSignals)
        .where(and(inArray(attendanceSignals.sessionId, ids), gt(attendanceSignals.at, now - SIGNAL_LOOKBACK_MS)))
    : [];
  const bySession = new Map<string, { at: number; kind: (typeof signals)[number]["kind"] }[]>();
  for (const s of signals) bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), { at: s.at, kind: s.kind }]);
  const attended = (sessionId: string, focusStart: number): boolean =>
    !isUnattendedAt(bySession.get(sessionId) ?? [], Math.max(focusStart, now - SIGNAL_LOOKBACK_MS), now);

  const flights: PublicFlightDescriptor[] = [];
  const community = new Map<string, { descriptor: PublicFlightDescriptor; count: number }>();
  const communityDescriptor = (key: string, s: (typeof rows)[number]["snapshot"]): PublicFlightDescriptor => ({
    id: key,
    kind: "community",
    origin: toPublicAirport(airportOrThrow(s.origin)),
    destination: toPublicAirport(airportOrThrow(s.destination)),
    departure: s.departure,
    blockMs: blockDurationMs(s),
  });

  for (const { session, booking, snapshot } of rows) {
    if (booking.mode === "community") {
      const key = communityFlightKey(snapshot);
      const entry = community.get(key) ?? { descriptor: communityDescriptor(key, snapshot), count: 0 };
      community.set(key, entry);
      if (attended(session.id, session.focusStart)) entry.count++;
    } else if (session.isPublic && attended(session.id, session.focusStart)) {
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

  // Guests aboard Community Flights, counted anonymously from in-memory presence.
  for (const key of deps.presence.keys()) {
    const existing = community.get(key);
    if (existing) {
      existing.count += deps.presence.count(key);
      continue;
    }
    const snapshot = await communitySnapshot(deps, key);
    if (!snapshot || snapshot.departure > now || snapshot.arrival <= now) continue;
    community.set(key, { descriptor: communityDescriptor(key, snapshot), count: deps.presence.count(key) });
  }

  for (const { descriptor, count } of community.values()) if (count > 0) flights.push({ ...descriptor, passengerCount: count });
  return flights;
}

/** Exported for tests; `load` is injectable to exercise slow loads. */
export async function publicFlights(
  deps: AppDeps,
  now: number,
  load: (deps: AppDeps, now: number) => Promise<PublicFlightDescriptor[]> = loadPublicFlights,
): Promise<PublicFlightDescriptor[]> {
  const cached = deps.communityCache;
  if (cached && now - cached.at >= 0 && now - cached.at < CACHE_TTL_MS) return cached.flights;
  const generation = deps.communityCacheGeneration;
  const flights = await load(deps, now);
  // Only cache if nothing was invalidated while loading; otherwise a flight hidden mid-load
  // could reappear from this stale result (AC-16).
  if (deps.communityCacheGeneration === generation) deps.communityCache = { at: now, flights };
  return flights;
}

const bboxSchema = z
  .string()
  .transform((v) => v.split(",").map(Number))
  .refine(
    (v) => v.length === 4 && v.every(Number.isFinite) && v[1]! >= -90 && v[3]! <= 90 && v[1]! <= v[3]!,
    "bbox must be west,south,east,north",
  )
  .transform((v) => v as BBox);

export function communityRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  /**
   * Public flights. Without `zoom`: every descriptor; viewers compute positions locally (FR-062).
   * With `zoom` (and optional `bbox=west,south,east,north`): positions are computed and grouped
   * into clusters for large maps (AC-19). Hiding other flights is a client setting (FR-057).
   */
  app.get("/flights", async (c) => {
    const q = parseQuery(c, z.object({ zoom: z.coerce.number().min(0).max(22).optional(), bbox: bboxSchema.optional() }));
    const now = deps.clock.now();
    const flights = await publicFlights(deps, now);
    if (q.zoom === undefined && q.bbox === undefined) return c.json({ flights, serverTime: now });
    const items = clusterByGrid(
      flights.map((f) => ({ flight: f, position: publicFlightPosition(f, now) })),
      (i) => i.position,
      (i) => i.flight.id,
      { zoom: q.zoom ?? 2, ...(q.bbox ? { bbox: q.bbox } : {}) },
    ).map((r) =>
      r.type === "item" ? { type: "flight" as const, position: r.position, flight: r.item.flight } : r,
    );
    return c.json({ items, total: flights.length, serverTime: now });
  });

  /** Anonymous inspection of one public flight (FR-056): route path and position only. */
  app.get("/flights/public/:id", async (c) => {
    const now = deps.clock.now();
    const flight = (await publicFlights(deps, now)).find((f) => f.id === c.req.param("id"));
    if (!flight) throw new ApiError(404, "not_found", "This flight is not public or has landed");
    const plan = createFlightPlan({
      origin: { ...airportOrThrow(flight.origin.iata) },
      destination: { ...airportOrThrow(flight.destination.iata) },
      departure: flight.departure,
      blockMs: flight.blockMs,
    });
    const state = flightStateAt(plan, now);
    const path = routeGeometry(plan, now).features.filter(
      (f) => f.properties.kind === "completed" || f.properties.kind === "remaining" || f.properties.kind === "aircraft",
    );
    return c.json({
      flight,
      position: state.position,
      path: { type: "FeatureCollection", features: path },
      serverTime: now,
    });
  });

  /** Passenger count for one Community Flight. */
  app.get("/flights/:key", async (c) => {
    const key = c.req.param("key");
    const snapshot = await communitySnapshot(deps, key);
    if (!snapshot) throw new ApiError(404, "not_found", "Community Flight not found");
    const now = deps.clock.now();
    const rows = await deps.db
      .select({ id: flightSessions.id })
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
    // Guest presence never invalidates the cache: anyone can send new ids, so invalidating here
    // would let callers force a database load per request. Counts refresh within the cache TTL.
    if (body.leaving) deps.presence.leave(body.communityKey, body.presenceId);
    else if (!deps.presence.touch(body.communityKey, body.presenceId)) {
      throw new ApiError(429, "flight_full", "Too many guests are being counted on this flight");
    }
    return c.json({ passengerCount: deps.presence.count(body.communityKey) });
  });

  return app;
}
