/**
 * Connecting-flight helpers (docs/UI-PLAN.md Phase 7, docs/API.md "Connecting flights").
 * Facts: legs are ordinary bookings; a session carries only boardingPass.itineraryId/legIndex;
 * activeSession() is null during a layover; the open itinerary is found by listing and filtering.
 * Signed-in only: the server refuses itinerary booking for guests.
 */
import type { Itinerary, ItineraryOffer } from "@aerofocus/client";
import { itineraryPlannedTimes, type CabinClass, type ItineraryLegPlan, type ItineraryMode, type ItineraryNotification, type ScheduleSnapshot } from "@aerofocus/core";
import { api, ApiRequestError, isUuid } from "./api";
import { formatClock } from "./format";
import { notify, type Channel } from "./notify";

export const OPEN_ITINERARY_KEY = "aerofocus.openItinerary";

export const OPEN_STATUSES: ReadonlySet<Itinerary["status"]> = new Set(["booked", "in_progress"]);

/** The newest open itinerary, or null. Remembers its id so flight and arrival pages can find it. */
export async function findOpenItinerary(): Promise<Itinerary | null> {
  if (!api.token) return null;
  const res = await api.itineraries({ limit: 20 });
  const open = res.itineraries.find((i) => OPEN_STATUSES.has(i.status)) ?? null;
  rememberOpenItinerary(open?.id ?? null);
  return open;
}

export function rememberOpenItinerary(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(OPEN_ITINERARY_KEY, id);
    else sessionStorage.removeItem(OPEN_ITINERARY_KEY);
  } catch {
    /* ignore */
  }
}

export function rememberedOpenItinerary(): string | null {
  try {
    return sessionStorage.getItem(OPEN_ITINERARY_KEY);
  } catch {
    return null;
  }
}

