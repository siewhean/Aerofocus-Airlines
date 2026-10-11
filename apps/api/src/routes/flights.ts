import {
  blockDurationMs,
  createFlightPlan,
  daylightEventsDuringFlight,
  displayTime,
  inspectAtDistanceFraction,
  inspectAtOffset,
  MINUTE,
  routeFacts,
  routeGeometry,
  routeTimeline,
  unlockStateFor,
  type InspectionPoint,
} from "@aerofocus/core";
import { describePosition } from "@aerofocus/geo";
import { AIRPORTS, AIRPORTS_BY_IATA, SEAT_MAPS } from "@aerofocus/data";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { ApiError, parseJson, parseQuery } from "../errors";
import { airportOrThrow, drawRandomFlight, searchFlights, snapshotOrThrow, type OfferContext } from "../services/catalogue";
import { progressionFor } from "../services/sessions";
import { cabinSchema, userTimeZone } from "./common";

const iata = z.string().regex(/^[A-Z0-9]{2,3}$/);

const searchSchema = z
  .object({
    studyStart: z.coerce.number().optional(),
    studyEnd: z.coerce.number().optional(),
    mode: z.enum(["community", "individual", "all"]).default("all"),
    origin: iata.optional(),
    destination: iata.optional(),
    airline: iata.optional(),
    aircraft: z.string().max(4).optional(),
    cabin: cabinSchema.optional(),
    region: z.string().max(20).optional(),
    minDurationMinutes: z.coerce.number().min(0).optional(),
    maxDurationMinutes: z.coerce.number().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    timeZone: z.string().optional(),
  })
  .refine((q) => (q.studyStart === undefined) === (q.studyEnd === undefined), "studyStart and studyEnd go together")
  .refine((q) => q.studyStart === undefined || q.studyEnd! > q.studyStart, "studyEnd must be after studyStart");

export async function offerContext(c: Parameters<typeof userTimeZone>[0], deps: AppDeps): Promise<OfferContext> {
  const now = deps.clock.now();
  const tz = await userTimeZone(c, deps);
  const user = c.get("user");
  // Guests start at Traveller; their device-side progression is not trusted by the server.
  const unlocks = user
    ? (await progressionFor(deps, user.id, tz, now)).unlocks
    : unlockStateFor({ creditedFocusMs: 0, completedFlights: 0, countries: 0, specialAchievements: 0 });
  return { deps, now, userTimeZone: tz, unlocks };
}

export function flightRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  /** Study-window search (FR-002, FR-006). Times are epoch ms; responses include the user's local time. */
  app.get("/search", async (c) => {
    const q = parseQuery(c, searchSchema);
    const ctx = await offerContext(c, deps);
    const offers = await searchFlights(ctx, {
      studyWindow: q.studyStart !== undefined ? { start: q.studyStart, end: q.studyEnd! } : null,
      modes: q.mode === "all" ? ["community", "individual"] : [q.mode],
      origin: q.origin,
      destination: q.destination,
      airline: q.airline,
      aircraft: q.aircraft,
      cabin: q.cabin,
      region: q.region,
      minDurationMs: q.minDurationMinutes !== undefined ? q.minDurationMinutes * MINUTE : undefined,
      maxDurationMs: q.maxDurationMinutes !== undefined ? q.maxDurationMinutes * MINUTE : undefined,
      limit: q.limit,
    });
    return c.json({ offers, unlocks: ctx.unlocks });
  });

  /** Random Flight (FR-005). Signed-in users receive a drawToken to book the draw. */
  app.post("/random", async (c) => {
    const body = await parseJson(c, z.object({ studyMinutes: z.number().int().min(15).max(24 * 60) }));
    const ctx = await offerContext(c, deps);
    const draw = await drawRandomFlight(ctx, body.studyMinutes * MINUTE, c.get("user")?.id ?? null);
    return c.json(draw);
  });

  /**
   * Route preview for a flight, e.g. before booking and for guest flights (FR-016): plan, GeoJSON,
   * accessible timeline, sunrises/sunsets on the way, and route facts.
   */
  app.get("/:snapshotId/plan", async (c) => {
    const snapshot = await snapshotOrThrow(deps, c.req.param("snapshotId"));
    const { departure } = parseQuery(c, z.object({ departure: z.coerce.number().optional(), timeZone: z.string().optional() }));
    const tz = await userTimeZone(c, deps);
    const plan = createFlightPlan({
      origin: airportOrThrow(snapshot.origin),
      destination: airportOrThrow(snapshot.destination),
      departure: departure ?? snapshot.departure,
      blockMs: blockDurationMs(snapshot),
    });
    return c.json({
      snapshot,
      plan,
      geometry: routeGeometry(plan),
      timeline: routeTimeline(plan, tz, { describe: (p) => describePosition(p, AIRPORTS) }),
      daylightEvents: daylightEventsDuringFlight(plan).map((e) => ({ ...e, time: displayTime(e.instant, tz) })),
      facts: routeFacts(plan),
      seatMap: snapshot.aircraftType ? SEAT_MAPS[snapshot.aircraftType] ?? null : null,
    });
  });

  /** Route inspection for a not-yet-flown flight (FR-017). */
  app.get("/:snapshotId/inspect", async (c) => {
    const snapshot = await snapshotOrThrow(deps, c.req.param("snapshotId"));
    const q = parseQuery(
      c,
      z.object({
        departure: z.coerce.number().optional(),
        offsetMs: z.coerce.number().optional(),
        fraction: z.coerce.number().min(0).max(1).optional(),
        timeZone: z.string().optional(),
      }),
    );
    const tz = await userTimeZone(c, deps);
    const plan = createFlightPlan({
      origin: airportOrThrow(snapshot.origin),
      destination: airportOrThrow(snapshot.destination),
      departure: q.departure ?? snapshot.departure,
      blockMs: blockDurationMs(snapshot),
    });
    const labelled = (point: InspectionPoint) => c.json({ point: { ...point, placeLabel: describePosition(point.position, AIRPORTS) } });
    if (q.offsetMs !== undefined) return labelled(inspectAtOffset(plan, q.offsetMs, tz));
    if (q.fraction !== undefined) return labelled(inspectAtDistanceFraction(plan, q.fraction, tz));
    throw new ApiError(400, "invalid_request", "Pass offsetMs or fraction");
  });

  app.get("/airports/:iata", (c) => {
    const airport = AIRPORTS_BY_IATA.get(c.req.param("iata").toUpperCase());
    if (!airport) throw new ApiError(404, "not_found", "Airport not found");
    return c.json({ airport });
  });

  return app;
}
