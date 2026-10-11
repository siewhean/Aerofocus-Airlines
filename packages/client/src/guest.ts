import {
  applySessionAction,
  assignSeat,
  boardFlight,
  checkBookingRequest,
  computeStats,
  createFlightPlan,
  DEFAULT_BREAK_SCHEDULE,
  greatCircleDistanceKm,
  guestDataExpiresAt,
  isGuestDataExpired,
  plannedTimes,
  sessionView,
  summarize,
  unlockStateFor,
  type BookingTimes,
  type BreakSchedule,
  type CabinClass,
  type DepartureMode,
  type FlightPlan,
  type FlightSessionData,
  type GuestFlightImport,
  type Instant,
  type Rng,
  type ScheduleSnapshot,
  type SessionAction,
  type SessionView,
  type UserStats,
} from "@aerofocus/core";
import { AIRCRAFT_BY_CODE, AIRPORTS_BY_IATA, buildAirlineTierTable } from "@aerofocus/data";

/** Minimal Web Storage interface (localStorage in browsers). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GuestBooking {
  snapshot: ScheduleSnapshot;
  times: BookingTimes;
  cabin: CabinClass;
  studyGoal: string | null;
  breakSchedule: BreakSchedule;
}

export interface GuestState {
  version: 1;
  createdAt: Instant;
  lastFlightAt: Instant | null;
  /** Anonymous id used only to be counted on Community Flights. */
  presenceId: string;
  booking: GuestBooking | null;
  session: FlightSessionData | null;
  history: GuestFlightImport[];
}

export type GuestError = string;

const STORAGE_KEY = "aerofocus.guest.v1";
const FINAL = new Set(["complete", "invalid", "ended_early"]);

/**
 * Guest mode: flights, history and passport live only on this device and expire 2 weeks after the
 * last flight (FR-069). Uses the same core rules as the server, then exports history for import
 * when the guest creates an account (FR-071).
 */
export class GuestStore {
  constructor(
    private readonly storage: StorageLike,
    private readonly now: () => Instant,
    private readonly random: Rng = Math.random,
    private readonly newId: () => string = () => globalThis.crypto.randomUUID(),
  ) {}