export async function loadItinerary(id: string): Promise<Itinerary | null> {
  if (!isUuid(id)) return null;
  try {
    return (await api.itinerary(id)).itinerary;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}

export type JourneyStep =
  | { kind: "board"; legIndex: number; bookingId: string; opensAt: number; closesAt: number }
  | { kind: "in_flight"; legIndex: number; sessionId: string }
  | { kind: "validate"; legIndex: number; sessionId: string }
  | { kind: "layover"; legIndex: number; nextBookingId: string }
  | { kind: "done"; status: Itinerary["status"] };

/**
 * What the passenger should do now. Derived from leg outcomes and pass statuses because the
 * server exposes no "current leg" field (docs/API.md Itinerary view).
 */
export function currentStep(it: Itinerary, now: number): JourneyStep {
  if (!OPEN_STATUSES.has(it.status)) return { kind: "done", status: it.status };
  for (const leg of it.legs) {
    const pass = leg.boardingPass;
    if (leg.outcome === "in_flight" && leg.sessionId) return { kind: "in_flight", legIndex: leg.legIndex, sessionId: leg.sessionId };
    if (leg.outcome === "awaiting_validation" && leg.sessionId) return { kind: "validate", legIndex: leg.legIndex, sessionId: leg.sessionId };
    if (pass.status === "booked") {
      // A later leg waits in the terminal until its boarding opens.
      if (leg.legIndex > 0 && it.layover && it.layover.nextBookingId === leg.bookingId && now < pass.boardingOpensAt.epochMs) {
        return { kind: "layover", legIndex: leg.legIndex - 1, nextBookingId: leg.bookingId };
      }
      return { kind: "board", legIndex: leg.legIndex, bookingId: leg.bookingId, opensAt: pass.boardingOpensAt.epochMs, closesAt: pass.boardingClosesAt.epochMs };
    }
  }
  return { kind: "done", status: it.status };
}

export function legLabel(legIndex: number, total: number): string {
  return `Leg ${legIndex + 1} of ${total}`;
}

/** "SIN → DOH → LHR" as an array of codes for chain rendering. */
export function journeyCodes(it: Pick<Itinerary, "legs"> | Pick<ItineraryOffer, "legs">): string[] {
  const legs = it.legs as { boardingPass?: { origin: { iata: string }; destination: { iata: string } }; origin?: { iata: string }; destination?: { iata: string } }[];
  const codes: string[] = [];
  legs.forEach((l, i) => {
    const o = l.boardingPass?.origin ?? l.origin;
    const d = l.boardingPass?.destination ?? l.destination;
    if (i === 0 && o) codes.push(o.iata);
    if (d) codes.push(d.iata);
  });
  return codes;
}

/** Planned leg times before booking, from the legs' schedule snapshots (core itinerary.ts:347). */
export function plannedLegsPreview(snapshots: ScheduleSnapshot[], mode: ItineraryMode, now: number, chosenDeparture: number | null): ItineraryLegPlan[] {
  return itineraryPlannedTimes(mode, snapshots, { now, chosenDeparture });
}

/** Parses `legs=snap:cabin,snap:cabin` from a URL. */
export function parseLegsParam(param: string | null): { snapshotId: string; cabin: CabinClass }[] {
  if (!param) return [];
  return param
    .split(",")
    .map((part) => {
      const idx = part.lastIndexOf(":");
      if (idx <= 0) return null;
      return { snapshotId: decodeURIComponent(part.slice(0, idx)), cabin: part.slice(idx + 1) as CabinClass };
    })
    .filter((x): x is { snapshotId: string; cabin: CabinClass } => x !== null);
}

export function legsParam(legs: { snapshotId: string; cabin: CabinClass }[]): string {
  return legs.map((l) => `${encodeURIComponent(l.snapshotId)}:${l.cabin}`).join(",");
}

export function bookJourneyHref(offer: ItineraryOffer, cabin: CabinClass, studyWindow?: { start: number; end: number } | null): string {
  const q = new URLSearchParams();
  q.set("mode", offer.mode);
  q.set("legs", legsParam(offer.legs.map((l) => ({ snapshotId: l.snapshotId, cabin }))));
  if (offer.chosenDeparture !== null) q.set("departure", String(offer.chosenDeparture));
  if (studyWindow) {
    q.set("start", String(studyWindow.start));
    q.set("end", String(studyWindow.end));
  }
  return `/fly/book-journey?${q.toString()}`;
}

export const ITINERARY_ERROR_COPY: Record<string, string> = {
  no_legs: "Choose at least one flight.",
  too_many_legs: "A journey can have at most two connections.",
  not_chained: "These flights do not connect: each leg must depart from where the previous one lands.",
  unknown_airport: "One of these airports is not supported.",
  airport_revisited: "A journey cannot pass through the same airport twice.",
  below_minimum_connection: "The connection is too short. Allow at least 45 minutes domestically or 60 minutes internationally.",
  layover_too_long: "A layover cannot be longer than 24 hours.",
  outside_booking_window: "A leg departs outside the booking window.",
  does_not_fit_study_window: "This journey does not fit inside your study window.",
  rebook_route_mismatch: "A rebooking must go from where you are now to your original destination.",
  itinerary_conflict: "This journey overlaps another flight you have booked.",
  flight_in_progress: "You have a flight in the air. Land it before starting a journey.",
  not_rebookable: "This journey cannot be rebooked.",
  already_rebooked: "You already rebooked this journey. Abandon that booking first.",
  already_at_destination: "You have already reached this journey's destination.",
  not_abandonable: "This journey can no longer be abandoned.",
  itinerary_leg: "This flight is part of a journey. Abandon the journey instead.",
  previous_leg_not_boarded: "Board the previous leg first.",
  previous_leg_not_landed: "The previous leg has not landed yet.",
  previous_leg_failed: "The previous leg did not complete, so this connection was cancelled.",
  itinerary_closed: "This journey has ended.",
  connection_missed: "Boarding closed before you boarded. The connection was missed.",
  outside_layover: "You are not in a layover right now.",
  already_focusing: "Layover focus is already running.",
  not_focusing: "Layover focus is not running.",
  authentication_required: "Create an account to book connecting flights.",
};

export function itineraryErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const details = err.details as { errors?: { legIndex: number; error: string }[] } | undefined;
    const first = details?.errors?.[0];
    const base = ITINERARY_ERROR_COPY[err.code] ?? err.message;
    if (first && details?.errors && details.errors.length > 0) {
      const legCopy = ITINERARY_ERROR_COPY[first.error] ?? first.error.replaceAll("_", " ");
      return `Leg ${first.legIndex + 1}: ${legCopy}`;
    }
    return base;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/** Per-leg errors from a 422 body, keyed by legIndex. */
export function legErrors(err: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (err instanceof ApiRequestError) {
    const details = err.details as { errors?: { legIndex: number; error: string }[] } | undefined;
    for (const e of details?.errors ?? []) if (!out.has(e.legIndex)) out.set(e.legIndex, ITINERARY_ERROR_COPY[e.error] ?? e.error.replaceAll("_", " "));
  }
  return out;
}

const NOTIFICATION_COPY: Record<ItineraryNotification["type"], (n: ItineraryNotification, it: Itinerary, tz: string) => [string, string]> = {
  leg_landed: (n, it) => [`Landed at ${legDestination(it, n.legIndex)}`, "Validate your arrival within 10 minutes."],
  validate_reminder: (n, it) => ["Validate your arrival", `Leg ${n.legIndex + 1} lands its focus credit only once you validate.`],
  layover_started: (n, it) => [`Welcome to ${legDestination(it, n.legIndex)}`, "Your layover has started. The terminal is open."],
  lounge_available: () => ["Lounge open", "Your cabin gives you premium lounge access during this layover."],
  boarding_open: (n, it, tz) => [`Boarding ${legFlight(it, n.legIndex)}`, `Boarding is open until ${formatClock(it.legs[n.legIndex]?.boardingPass.boardingClosesAt ?? it.arrival, tz)}.`],
  boarding_closing: (n, it) => [`Boarding closes soon for ${legFlight(it, n.legIndex)}`, "Five minutes left to board your connection."],
  connection_missed: (n, it) => [`Connection missed: ${legFlight(it, n.legIndex)}`, "Boarding closed. Completed legs keep their focus credit; rebook from the journey page."],
  itinerary_complete: (_n, it) => [`Journey complete: ${it.destination.city}`, "Every leg validated. Your passport has been stamped."],
};

function legDestination(it: Itinerary, legIndex: number): string {
  return it.legs[legIndex]?.boardingPass.destination.city ?? it.destination.city;
}
function legFlight(it: Itinerary, legIndex: number): string {
  return it.legs[legIndex]?.boardingPass.flightNumber ?? "your connection";
}

/**
 * Schedules the server's notification plan as local notifications while the app is open
 * (docs/API.md "Connecting-flight notifications"). Returns a cancel function; call it and
 * reschedule after every re-fetch.
 */
export function scheduleItineraryNotifications(it: Itinerary, channel: Channel, now: number, tz: string): () => void {
  const timers: number[] = [];
  for (const n of it.notifications) {
    const delay = n.at - now;
    if (delay < 0 || delay > 2 ** 31 - 1) continue;
    const copy = NOTIFICATION_COPY[n.type];
    if (!copy) continue;
    const kind = n.type.startsWith("boarding") ? "boarding" : n.type === "leg_landed" || n.type === "itinerary_complete" ? "landing" : "break";
    timers.push(
      window.setTimeout(() => {
        const [title, body] = copy(n, it, tz);
        notify(channel, kind, title, body);
      }, delay),
    );
  }
  return () => timers.forEach((t) => clearTimeout(t));
}

export const LAYOVER_PHASE_LABELS = {
  not_started: "Landing soon",
  deplaning: "Validate your arrival",
  in_terminal: "In the terminal",
  boarding_open: "Boarding open",
  missed: "Connection missed",
  departed: "Departed",
  cancelled: "Connection cancelled",
} as const;

export function itineraryStatusLabel(status: Itinerary["status"]): string {
  return { booked: "Booked", in_progress: "In progress", complete: "Complete", incomplete: "Incomplete", abandoned: "Abandoned", cancelled: "Cancelled" }[status];
}
