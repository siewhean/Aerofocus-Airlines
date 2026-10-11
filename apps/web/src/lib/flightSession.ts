/**
 * One in-flight surface for both modes. Signed-in users use the session endpoints
 * (packages/client/src/api.ts:230-241); guests use GuestStore.act/view/plan
 * (packages/client/src/guest.ts:193-220) with core SessionAction (packages/core/src/session.ts:34-41).
 * Both produce a `SessionResponse`-shaped view so pages never branch on mode.
 */
import type { BoardingPass, SessionResponse } from "@aerofocus/client";
import { displayTime, type AttendanceSignalKind, type FlightPlan } from "@aerofocus/core";
import { api, ApiRequestError } from "./api";
import { apiExt, type SessionRouteFull, type SceneryResponse } from "./api-ext";
import { BookingError, GUEST_BOOKING_ID, guestBoardingPass } from "./flights";
import type { SessionContextValue } from "./session";

export type FlightView = SessionResponse;

export interface LoadedFlight {
  view: FlightView;
  plan: FlightPlan;
  route: SessionRouteFull | null;
}

function guestView(session: SessionContextValue): FlightView | null {
  const state = session.guest.load();
  const view = session.guest.view();
  const data = state.session;
  if (!view || !data) return null;
  const pass: BoardingPass | null = guestBoardingPass(session);
  if (!pass) return null;
  const tz = session.timeZone;
  const { arrival: _arrival, ...flight } = view.flight;
  return {
    sessionId: GUEST_BOOKING_ID,
    boardingPass: { ...pass, status: "boarded", seat: data.seat },
    flight: { ...flight, departure: displayTime(data.departure, tz), arrival: displayTime(data.arrival, tz) },
    focus: {
      state: view.focusState,
      prompt: view.prompt,
      nextBreakAt: view.nextBreakAt,
      unattendedNow: view.unattendedNow,
      outcome: view.summary.outcome,
      validationDeadline: view.summary.validationDeadline,
      focusMs: view.summary.focusMs,
      breakMs: view.summary.breakMs,
      awaitingReturnMs: view.summary.awaitingReturnMs,
      creditedFocusMs: view.summary.creditedFocusMs,
      creditedFlightMs: view.summary.creditedFlightMs,
      segments: view.summary.segments,
      unattended: view.summary.unattended,
    },
    isPublic: data.isPublic,
    studyGoal: data.studyGoal,
    goalCompleted: data.goalCompleted,
    serverTime: session.now(),
  };
}

/** The open flight, or null (AC-10 restore). Guests: the device session, if any. */
export async function loadActiveFlight(session: SessionContextValue): Promise<LoadedFlight | null> {
  if (session.mode === "user") {
    const { session: view } = await api.activeSession();
    if (!view) return null;
    const route = await apiExt.sessionRouteFull(view.sessionId);
    return { view, plan: route.plan, route };
  }
  const view = guestView(session);
  const plan = session.guest.plan();
  if (!view || !plan) return null;
  return { view, plan, route: null };
}

/** Fresh state after an action or on the polling interval. */
export async function refreshFlight(session: SessionContextValue, sessionId: string): Promise<FlightView | null> {
  if (session.mode === "user") {
    try {
      return await api.session(sessionId);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) return null;
      throw e;
    }
  }
  return guestView(session);
}

export type FlightAction =
  | { type: "heartbeat"; kind: AttendanceSignalKind }
  | { type: "break_start" }
  | { type: "break_end" }
  | { type: "back" }
  | { type: "exit" }
  | { type: "validate"; confirmUnattendedStarts?: number[]; goalCompleted?: boolean | null }
  | { type: "set_visibility"; isPublic: boolean };

export async function actOnFlight(session: SessionContextValue, sessionId: string, action: FlightAction): Promise<FlightView | null> {
  if (session.mode === "user") {
    switch (action.type) {
      case "heartbeat":
        return api.heartbeat(sessionId, action.kind);
      case "break_start":
        return api.startBreak(sessionId);
      case "break_end":
        return api.endBreak(sessionId);
      case "back":
        return api.imBack(sessionId);
      case "exit":
        return api.exitFlight(sessionId);
      case "validate":
        return api.validate(sessionId, { confirmUnattendedStarts: action.confirmUnattendedStarts, goalCompleted: action.goalCompleted });
      case "set_visibility":
        return api.setVisibility(sessionId, action.isPublic);
    }
  }
  const result = session.guest.act(
    action.type === "heartbeat"
      ? { type: "signal", kind: action.kind }
      : action.type === "validate"
        ? { type: "validate", confirmUnattendedStarts: action.confirmUnattendedStarts, goalCompleted: action.goalCompleted }
        : action,
  );
  session.refreshGuest();
  if (!result.ok) throw new BookingError(result.error);
  return guestView(session);
}

/** Window scenery (FR-022). Guests have no scenery endpoint; the page falls back to core lighting. */
export async function loadScenery(session: SessionContextValue, sessionId: string): Promise<SceneryResponse | null> {
  if (session.mode !== "user") return null;
  return apiExt.scenery(sessionId);
}

/** Last finished guest flight, for the arrival screen after validation. */
export function lastGuestOutcome(session: SessionContextValue) {
  const history = session.guest.load().history;
  return history[history.length - 1] ?? null;
}