  /** Loads guest data, deleting it first if it has expired (AC-34). */
  load(): GuestState {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const state = JSON.parse(raw) as GuestState;
        if (state.version === 1 && !isGuestDataExpired(state.createdAt, state.lastFlightAt, this.now())) return state;
      } catch {
        // corrupt data is discarded
      }
      this.storage.removeItem(STORAGE_KEY);
    }
    const fresh: GuestState = {
      version: 1,
      createdAt: this.now(),
      lastFlightAt: null,
      presenceId: this.newId(),
      booking: null,
      session: null,
      history: [],
    };
    this.save(fresh);
    return fresh;
  }

  expiresAt(): Instant {
    const s = this.load();
    return guestDataExpiresAt(s.createdAt, s.lastFlightAt);
  }

  clear(): void {
    this.storage.removeItem(STORAGE_KEY);
  }

  stats(timeZone: string): UserStats {
    return computeStats(this.load().history, this.now(), timeZone);
  }

  unlocks() {
    const stats = this.stats("UTC");
    return unlockStateFor({
      creditedFocusMs: stats.creditedFocusMs,
      completedFlights: stats.completedFlights,
      countries: stats.countriesCollected,
      specialAchievements: 0,
    });
  }

  /**
   * Books a flight locally. Pass the snapshot from a search result. Random Flight draws may pass
   * isRandomDraw to bypass unlocks (FR-005).
   */
  book(input: {
    snapshot: ScheduleSnapshot;
    mode: DepartureMode;
    cabin: CabinClass;
    timeZone: string;
    chosenDeparture?: Instant | null;
    studyWindow?: { start: Instant; end: Instant } | null;
    studyGoal?: string | null;
    breakSchedule?: BreakSchedule | null;
    isRandomDraw?: boolean;
    /** Airline unlock tier from the API's /v1/airlines. */
    airlineTier: number;
  }): { ok: true; booking: GuestBooking } | { ok: false; errors: GuestError[] } {
    const state = this.load();
    if (state.session && !FINAL.has(summarize(state.session, this.now()).outcome)) {
      return { ok: false, errors: ["flight_in_progress"] };
    }
    const now = this.now();
    const errors = checkBookingRequest({
      mode: input.mode,
      snapshot: input.snapshot,
      cabin: input.cabin,
      now,
      userTimeZone: input.timeZone,
      chosenDeparture: input.chosenDeparture ?? null,
      studyWindow: input.studyWindow ?? null,
      unlocks: this.unlocks(),
      airlineTier: input.airlineTier,
      isRandomDraw: input.isRandomDraw ?? false,
    });
    if (errors.length > 0) return { ok: false, errors };
    const planned = plannedTimes(input.mode, input.snapshot, { now, chosenDeparture: input.chosenDeparture ?? null });
    const booking: GuestBooking = {
      snapshot: input.snapshot,
      times: { mode: input.mode, plannedDeparture: planned.departure, plannedArrival: planned.arrival, createdAt: now },
      cabin: input.cabin,
      studyGoal: input.studyGoal ?? null,
      breakSchedule: input.breakSchedule ?? DEFAULT_BREAK_SCHEDULE,
    };
    this.save({ ...state, booking, session: null });
    return { ok: true, booking };
  }

  board(): { ok: true; session: FlightSessionData } | { ok: false; error: GuestError } {
    const state = this.load();
    if (!state.booking) return { ok: false, error: "no_booking" };
    const family = AIRCRAFT_BY_CODE.get(state.booking.snapshot.aircraftType ?? "")?.family ?? "narrowbody";
    const result = boardFlight({
      booking: state.booking.times,
      snapshotId: state.booking.snapshot.id,
      cabin: state.booking.cabin,
      seat: assignSeat(state.booking.times.mode, family, state.booking.cabin, this.random),
      breakSchedule: state.booking.breakSchedule,
      studyGoal: state.booking.studyGoal,
      isPublic: false,
      now: this.now(),
    });
    if (!result.ok) {
      if (result.error === "no_show") this.archive(state, null, "no_show");
      return result;
    }
    this.save({ ...state, session: result.session });
    return result;
  }

  act(action: SessionAction): { ok: true; session: FlightSessionData } | { ok: false; error: GuestError } {
    const state = this.load();
    if (!state.session) return { ok: false, error: "no_active_flight" };
    const result = applySessionAction(state.session, action, this.now());
    if (!result.ok) return result;
    this.save({ ...state, session: result.session });
    this.finalizeIfDone();
    return result;
  }

  plan(): FlightPlan | null {
    const state = this.load();
    if (!state.session || !state.booking) return null;
    const origin = AIRPORTS_BY_IATA.get(state.booking.snapshot.origin);
    const destination = AIRPORTS_BY_IATA.get(state.booking.snapshot.destination);
    if (!origin || !destination) return null;
    return createFlightPlan({ origin, destination, departure: state.session.departure, blockMs: state.session.arrival - state.session.departure });
  }

  view(): SessionView | null {
    this.finalizeIfDone();
    const state = this.load();
    const plan = this.plan();
    return state.session && plan ? sessionView(state.session, plan, this.now()) : null;
  }

  /** Moves a finished flight into history. Safe to call repeatedly. */
  finalizeIfDone(): void {
    const state = this.load();
    if (!state.session || !state.booking) return;
    const summary = summarize(state.session, this.now());
    if (FINAL.has(summary.outcome)) this.archive(state, state.session, summary.outcome as GuestFlightImport["outcome"]);
  }

  /** History in the shape POST /v1/me/import-guest expects. */
  exportForImport(): GuestFlightImport[] {
    return this.load().history;
  }

  private archive(state: GuestState, session: FlightSessionData | null, outcome: GuestFlightImport["outcome"]): void {
    const booking = state.booking;
    if (!booking) return;
    const s = booking.snapshot;
    const origin = AIRPORTS_BY_IATA.get(s.origin);
    const destination = AIRPORTS_BY_IATA.get(s.destination);
    const summary = session ? summarize(session, this.now()) : null;
    const record: GuestFlightImport = {
      snapshotId: s.id,
      outcome,
      departure: session?.departure ?? booking.times.plannedDeparture,
      arrival: session?.arrival ?? booking.times.plannedArrival,
      blockMs: booking.times.plannedArrival - booking.times.plannedDeparture,
      creditedFocusMs: summary?.creditedFocusMs ?? 0,
      breakMs: summary?.breakMs ?? 0,
      creditedFlightMs: summary?.creditedFlightMs ?? 0,
      origin: s.origin,
      destination: s.destination,
      destinationCountry: destination?.country ?? "",
      airline: s.operatingAirline,
      aircraftType: s.aircraftType,
      distanceKm: origin && destination ? greatCircleDistanceKm(origin, destination) : 0,
      validatedAt: session?.validatedAt ?? null,
      studyGoal: booking.studyGoal,
      goalCompleted: session?.goalCompleted ?? null,
    };
    this.save({
      ...state,
      booking: null,
      session: null,
      history: [...state.history, record],
      lastFlightAt: session ? this.now() : state.lastFlightAt,
    });
  }

  private save(state: GuestState): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

/** Airline tiers for guests, computed the same way as the server (from a week of departures). */
export { buildAirlineTierTable };
