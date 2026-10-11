import {
  applySessionAction,
  displayTime,
  inspectAtDistanceFraction,
  inspectAtOffset,
  inspectNearestPoint,
  type SessionAction,
} from "@aerofocus/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireUser, type AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { flightSessions } from "../db/schema";
import { ApiError, parseJson, parseQuery } from "../errors";
import { finalizeIfDone, loadSession, saveSession, viewFor, type LoadedSession } from "../services/sessions";
import { getSettings } from "../services/users";
import { boardingPass } from "./bookings";

const ACTION_ERRORS: Record<string, [number, string]> = {
  flight_finished: [409, "This flight has finished"],
  flight_not_landed: [409, "The flight has not landed yet"],
  validation_window_closed: [409, "The 10-minute validation window has closed"],
  already_validated: [409, "This flight is already validated"],
  not_on_break: [409, "You are not on a break"],
  already_on_break: [409, "You are already on a break"],
  community_flights_are_shared: [409, "Community Flights are shared only as a passenger count"],
};

export function sessionRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  async function respond(loaded: LoadedSession, timeZone: string, displayName: string | null) {
    const now = deps.clock.now();
    await finalizeIfDone(deps, loaded, timeZone, now);
    const { plan, view } = viewFor(loaded, now);
    const { summary } = view;
    return {
      sessionId: loaded.row.id,
      boardingPass: await boardingPass(deps, loaded.booking, timeZone, displayName),
      flight: {
        ...view.flight,
        departure: displayTime(plan.departure, timeZone),
        arrival: displayTime(view.flight.arrival, timeZone),
      },
      focus: {
        state: view.focusState,
        prompt: view.prompt,
        nextBreakAt: view.nextBreakAt,
        unattendedNow: view.unattendedNow,
        outcome: summary.outcome,
        validationDeadline: summary.validationDeadline,
        focusMs: summary.focusMs,
        breakMs: summary.breakMs,
        awaitingReturnMs: summary.awaitingReturnMs,
        creditedFocusMs: summary.creditedFocusMs,
        creditedFlightMs: summary.creditedFlightMs,
        segments: summary.segments,
        unattended: summary.unattended,
      },
      isPublic: loaded.data.isPublic,
      studyGoal: loaded.data.studyGoal,
      goalCompleted: loaded.data.goalCompleted,
      serverTime: now,
    };
  }

  async function act(c: Context<AppEnv>, action: SessionAction) {
    const user = requireUser(c.get("user"));
    const tz = (await getSettings(deps, user.id)).timeZone;
    const loaded = await loadSession(deps, c.req.param("id") ?? "", user.id);
    const result = applySessionAction(loaded.data, action, deps.clock.now());
    if (!result.ok) {
      const [status, message] = ACTION_ERRORS[result.error] ?? [409, result.error];
      throw new ApiError(status as 409, result.error, message);
    }
    const saved = await saveSession(deps, loaded, result.session);
    return c.json(await respond(saved, tz, user.displayName));
  }

  /** The user's current open flight, if any. */
  app.get("/active", async (c) => {
    const user = requireUser(c.get("user"));
    const [row] = await deps.db
      .select({ id: flightSessions.id })
      .from(flightSessions)
      .where(and(eq(flightSessions.userId, user.id), isNull(flightSessions.finalizedAt)))
      .orderBy(desc(flightSessions.boardedAt))
      .limit(1);
    if (!row) return c.json({ session: null });
    const tz = (await getSettings(deps, user.id)).timeZone;
    const loaded = await loadSession(deps, row.id, user.id);
    const body = await respond(loaded, tz, user.displayName);
    return c.json({ session: body.focus.outcome === "in_flight" || body.focus.outcome === "awaiting_validation" ? body : null });
  });

  app.get("/:id", async (c) => {
    const user = requireUser(c.get("user"));
    const tz = (await getSettings(deps, user.id)).timeZone;
    const loaded = await loadSession(deps, c.req.param("id"), user.id);
    return c.json(await respond(loaded, tz, user.displayName));
  });

  /** App-open heartbeat and background/resume/reopen signals (FR-013a). */
  app.post("/:id/heartbeat", async (c) => {
    const body = await parseJson(c, z.object({ kind: z.enum(["beat", "background", "resume", "reopen"]).default("beat") }));
    return act(c, { type: "signal", kind: body.kind });
  });

  app.post("/:id/break/start", (c) => act(c, { type: "break_start" }));
  app.post("/:id/break/end", (c) => act(c, { type: "break_end" }));
  /** "I'm back" after an automatic break (FR-040). */
  app.post("/:id/back", (c) => act(c, { type: "back" }));
  /** Leave before landing (FR-014). */
  app.post("/:id/exit", (c) => act(c, { type: "exit" }));

  /** Arrival validation within 10 minutes of landing (FR-015). */
  app.post("/:id/validate", async (c) => {
    const body = await parseJson(
      c,
      z.object({ confirmUnattendedStarts: z.array(z.number()).max(500).default([]), goalCompleted: z.boolean().nullish() }),
    );
    return act(c, { type: "validate", confirmUnattendedStarts: body.confirmUnattendedStarts, goalCompleted: body.goalCompleted ?? null });
  });

  /** Share My Flight toggle (FR-058). Individual flights only. */
  app.patch("/:id/visibility", async (c) => {
    const body = await parseJson(c, z.object({ isPublic: z.boolean() }));
    return act(c, { type: "set_visibility", isPublic: body.isPublic });
  });

  /** Route geometry and phase plan for the map (FR-016). */
  app.get("/:id/route", async (c) => {
    const user = requireUser(c.get("user"));
    const loaded = await loadSession(deps, c.req.param("id"), user.id);
    const { plan } = viewFor(loaded, deps.clock.now());
    return c.json({ plan });
  });

  /** Route inspection (FR-017): ?offsetMs=, ?fraction= or ?lat=&lon=. Never changes the flight (FR-019). */
  app.get("/:id/inspect", async (c) => {
    const user = requireUser(c.get("user"));
    const q = parseQuery(
      c,
      z.object({
        offsetMs: z.coerce.number().optional(),
        fraction: z.coerce.number().min(0).max(1).optional(),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
      }),
    );
    const tz = (await getSettings(deps, user.id)).timeZone;
    const loaded = await loadSession(deps, c.req.param("id"), user.id);
    const { plan } = viewFor(loaded, deps.clock.now());
    if (q.offsetMs !== undefined) return c.json({ point: inspectAtOffset(plan, q.offsetMs, tz) });
    if (q.fraction !== undefined) return c.json({ point: inspectAtDistanceFraction(plan, q.fraction, tz) });
    if (q.lat !== undefined && q.lon !== undefined) return c.json({ point: inspectNearestPoint(plan, { lat: q.lat, lon: q.lon }, tz) });
    throw new ApiError(400, "invalid_request", "Pass offsetMs, fraction, or lat and lon");
  });

  return app;
}
