import {
  blockDurationMs,
  bookingWindowEnd,
  checkBookingRequest,
  displayTime,
  fitsStudyWindow,
  localDate,
  offeredCabins,
  pickRandomFlight,
  plannedTimes,
  resolveOperatingSnapshot,
  addDaysToDate,
  serviceKey,
  type Airport,
  type CabinClass,
  type DepartureMode,
  type Instant,
  type ScheduleSnapshot,
  type StudyWindow,
  type UnlockState,
} from "@aerofocus/core";
import { AIRCRAFT_BY_CODE, AIRLINES_BY_IATA, AIRPORTS_BY_IATA } from "@aerofocus/data";
import { eq } from "drizzle-orm";
import type { AppDeps } from "../context";
import { scheduleSnapshots } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { sign, verify } from "../signing";

export function airportOrThrow(iata: string): Airport {
  const airport = AIRPORTS_BY_IATA.get(iata);
  if (!airport) throw new ApiError(500, "unknown_airport", `Airport ${iata} missing from reference data`);
  return airport;
}

export function airlineTier(deps: AppDeps, iata: string): number {
  // Airlines not in the tier table are treated as top-tier (locked until the end).
  return deps.tierTable.tiers.get(iata) ?? 6;
}

/** Snapshot by id: stored copy first (survives provider outages, NFR-010), then the provider. */
export async function findSnapshot(deps: AppDeps, id: string): Promise<ScheduleSnapshot | null> {
  const [row] = await deps.db.select({ data: scheduleSnapshots.data }).from(scheduleSnapshots).where(eq(scheduleSnapshots.id, id)).limit(1);
  if (row) return row.data;
  try {
    return await deps.provider.getSnapshot(id);
  } catch {
    return null;
  }
}

export async function storeSnapshot(deps: AppDeps, s: ScheduleSnapshot): Promise<void> {
  await deps.db
    .insert(scheduleSnapshots)
    .values({
      id: s.id,
      provider: s.provider,
      dataVersion: s.dataVersion,
      operatingAirline: s.operatingAirline,
      flightNumber: s.flightNumber,
      origin: s.origin,
      destination: s.destination,
      operatingDate: s.operatingDate,
      departure: s.departure,
      arrival: s.arrival,
      data: s,
    })
    .onConflictDoNothing();
}

export function airportView(a: Airport) {
  return { iata: a.iata, name: a.name, city: a.city, country: a.country, region: a.region, lat: a.lat, lon: a.lon, timeZone: a.timeZone };
}

export function aircraftView(code: string | null) {
  if (!code) return { code: null, name: "Aircraft to be confirmed", family: "narrowbody" as const, known: false };
  const type = AIRCRAFT_BY_CODE.get(code);
  return type ? { ...type, known: true } : { code, name: code, family: "narrowbody" as const, known: false };
}

export interface OfferContext {
  deps: AppDeps;
  now: Instant;
  userTimeZone: string;
  unlocks: UnlockState;
}

/** A bookable (or locked) flight option for the UI. */
export function offerView(ctx: OfferContext, snapshot: ScheduleSnapshot, mode: DepartureMode, departure: Instant) {
  const block = blockDurationMs(snapshot);
  const airline = AIRLINES_BY_IATA.get(snapshot.operatingAirline);
  const tier = airlineTier(ctx.deps, snapshot.operatingAirline);
  const airlineLocked = tier > ctx.unlocks.airlineTier;
  return {
    snapshotId: snapshot.id,
    mode,
    flightNumber: `${snapshot.operatingAirline}${snapshot.flightNumber}`,
    airline: {
      iata: snapshot.operatingAirline,
      name: airline?.name ?? snapshot.operatingAirline,
      type: airline?.type ?? "full_service",
      tier,
      locked: airlineLocked,
    },
    marketingAirline: snapshot.marketingAirline,
    origin: airportView(airportOrThrow(snapshot.origin)),
    destination: airportView(airportOrThrow(snapshot.destination)),
    aircraft: aircraftView(snapshot.aircraftType),
    operatingDate: snapshot.operatingDate,
    blockMs: block,
    departure: displayTime(departure, ctx.userTimeZone),
    arrival: displayTime(departure + block, ctx.userTimeZone),
    cabins: offeredCabins(snapshot).map((cabin) => ({ cabin, locked: !ctx.unlocks.cabinClasses.includes(cabin) })),
    bookable: !airlineLocked,
    dataSource: snapshot.sourceStatus,
  };
}

export type OfferView = ReturnType<typeof offerView>;

export interface SearchFilters {
  studyWindow: StudyWindow | null;
  modes: ("community" | "individual")[];
  origin?: string | undefined;
  destination?: string | undefined;
  airline?: string | undefined;
  aircraft?: string | undefined;
  cabin?: CabinClass | undefined;
  region?: string | undefined;
  minDurationMs?: number | undefined;
  maxDurationMs?: number | undefined;
  limit: number;
}

/**
 * Flight search (FR-002, FR-006). Community Flights must depart and land inside the study window at
 * their published times. Individual flights depart at the window start (or now) and must fit.
 */
