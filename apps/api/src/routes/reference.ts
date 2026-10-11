import { ACHIEVEMENTS, BOOKING_WINDOW_DAYS, GUEST_DATA_TTL_MS, LEVELS, PASSPORT_COLOURS, RANDOM_CABIN_WEIGHTS, VALIDATION_WINDOW_MS, COMMUNITY_BOARDING_OPENS_MS, DEFAULT_BREAK_SCHEDULE, UNATTENDED_THRESHOLD_MS, HEARTBEAT_INTERVAL_MS, BOARDING_SEQUENCE_MS } from "@aerofocus/core";
import { AIRCRAFT_BY_CODE, AIRCRAFT_TYPES, AIRLINES, AIRPORTS, seatMapFor } from "@aerofocus/data";
import { ApiError } from "../errors";
import { Hono } from "hono";
import type { AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { airlineTier, airportView } from "../services/catalogue";

export function referenceRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/time", (c) => c.json({ now: deps.clock.now() }));

  app.get("/airports", (c) => c.json({ airports: AIRPORTS.map(airportView) }));

  app.get("/airlines", (c) =>
    c.json({
      airlines: AIRLINES.map((a) => ({ ...a, tier: airlineTier(deps, a.iata) })),
      promotedToStarter: deps.tierTable.promotedToStarter,
    }),
  );

  app.get("/aircraft", (c) => c.json({ aircraft: AIRCRAFT_TYPES }));

  /** Seat map for an aircraft type (FR-010). source "representative" = typical layout, not an airline's. */
  app.get("/aircraft/:code/seatmap", (c) => {
    const aircraft = AIRCRAFT_BY_CODE.get(c.req.param("code"));
    if (!aircraft) throw new ApiError(404, "not_found", "Aircraft type not found");
    return c.json({ aircraft, seatMap: seatMapFor(aircraft.code, aircraft.family) });
  });

  app.get("/levels", (c) => c.json({ levels: LEVELS }));

  app.get("/achievements", (c) =>
    c.json({ achievements: ACHIEVEMENTS.map(({ id, name, description, category, special }) => ({ id, name, description, category, special })) }),
  );

  /** Product rules the UI needs to mirror (timers, windows, defaults). */
  app.get("/rules", (c) =>
    c.json({
      bookingWindowDays: BOOKING_WINDOW_DAYS,
      communityBoardingOpensMs: COMMUNITY_BOARDING_OPENS_MS,
      boardingSequenceMs: BOARDING_SEQUENCE_MS,
      validationWindowMs: VALIDATION_WINDOW_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      unattendedThresholdMs: UNATTENDED_THRESHOLD_MS,
      guestDataTtlMs: GUEST_DATA_TTL_MS,
      defaultBreakSchedule: DEFAULT_BREAK_SCHEDULE,
      randomCabinWeights: RANDOM_CABIN_WEIGHTS,
      passportColours: PASSPORT_COLOURS,
    }),
  );

  return app;
}
