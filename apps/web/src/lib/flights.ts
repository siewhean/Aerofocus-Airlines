/**
 * One booking/boarding surface for both modes. Signed-in users go through the API
 * (packages/client/src/api.ts:223-227); guests go through GuestStore on the device
 * (packages/client/src/guest.ts:128-191, docs/API.md "Guest mode").
 *
 * Pages should use these helpers instead of branching on session mode themselves.
 */
import type { BoardingPass, BookingRequest, Offer } from "@aerofocus/client";
import {
  boardingWindow,
  displayTime,
  genericSeatMap,
  type BreakSchedule,
  type CabinClass,
  type DepartureMode,
  type ScheduleSnapshot,
} from "@aerofocus/core";
import { AIRCRAFT_BY_CODE, AIRLINES_BY_IATA, AIRPORTS_BY_IATA } from "@aerofocus/data";
import { api, ApiRequestError, isUuid } from "./api";
import { apiExt } from "./api-ext";
import type { SessionContextValue } from "./session";

export const GUEST_BOOKING_ID = "guest";
const GUEST_STORAGE_KEY = "aerofocus.guest.v1";

const GUEST_ERROR_COPY: Record<string, string> = {
  outside_booking_window: "That departure is outside the booking window.",
  departure_in_past: "That departure time has already passed.",
  boarding_closed: "Boarding for this flight has closed.",
  cabin_not_offered: "This flight does not offer that cabin.",
  cabin_locked: "You have not unlocked that cabin yet.",
  airline_locked: "You have not unlocked this airline yet.",
  missing_chosen_departure: "Choose a departure time first.",
  does_not_fit_study_window: "This flight does not fit inside your study window.",
  flight_in_progress: "You already have a flight in progress. Land it first.",
  private_not_scheduled: "Private flights are not scheduled services.",
  no_booking: "There is no booking to board.",
  no_show: "This booking lapsed. The flight has already departed.",
  too_early: "Boarding has not opened yet.",
  already_boarded: "You have already boarded this flight.",
  booking_boarded: "You have already boarded this flight.",
  booking_no_show: "This booking lapsed. The flight has already departed.",
  booking_cancelled: "This booking was cancelled.",
  not_cancellable: "Only bookings not yet boarded can be cancelled.",
  booking_failed: "The booking could not be saved on this device.",
};

export class BookingError extends Error {
  constructor(readonly code: string, message?: string) {
    super(GUEST_ERROR_COPY[code] ?? message ?? code.replaceAll("_", " "));
  }
}

export interface BookInput {
  offer: Offer;
  mode: DepartureMode;
  cabin: CabinClass;
  chosenDeparture?: number | null;
  studyWindow?: { start: number; end: number } | null;
  studyGoal?: string | null;
  breakSchedule?: BreakSchedule | null;
  drawToken?: string | null;
}

/** Books for the current session. Returns a BoardingPass-shaped view in both modes. */
export async function bookFlight(session: SessionContextValue, input: BookInput): Promise<BoardingPass> {
  if (session.mode === "user") {
    const body: BookingRequest = {
      snapshotId: input.offer.snapshotId,
      mode: input.mode,
      cabin: input.cabin,
      chosenDeparture: input.chosenDeparture ?? null,
      studyWindow: input.studyWindow ?? null,
      studyGoal: input.studyGoal ?? null,
      breakSchedule: input.breakSchedule ?? null,
      drawToken: input.drawToken ?? null,
    };
    return (await api.book(body)).boardingPass;
  }
  // Guest: the store needs the ScheduleSnapshot, which the plan endpoint returns (api.ts:219-221).
  const { snapshot } = await apiExt.flightPlanFull(input.offer.snapshotId, undefined, session.timeZone);
  const result = session.guest.book({
    snapshot,
    mode: input.mode,
    cabin: input.cabin,
    timeZone: session.timeZone,
    chosenDeparture: input.chosenDeparture ?? null,
    studyWindow: input.studyWindow ?? null,
    studyGoal: input.studyGoal ?? null,
    breakSchedule: input.breakSchedule ?? null,
    isRandomDraw: Boolean(input.drawToken),
    airlineTier: input.offer.airline.tier,
  });
  if (!result.ok) throw new BookingError(result.errors[0] ?? "booking_failed");
  session.refreshGuest();
  const pass = guestBoardingPass(session);
  if (!pass) throw new BookingError("booking_failed");
  return pass;
}