export async function searchFlights(ctx: OfferContext, f: SearchFilters): Promise<OfferView[]> {
  const windowEnd = bookingWindowEnd(ctx.now, ctx.userTimeZone);
  const departures = await ctx.deps.provider.listDepartures({
    from: ctx.now - 30 * 60_000, // include community flights still open for late boarding
    to: windowEnd,
    ...(f.origin ? { origin: f.origin } : {}),
    ...(f.destination ? { destination: f.destination } : {}),
    ...(f.airline ? { airline: f.airline } : {}),
  });
  const matches = (s: ScheduleSnapshot): boolean => {
    const block = blockDurationMs(s);
    if (f.aircraft && s.aircraftType !== f.aircraft) return false;
    if (f.cabin && !offeredCabins(s).includes(f.cabin)) return false;
    if (f.minDurationMs !== undefined && block < f.minDurationMs) return false;
    if (f.maxDurationMs !== undefined && block > f.maxDurationMs) return false;
    if (f.region) {
      const o = AIRPORTS_BY_IATA.get(s.origin);
      const d = AIRPORTS_BY_IATA.get(s.destination);
      if (o?.region !== f.region && d?.region !== f.region && o?.country !== f.region && d?.country !== f.region) return false;
    }
    return true;
  };

  const offers: OfferView[] = [];

  if (f.modes.includes("community")) {
    for (const s of departures) {
      if (!matches(s)) continue;
      if (f.studyWindow && !fitsStudyWindow(s, f.studyWindow)) continue;
      const errors = checkBookingRequest({
        mode: "community", snapshot: s, cabin: "economy", now: ctx.now, userTimeZone: ctx.userTimeZone,
        unlocks: { airlineTier: Number.POSITIVE_INFINITY, cabinClasses: ["economy"] }, airlineTier: 0,
      });
      if (errors.length > 0) continue;
      offers.push(offerView(ctx, s, "community", s.departure));
    }
  }

  if (f.modes.includes("individual")) {
    const start = Math.max(ctx.now, f.studyWindow?.start ?? ctx.now);
    const mode: DepartureMode = start <= ctx.now + 60_000 ? "depart_now" : "custom";
    const seen = new Set<string>();
    const byService = new Map<string, ScheduleSnapshot[]>();
    for (const s of departures) {
      const key = serviceKey(s);
      byService.set(key, [...(byService.get(key) ?? []), s]);
    }
    for (const [key, occurrences] of byService) {
      if (seen.has(key)) continue;
      seen.add(key);
      const origin = airportOrThrow(occurrences[0]!.origin);
      const snapshot = resolveOperatingSnapshot(occurrences, localDate(start, origin.timeZone));
      if (!snapshot || !matches(snapshot)) continue;
      const planned = plannedTimes(mode, snapshot, { now: ctx.now, chosenDeparture: start });
      if (f.studyWindow && !fitsStudyWindow(planned, { start: f.studyWindow.start, end: f.studyWindow.end })) continue;
      if (planned.departure >= windowEnd) continue;
      offers.push(offerView(ctx, snapshot, mode, planned.departure));
    }
  }

  // Closest fit to the window first, then earliest departure.
  const windowMs = f.studyWindow ? f.studyWindow.end - f.studyWindow.start : null;
  offers.sort((a, b) =>
    windowMs !== null
      ? windowMs - a.blockMs - (windowMs - b.blockMs) || a.departure.epochMs - b.departure.epochMs
      : a.departure.epochMs - b.departure.epochMs,
  );
  return offers.slice(0, f.limit);
}

export interface RandomDrawClaim {
  snapshotId: string;
  cabin: CabinClass;
  userId: string | null;
  expiresAt: Instant;
}

const RANDOM_DRAW_TTL_MS = 30 * 60_000;

/** Random Flight (FR-005): only the study duration is chosen; everything else is drawn. */
export async function drawRandomFlight(ctx: OfferContext, studyMs: number, userId: string | null) {
  const departures = await ctx.deps.provider.listDepartures({ from: ctx.now, to: bookingWindowEnd(ctx.now, ctx.userTimeZone) });
  // One occurrence per service is enough; individual flights depart now.
  const unique = new Map<string, ScheduleSnapshot>();
  for (const s of departures) if (!unique.has(serviceKey(s))) unique.set(serviceKey(s), s);
  const pick = pickRandomFlight([...unique.values()], studyMs, ctx.deps.random);
  if (!pick) throw new ApiError(404, "no_flight_fits", "No flight fits that study duration");
  const planned = plannedTimes("depart_now", pick.snapshot, { now: ctx.now });
  const claim: RandomDrawClaim = { snapshotId: pick.snapshot.id, cabin: pick.cabin, userId, expiresAt: ctx.now + RANDOM_DRAW_TTL_MS };
  return {
    offer: offerView(ctx, pick.snapshot, "depart_now", planned.departure),
    cabin: pick.cabin,
    /** Pass to POST /v1/bookings to book this draw; it may use locked airlines and classes. */
    drawToken: sign(ctx.deps.signingSecret, claim),
  };
}

export function verifyRandomDraw(deps: AppDeps, token: string, userId: string, now: Instant): RandomDrawClaim {
  const claim = verify<RandomDrawClaim>(deps.signingSecret, token);
  if (!claim || claim.expiresAt < now || (claim.userId !== null && claim.userId !== userId)) {
    throw new ApiError(400, "invalid_draw_token", "Random Flight draw is invalid or expired");
  }
  return claim;
}

/** Snapshot for an individual booking on a chosen date: exact operating date, else the nearest (FR-003). */
export async function snapshotForIndividualDate(deps: AppDeps, base: ScheduleSnapshot, departure: Instant): Promise<ScheduleSnapshot> {
  const origin = airportOrThrow(base.origin);
  const date = localDate(departure, origin.timeZone);
  try {
    const occurrences = await deps.provider.serviceOccurrences(
      base.operatingAirline,
      base.flightNumber,
      addDaysToDate(date, -7),
      addDaysToDate(date, 7),
    );
    return resolveOperatingSnapshot(occurrences, date) ?? base;
  } catch {
    return base; // provider unavailable: keep the snapshot the user selected
  }
}

export async function snapshotOrThrow(deps: AppDeps, id: string): Promise<ScheduleSnapshot> {
  const s = await findSnapshot(deps, id);
  if (!s) throw notFound("Flight");
  return s;
}