/** The guest's single booking as a BoardingPass view, or null. */
export function guestBoardingPass(session: SessionContextValue): BoardingPass | null {
  // Always read the store: the React-held guestState may be stale right after a write.
  const state = session.guest.load();
  const booking = state.booking;
  if (!booking) return null;
  const tz = session.timeZone;
  const s = booking.snapshot;
  const window = boardingWindow(booking.times);
  const boarded = state.session !== null && state.session.snapshotId === s.id;
  const family = AIRCRAFT_BY_CODE.get(s.aircraftType ?? "")?.family ?? "narrowbody";
  const seat = state.session?.seat ?? pendingSeat(family, booking.cabin);
  return {
    bookingId: GUEST_BOOKING_ID,
    status: boarded ? "boarded" : "booked",
    mode: booking.times.mode,
    flightType: booking.times.mode === "community" ? "community" : "individual",
    flightNumber: `${s.operatingAirline}${s.flightNumber}`,
    airline: { iata: s.operatingAirline, name: AIRLINES_BY_IATA.get(s.operatingAirline)?.name ?? s.operatingAirline },
    passengerName: null,
    origin: airportView(s.origin),
    destination: airportView(s.destination),
    departure: displayTime(booking.times.plannedDeparture, tz),
    arrival: displayTime(booking.times.plannedArrival, tz),
    boardingOpensAt: displayTime(window.opensAt, tz),
    boardingClosesAt: displayTime(window.closesAt, tz),
    aircraft: aircraftView(s.aircraftType),
    cabin: booking.cabin,
    seat,
    studyDurationMs: booking.times.plannedArrival - booking.times.plannedDeparture,
    studyGoal: booking.studyGoal,
    breakSchedule: booking.breakSchedule,
    isRandomDraw: false,
    operatingDate: s.operatingDate,
    dataSource: s.sourceStatus,
    // Phase 3 itineraries (packages/client/src/api.ts:69-70): guest bookings are single legs.
    itineraryId: null,
    legIndex: null,
  };
}

/** Seat shown before boarding for guests; the real seat is issued at boarding (FR-010). */
function pendingSeat(family: Parameters<typeof genericSeatMap>[0], cabin: CabinClass) {
  const layout = genericSeatMap(family).cabins[cabin] ?? genericSeatMap(family).cabins.economy!;
  const letter = layout.windowLetters[0];
  return { seat: `${layout.rows[0]}${letter}`, row: layout.rows[0], letter, isWindow: true, wingView: true, layout: "generic" as const };
}

export function airportView(iata: string) {
  const a = AIRPORTS_BY_IATA.get(iata);
  return a
    ? { iata: a.iata, name: a.name, city: a.city, country: a.country, region: a.region, lat: a.lat, lon: a.lon, timeZone: a.timeZone }
    : { iata, name: iata, city: iata, country: "", region: "", lat: 0, lon: 0, timeZone: "UTC" };
}

export function aircraftView(code: string | null) {
  const t = code ? AIRCRAFT_BY_CODE.get(code) : undefined;
  return t ? { code: t.code, name: t.name, family: t.family, known: true } : { code, name: "Aircraft not confirmed", family: "narrowbody", known: false };
}

/** "My bookings" for either mode. */
export async function listBookings(session: SessionContextValue): Promise<BoardingPass[]> {
  if (session.mode === "user") return (await api.bookings()).bookings;
  const pass = guestBoardingPass(session);
  return pass ? [pass] : [];
}

export async function getBooking(session: SessionContextValue, bookingId: string): Promise<BoardingPass | null> {
  if (session.mode === "user") {
    if (!isUuid(bookingId)) return null;
    try {
      return (await api.booking(bookingId)).boardingPass;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) return null;
      throw e;
    }
  }
  return bookingId === GUEST_BOOKING_ID ? guestBoardingPass(session) : null;
}

export async function cancelBooking(session: SessionContextValue, bookingId: string): Promise<void> {
  if (session.mode === "user") {
    if (!isUuid(bookingId)) throw new BookingError("not_found", "Booking not found.");
    await api.cancelBooking(bookingId);
    return;
  }
  const state = session.guest.load();
  if (state.session) throw new BookingError("already_boarded");
  // GuestStore has no cancel method. Drop only the booking from the stored state so history,
  // passport and the expiry clock survive (storage key from packages/client/src/guest.ts:60).
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (raw) localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ ...(JSON.parse(raw) as object), booking: null }));
  } catch {
    /* storage unavailable: nothing to cancel */
  }
  session.refreshGuest();
}

/** Boards. Returns the session id ("guest" for guests). Throws BookingError with too_early / no_show / already_boarded. */
export async function boardBooking(session: SessionContextValue, bookingId: string): Promise<string> {
  if (session.mode === "user") {
    if (!isUuid(bookingId)) throw new BookingError("not_found", "Booking not found.");
    try {
      return (await api.board(bookingId)).sessionId;
    } catch (e) {
      if (e instanceof ApiRequestError) throw new BookingError(e.code, e.message);
      throw e;
    }
  }
  const result = session.guest.board();
  session.refreshGuest();
  if (!result.ok) throw new BookingError(result.error);
  return GUEST_BOOKING_ID;
}

/** Whether the current session has an open flight (for "Active flight" entry points). */
export async function hasActiveFlight(session: SessionContextValue): Promise<boolean> {
  if (session.mode === "user") {
    const res = await api.activeSession();
    return res.session !== null;
  }
  const view = session.guest.view();
  return view !== null && (view.summary.outcome === "in_flight" || view.summary.outcome === "awaiting_validation");
}

export type { ScheduleSnapshot };
