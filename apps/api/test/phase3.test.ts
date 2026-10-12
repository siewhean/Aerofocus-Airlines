import { DAY } from "@aerofocus/core";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { bookings, flightSessions, importedFlights, travelMarks } from "../src/db/schema";
import { storeSnapshot } from "../src/services/catalogue";
import { finalizeIfDone, loadSession } from "../src/services/sessions";
import { createTestEnv, HOUR, MIN, T0, type TestEnv } from "./helpers";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
  env = undefined as unknown as TestEnv;
});

/** Unlocks every airline used here; the tier table itself is covered by Phase 1 tests. */
async function setup(): Promise<string> {
  env = await createTestEnv();
  const tiers = new Map(env.deps.tierTable.tiers);
  for (const airline of ["QR", "QF", "JQ", "SQ", "BA", "TR"]) tiers.set(airline, 0);
  env.deps.tierTable = { ...env.deps.tierTable, tiers };
  return env.register();
}

const IMPORTED_FOCUS_MS = 10 * 4 * HOUR;

/** Reaches Silver (business class) with 10 imported 4-hour flights (40 focus hours). */
async function grantSilver(token: string): Promise<void> {
  const userId = (await env.call("GET", "/v1/me", { token })).body.user.id as string;
  const [snapshot] = await env.deps.provider.listDepartures({ from: T0 - 14 * DAY, to: T0, origin: "SIN", destination: "BKK" });
  await storeSnapshot(env.deps, snapshot!);
  await env.deps.db.insert(importedFlights).values(
    Array.from({ length: 10 }, (_, i) => ({
      userId,
      snapshotId: snapshot!.id,
      outcome: "complete" as const,
      departure: T0 - (i + 2) * DAY,
      arrival: T0 - (i + 2) * DAY + 4 * HOUR,
      creditedFocusMs: 4 * HOUR,
      breakMs: 0,
      creditedFlightMs: 4 * HOUR,
      studyGoal: null,
      goalCompleted: null,
      importedAt: T0,
    })),
  );
  expect((await env.call("GET", "/v1/me/progression", { token })).body.unlocks.cabinClasses).toContain("business");
}

const flightNumbers = (offer: any): string => offer.legs.map((l: any) => l.flightNumber).join(">");

async function searchOffer(token: string | undefined, query: string, route: string) {
  const res = await env.call("GET", `/v1/itineraries/search?${query}`, token ? { token } : {});
  expect(res.status).toBe(200);
  const offer = res.body.offers.find((o: any) => flightNumbers(o) === route);
  if (!offer) throw new Error(`${route} not found in ${res.body.offers.map(flightNumbers).join(", ")}`);
  return offer;
}

async function book(token: string, offer: any, cabins: string[], extra: Record<string, unknown> = {}) {
  const res = await env.call("POST", "/v1/itineraries", {
    token,
    body: {
      mode: offer.mode,
      chosenDeparture: offer.chosenDeparture,
      legs: offer.legs.map((l: any, i: number) => ({ snapshotId: l.snapshotId, cabin: cabins[i] ?? "economy" })),
      ...extra,
    },
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.itinerary;
}

const itinerary = async (token: string, id: string) => (await env.call("GET", `/v1/itineraries/${id}`, { token })).body.itinerary;
const board = (token: string, bookingId: string) => env.call("POST", `/v1/bookings/${bookingId}/board`, { token });

/** Boards leg `i` 10 minutes before its planned departure (or at `at`), then lands and validates it. */
async function flyLeg(token: string, id: string, i: number, options: { at?: number; validate?: boolean } = {}) {
  const leg = (await itinerary(token, id)).legs[i];
  env.clock.t = options.at ?? leg.boardingPass.departure.epochMs - 10 * MIN;
  const boarded = await board(token, leg.bookingId);
  expect(boarded.status).toBe(201);
  const sessionId = boarded.body.sessionId as string;
  const session = (await env.call("GET", `/v1/sessions/${sessionId}`, { token })).body;
  env.clock.t = session.flight.arrival.epochMs + 2 * MIN;
  if (options.validate !== false) {
    const validated = await env.call("POST", `/v1/sessions/${sessionId}/validate`, { token, body: {} });
    expect(validated.body.focus.outcome).toBe("complete");
  }
  return { sessionId, arrival: session.flight.arrival.epochMs as number };
}

describe("Phase 3: connection search", () => {
  it("finds SIN→DOH→LHR for signed-in users and guests", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=SIN&destination=LHR&mode=community", "QR945>QR15");
    expect(offer).toMatchObject({ connections: 1, direct: false, mode: "community", bookable: true });
    expect(offer.layovers[0]).toMatchObject({ airport: { iata: "DOH" }, minimumConnectionMs: 60 * MIN, domestic: false });
    expect(offer.layovers[0].layoverMs).toBe(offer.legs[1].departure.epochMs - offer.legs[0].arrival.epochMs);
    expect(offer.totalMs).toBe(offer.arrival.epochMs - offer.departure.epochMs);

    const guest = await searchOffer(undefined, "origin=SIN&destination=LHR&mode=community&timeZone=Europe/London", "QR945>QR15");
    expect(guest.departure.timeZone).toBe("Europe/London");
    // Individual: each route once, first leg departs now, later legs keep the published layover.
    const individual = (await env.call("GET", "/v1/itineraries/search?origin=MEL&destination=BNE&mode=individual", { token })).body.offers;
    const routes = individual.map(flightNumbers);
    expect(new Set(routes).size).toBe(routes.length);
    const qf = individual.find((o: any) => flightNumbers(o) === "QF430>QF520");
    expect(qf.legs.map((l: any) => l.mode)).toEqual(["depart_now", "custom"]);
    expect(qf.layovers[0]).toMatchObject({ layoverMs: 75 * MIN, domestic: true, minimumConnectionMs: 45 * MIN });
    expect((await env.call("GET", "/v1/itineraries/search?origin=SIN", { token })).status).toBe(400);
  });
});

describe("Phase 3: connecting flights end to end", () => {
  it("flies SIN→DOH→LHR with a layover, lounge and layover focus, then completes the journey", async () => {
    const token = await setup();
    await grantSilver(token);
    const offer = await searchOffer(token, "origin=SIN&destination=LHR&mode=community", "QR945>QR15");
    const it = await book(token, offer, ["business", "economy"], { studyGoal: "Thesis chapter" });
    expect(it).toMatchObject({ status: "booked", mode: "community", origin: { iata: "SIN" }, destination: { iata: "LHR" }, canAbandon: true });
    expect(it.legs.map((l: any) => [l.legIndex, l.boardingPass.itineraryId, l.boardingPass.legIndex])).toEqual([
      [0, it.id, 0],
      [1, it.id, 1],
    ]);
    expect(it.layovers[0]).toMatchObject({ airport: { iata: "DOH" }, lounge: "premium" });
    expect(it.notifications.map((n: any) => n.type)).toEqual(
      expect.arrayContaining(["leg_landed", "validate_reminder", "layover_started", "lounge_available", "boarding_open", "boarding_closing", "connection_missed"]),
    );
    expect((await env.call("GET", "/v1/itineraries", { token })).body.itineraries.map((i: any) => i.id)).toEqual([it.id]);
    // Legs are managed through the itinerary.
    expect((await env.call("DELETE", `/v1/bookings/${it.legs[1].bookingId}`, { token })).body.error.code).toBe("itinerary_leg");

    const [leg1, leg2] = it.legs;
    env.clock.t = leg1.boardingPass.departure.epochMs - 10 * MIN;
    const boarded1 = await board(token, leg1.bookingId);
    expect(boarded1.status).toBe(201);
    // Leg 2 cannot be boarded before leg 1 lands.
    const early = await board(token, leg2.bookingId);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("previous_leg_not_landed");
    expect((await itinerary(token, it.id)).status).toBe("in_progress");

    const arrival1 = leg1.boardingPass.arrival.epochMs;
    env.clock.t = arrival1 + 2 * MIN;
    let layover = (await env.call("GET", `/v1/itineraries/${it.id}/layover`, { token })).body;
    expect(layover.layover).toMatchObject({ phase: "deplaning", airport: { iata: "DOH" }, lounge: { access: "premium", premium: true } });
    expect(layover.layover.msToDeparture).toBe(leg2.boardingPass.departure.epochMs - env.clock.t);
    expect(layover.departures.some((d: any) => d.yours && d.flightNumber === "QR15")).toBe(true);
    const sessionId1 = boarded1.body.sessionId;
    expect((await env.call("POST", `/v1/sessions/${sessionId1}/validate`, { token, body: {} })).body.focus.outcome).toBe("complete");
    layover = (await env.call("GET", `/v1/itineraries/${it.id}/layover`, { token })).body;
    expect(layover.layover.phase).toBe("in_terminal");

    // Layover focus: 20 attended minutes.
    const focusStart = arrival1 + 5 * MIN;
    env.clock.t = focusStart;
    expect((await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/start`, { token })).status).toBe(200);
    expect((await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/start`, { token })).body.error.code).toBe("already_focusing");
    for (let m = 4; m <= 20; m += 4) {
      env.clock.t = focusStart + m * MIN;
      await env.call("POST", `/v1/itineraries/${it.id}/layover/heartbeat`, { token });
    }
    const stopped = (await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/stop`, { token })).body;
    expect(stopped.layover.focus).toMatchObject({ focusing: false, focusMs: 20 * MIN, creditedMs: 20 * MIN, final: false });
    expect((await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/stop`, { token })).body.error.code).toBe("not_focusing");

    env.clock.t = leg2.boardingPass.departure.epochMs - 10 * MIN;
    expect((await env.call("GET", `/v1/itineraries/${it.id}/layover`, { token })).body.layover.phase).toBe("boarding_open");
    const boarded2 = await board(token, leg2.bookingId);
    expect(boarded2.status).toBe(201);
    let view = await itinerary(token, it.id);
    expect(view.layovers[0].creditedFocusMs).toBe(20 * MIN);
    expect(view.layover).toBeNull();
    expect((await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/start`, { token })).body.error.code).toBe("outside_layover");

    env.clock.t = leg2.boardingPass.arrival.epochMs + 2 * MIN;
    expect((await env.call("POST", `/v1/sessions/${boarded2.body.sessionId}/validate`, { token, body: {} })).body.focus.outcome).toBe("complete");
    view = await itinerary(token, it.id);
    expect(view).toMatchObject({ status: "complete", canAbandon: false, currentAirport: { iata: "LHR" } });
    expect(view.notifications.at(-1).type).toBe("itinerary_complete");
    expect((await env.call("POST", `/v1/itineraries/${it.id}/abandon`, { token })).body.error.code).toBe("not_abandonable");

    const passport = (await env.call("GET", "/v1/me/passport", { token })).body;
    expect(passport.marks.map((m: any) => [m.airport, m.country, m.isTransit, m.visitNumber])).toEqual([
      ["DOH", "QA", true, 1],
      ["LHR", "GB", false, 1],
    ]);
    expect(passport.countries).toEqual(
      expect.arrayContaining([
        { country: "QA", visits: 1, transit: 1, final: 0 },
        { country: "GB", visits: 1, transit: 0, final: 1 },
      ]),
    );
    const achievements = (await env.call("GET", "/v1/me/achievements", { token })).body.achievements;
    expect(achievements.find((a: any) => a.id === "first_connection").earnedAt).not.toBeNull();
    expect(achievements.find((a: any) => a.id === "three_leg_journey").earnedAt).toBeNull();

    const history = (await env.call("GET", "/v1/me/history", { token })).body.flights;
    expect(history.map((f: any) => [f.flightNumber, f.itineraryId, f.legIndex, f.status])).toEqual([
      ["QR15", it.id, 1, "complete"],
      ["QR945", it.id, 0, "complete"],
    ]);
    const stats = (await env.call("GET", "/v1/me/stats", { token })).body.stats;
    expect(stats).toMatchObject({ itinerariesCompleted: 1, multiLegItinerariesCompleted: 1, multiLegCompletionRate: 1, transitAirports: 1, premiumLoungeLayovers: 1 });
    expect(stats.totalLayoverMs).toBe(view.layovers[0].layoverMs);
    expect(stats.countryVisits).toMatchObject({ QA: { transit: 1, final: 0 }, GB: { transit: 0, final: 1 } });
    // Layover focus is credited on top of the legs' own focus.
    const legFocus = history.reduce((s: number, f: any) => s + f.creditedFocusMs, 0);
    expect(stats.creditedFocusMs).toBe(IMPORTED_FOCUS_MS + legFocus + 20 * MIN);
    const globe = (await env.call("GET", "/v1/me/globe", { token })).body;
    const qr945 = globe.features.find((f: any) => f.properties.kind === "leg" && f.properties.flightNumber === "QR945");
    expect(qr945.properties).toMatchObject({ itineraryId: it.id, legIndex: 0, isTransit: true });
  });

  it("re-times later individual legs after boarding, abandons after leg 1 and rebooks from the layover airport", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=MEL&destination=BNE&mode=individual", "QF430>QF520");
    const it = await book(token, offer, ["economy", "economy"]);
    const [leg1, leg2] = it.legs;
    expect(leg1.boardingPass.mode).toBe("depart_now");
    expect(leg2.boardingPass.mode).toBe("custom");
    expect(leg2.boardingPass.departure.epochMs - leg1.boardingPass.arrival.epochMs).toBe(75 * MIN);
    // A separate flight may not overlap the itinerary's booked legs.
    const overlap = await env.call("POST", "/v1/bookings", {
      token,
      body: { snapshotId: offer.legs[1].snapshotId, mode: "custom", cabin: "economy", chosenDeparture: leg2.boardingPass.departure.epochMs },
    });
    expect(overlap.body.error.code).toBe("itinerary_conflict");

    // Board leg 1 five minutes late: leg 2 moves with it and keeps the 75-minute layover.
    const { arrival } = await flyLeg(token, it.id, 0, { at: T0 + 5 * MIN });
    let view = await itinerary(token, it.id);
    expect(view.legs[1].boardingPass.departure.epochMs).toBe(arrival + 75 * MIN);
    expect(view.legs[1].boardingPass.departure.epochMs).toBe(leg2.boardingPass.departure.epochMs + 5 * MIN);
    // Connecting legs board like Community Flights: 15 minutes before departure until takeoff.
    expect(view.legs[1].boardingPass.boardingOpensAt.epochMs).toBe(view.legs[1].boardingPass.departure.epochMs - 15 * MIN);
    expect(view.legs[1].boardingPass.boardingClosesAt.epochMs).toBeLessThan(view.legs[1].boardingPass.arrival.epochMs);

    env.clock.t = arrival + 20 * MIN;
    const abandoned = (await env.call("POST", `/v1/itineraries/${it.id}/abandon`, { token })).body.itinerary;
    expect(abandoned).toMatchObject({ status: "abandoned", canAbandon: false, currentAirport: { iata: "SYD" } });
    expect(abandoned.legs.map((l: any) => l.boardingPass.status)).toEqual(["boarded", "cancelled"]);
    expect(abandoned.legs[0].outcome).toBe("complete");
    expect((await board(token, leg2.bookingId)).body.error.code).toBe("booking_cancelled");
    // Leg 1 rewards stay: completed flight, focus and a transit mark at SYD.
    const stats = (await env.call("GET", "/v1/me/stats", { token })).body.stats;
    expect(stats).toMatchObject({ completedFlights: 1, itinerariesCompleted: 0, multiLegCompletionRate: 0, transitAirports: 1 });
    const marks = (await env.call("GET", "/v1/me/passport", { token })).body.marks;
    expect(marks.map((m: any) => [m.airport, m.isTransit])).toEqual([["SYD", true]]);

    const rebook = (await env.call("GET", `/v1/itineraries/${it.id}/rebook`, { token })).body;
    expect(rebook).toMatchObject({ rebookedFromId: it.id, from: { iata: "SYD" }, to: { iata: "BNE" } });
    const direct = rebook.offers.find((o: any) => o.direct && o.legs[0].origin.iata === "SYD");
    expect(direct).toBeDefined();
    const rebooked = await book(token, direct, ["economy"], { rebookedFromId: it.id });
    expect(rebooked).toMatchObject({ rebookedFromId: it.id, origin: { iata: "SYD" }, destination: { iata: "BNE" }, status: "booked" });
    // Rebooking must start where the passenger is.
    const wrong = await env.call("POST", "/v1/itineraries", {
      token,
      body: { mode: "individual", legs: offer.legs.map((l: any) => ({ snapshotId: l.snapshotId, cabin: "economy" })), rebookedFromId: it.id },
    });
    expect(wrong.body.error.code).toBe("rebook_route_mismatch");
  });

  it("a missed connection makes the itinerary incomplete and keeps leg 1 rewards", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=MEL&destination=BNE&mode=community", "QF430>QF520");
    const it = await book(token, offer, ["economy", "economy"]);
    await flyLeg(token, it.id, 0);
    const leg2 = it.legs[1].boardingPass;
    env.clock.t = Math.ceil(leg2.boardingClosesAt.epochMs) + MIN; // after takeoff
    expect((await env.call("GET", `/v1/itineraries/${it.id}/layover`, { token })).body.layover.phase).toBe("missed");
    const missed = await board(token, it.legs[1].bookingId);
    expect(missed.status).toBe(409);
    expect(missed.body.error.code).toBe("connection_missed");
    const view = await itinerary(token, it.id);
    expect(view).toMatchObject({ status: "incomplete", canAbandon: false });
    expect(view.legs.map((l: any) => [l.outcome, l.boardingPass.status])).toEqual([
      ["complete", "boarded"],
      [null, "no_show"],
    ]);
    expect(view.notifications.some((n: any) => n.legIndex === 1)).toBe(false);
    const stats = (await env.call("GET", "/v1/me/stats", { token })).body.stats;
    expect(stats).toMatchObject({ completedFlights: 1, itinerariesCompleted: 0, multiLegCompletionRate: 0 });
    expect((await env.call("GET", "/v1/me/passport", { token })).body.marks.map((m: any) => m.airport)).toEqual(["SYD"]);
    expect((await env.call("GET", `/v1/itineraries/${it.id}/rebook`, { token })).body.from.iata).toBe("SYD");
  });

  it("boarding a connecting leg after its takeoff is a missed connection (refused at the gate)", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=MEL&destination=BNE&mode=individual", "QF430>QF520");
    const it = await book(token, offer, ["economy", "economy"]);
    await flyLeg(token, it.id, 0, { at: T0 });
    const leg2 = (await itinerary(token, it.id)).legs[1];
    env.clock.t = Math.ceil(leg2.boardingPass.boardingClosesAt.epochMs); // takeoff
    const res = await board(token, leg2.bookingId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("connection_missed");
    const view = await itinerary(token, it.id);
    expect(view.status).toBe("incomplete");
    expect(view.legs[0].outcome).toBe("complete");
    expect((await env.call("GET", "/v1/me/stats", { token })).body.stats.completedFlights).toBe(1);
  });

  it("a late connecting passenger joins in progress before takeoff; abandoning the in-flight last leg is refused", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=MEL&destination=BNE&mode=individual", "QF430>QF520");
    const it = await book(token, offer, ["economy", "economy"]);
    await flyLeg(token, it.id, 0, { at: T0 });
    const leg2 = (await itinerary(token, it.id)).legs[1].boardingPass;
    const late = leg2.departure.epochMs + 3 * MIN;
    expect(late).toBeLessThan(leg2.boardingClosesAt.epochMs);
    env.clock.t = late;
    const boarded = await board(token, leg2.bookingId);
    expect(boarded.status).toBe(201);
    const session = (await env.call("GET", `/v1/sessions/${boarded.body.sessionId}`, { token })).body;
    expect(session.flight.departure.epochMs).toBe(leg2.departure.epochMs); // planned times kept
    expect(session.flight.arrival.epochMs).toBe(leg2.arrival.epochMs);

    const refused = await env.call("POST", `/v1/itineraries/${it.id}/abandon`, { token });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("not_abandonable");
    env.clock.t = leg2.arrival.epochMs + 2 * MIN;
    await env.call("POST", `/v1/sessions/${boarded.body.sessionId}/validate`, { token, body: {} });
    expect((await itinerary(token, it.id)).status).toBe("complete");
  });
});

describe("Phase 3: one active flight at a time and review fixes", () => {
  it("an open itinerary reserves its whole journey: no separate flight or itinerary inside a layover", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=SIN&destination=LHR&mode=community", "QR945>QR15");
    const it = await book(token, offer, ["economy", "economy"]);
    const arrival0 = it.legs[0].boardingPass.arrival.epochMs as number;
    const [kulSin] = await env.deps.provider.listDepartures({ from: T0, to: T0 + 3 * 24 * HOUR, origin: "KUL", destination: "SIN" });
    // Before boarding: a custom flight inside the layover gap is refused, as is another itinerary.
    const inGap = await env.call("POST", "/v1/bookings", {
      token,
      body: { snapshotId: kulSin!.id, mode: "custom", cabin: "economy", chosenDeparture: arrival0 + 10 * MIN },
    });
    expect(inGap.status).toBe(409);
    expect(inGap.body.error.code).toBe("itinerary_conflict");
    const twice = await env.call("POST", "/v1/itineraries", {
      token,
      body: { mode: "community", legs: offer.legs.map((l: any) => ({ snapshotId: l.snapshotId, cabin: "economy" })) },
    });
    expect(twice.body.error.code).toBe("itinerary_conflict");

    // The reviewer's scenario: during the layover, a depart-now flight is refused.
    await flyLeg(token, it.id, 0);
    expect((await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/start`, { token })).status).toBe(200);
    const [now] = await env.deps.provider.listDepartures({ from: env.clock.t, to: env.clock.t + 3 * 24 * HOUR, origin: "KUL", destination: "SIN" });
    const single = await env.call("POST", "/v1/bookings", { token, body: { snapshotId: now!.id, mode: "depart_now", cabin: "economy" } });
    expect(single.status).toBe(409);
    expect(single.body.error.code).toBe("itinerary_conflict");

    // Once the itinerary is abandoned the reservation ends and the flight can be booked.
    expect((await env.call("POST", `/v1/itineraries/${it.id}/abandon`, { token })).body.itinerary.status).toBe("abandoned");
    const after = await env.call("POST", "/v1/bookings", { token, body: { snapshotId: now!.id, mode: "depart_now", cabin: "economy" } });
    expect(after.status).toBe(201);
  });

  it("a new itinerary may not overlap a booked single flight", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=SIN&destination=LHR&mode=community", "QR945>QR15");
    const [kulSin] = await env.deps.provider.listDepartures({ from: T0, to: T0 + 3 * 24 * HOUR, origin: "KUL", destination: "SIN" });
    const single = await env.call("POST", "/v1/bookings", {
      token,
      body: { snapshotId: kulSin!.id, mode: "custom", cabin: "economy", chosenDeparture: offer.legs[0].arrival.epochMs + 10 * MIN },
    });
    expect(single.status).toBe(201);
    const res = await env.call("POST", "/v1/itineraries", {
      token,
      body: { mode: "community", legs: offer.legs.map((l: any) => ({ snapshotId: l.snapshotId, cabin: "economy" })) },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("itinerary_conflict");
  });

  it("layover focus is refused during another flight and never credits time overlapping another session", async () => {
    const token = await setup();
    const userId = (await env.call("GET", "/v1/me", { token })).body.user.id as string;
    const offer = await searchOffer(token, "origin=SIN&destination=LHR&mode=community", "QR945>QR15");
    const it = await book(token, offer, ["economy", "economy"]);
    const { arrival: a } = await flyLeg(token, it.id, 0);
    // Another flight session overlapping the layover (inserted directly: booking it is refused).
    const [leg0] = await env.deps.db.select().from(bookings).where(eq(bookings.id, it.legs[0].bookingId));
    const [other] = await env.deps.db
      .insert(bookings)
      .values({ ...leg0!, id: undefined, itineraryId: null, legIndex: null, layoverFocusMs: null, status: "boarded" })
      .returning();
    const [session] = await env.deps.db
      .insert(flightSessions)
      .values({ bookingId: other!.id, userId, boardedAt: a + 3 * MIN, departure: a + 5 * MIN, arrival: a + 30 * MIN, focusStart: a + 5 * MIN })
      .returning();
    env.clock.t = a + 4 * MIN;
    for (const path of ["layover/focus/start", "layover/heartbeat"]) {
      const res = await env.call("POST", `/v1/itineraries/${it.id}/${path}`, { token });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("flight_in_progress");
    }
    // That flight ends (finalised) but its span [a+3, a+30) is never credited as layover focus.
    await env.deps.db
      .update(flightSessions)
      .set({ outcome: "ended_early", exitedAt: a + 30 * MIN, finalizedAt: a + 4 * MIN, creditedFocusMs: 0, breakMs: 0, creditedFlightMs: 0 })
      .where(eq(flightSessions.id, session!.id));
    env.clock.t = a + 5 * MIN;
    expect((await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/start`, { token })).status).toBe(200);
    for (let m = 9; m <= 45; m += 4) {
      env.clock.t = a + m * MIN;
      expect((await env.call("POST", `/v1/itineraries/${it.id}/layover/heartbeat`, { token })).status).toBe(200);
    }
    const stopped = (await env.call("POST", `/v1/itineraries/${it.id}/layover/focus/stop`, { token })).body;
    expect(stopped.layover.focus).toMatchObject({ focusMs: 40 * MIN, creditedMs: 15 * MIN });
    // Stored final credit matches once the next leg is boarded.
    env.clock.t = it.legs[1].boardingPass.departure.epochMs - 10 * MIN;
    expect((await board(token, it.legs[1].bookingId)).status).toBe(201);
    expect((await itinerary(token, it.id)).layovers[0].creditedFocusMs).toBe(15 * MIN);
  });

  it("an itinerary can be rebooked only once while that rebooking is live", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=MEL&destination=BNE&mode=individual", "QF430>QF520");
    const it = await book(token, offer, ["economy", "economy"]);
    await flyLeg(token, it.id, 0, { at: T0 });
    await env.call("POST", `/v1/itineraries/${it.id}/abandon`, { token });
    const offers = (await env.call("GET", `/v1/itineraries/${it.id}/rebook`, { token })).body.offers;
    const direct = offers.find((o: any) => o.direct);
    const first = await book(token, direct, ["economy"], { rebookedFromId: it.id });
    const again = await env.call("POST", "/v1/itineraries", {
      token,
      body: { mode: direct.mode, legs: direct.legs.map((l: any) => ({ snapshotId: l.snapshotId, cabin: "economy" })), rebookedFromId: it.id },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_rebooked");
    // Abandoning the rebooking frees it again.
    expect((await env.call("POST", `/v1/itineraries/${first.id}/abandon`, { token })).body.itinerary.status).toBe("abandoned");
    expect((await book(token, direct, ["economy"], { rebookedFromId: it.id })).rebookedFromId).toBe(it.id);
  });

  it("non-UUID ids are 404 not_found for itineraries, bookings and sessions", async () => {
    const token = await setup();
    for (const path of ["/v1/itineraries/not-a-uuid", "/v1/bookings/not-a-uuid", "/v1/sessions/not-a-uuid"]) {
      const res = await env.call("GET", path, { token });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
    expect((await env.call("POST", "/v1/bookings/123/board", { token })).status).toBe(404);
    expect((await env.call("POST", "/v1/sessions/123/validate", { token, body: {} })).status).toBe(404);
  });

  it("concurrent abandons both succeed once; abandoning a closed itinerary is refused", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=SIN&destination=LHR&mode=community", "QR945>QR15");
    const it = await book(token, offer, ["economy", "economy"]);
    const results = await Promise.all([1, 2].map(() => env.call("POST", `/v1/itineraries/${it.id}/abandon`, { token })));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.itinerary.status)).toEqual(["abandoned", "abandoned"]);
    expect(results[0]!.body.itinerary.abandonedAt).toBe(results[1]!.body.itinerary.abandonedAt);
    expect((await env.call("POST", `/v1/itineraries/${it.id}/abandon`, { token })).body.error.code).toBe("not_abandonable");
  });

  it("lists itineraries newest first with limit and a createdAt cursor", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=SIN&destination=LHR&mode=community", "QR945>QR15");
    const a = await book(token, offer, ["economy", "economy"]);
    await env.call("POST", `/v1/itineraries/${a.id}/abandon`, { token });
    env.clock.t += MIN;
    const b = await book(token, offer, ["economy", "economy"]);
    const page1 = (await env.call("GET", "/v1/itineraries?limit=1", { token })).body;
    expect(page1.itineraries.map((i: any) => i.id)).toEqual([b.id]);
    expect(page1.nextBefore).toBe(b.createdAt);
    const page2 = (await env.call("GET", `/v1/itineraries?limit=1&before=${page1.nextBefore}`, { token })).body;
    expect(page2.itineraries.map((i: any) => i.id)).toEqual([a.id]);
    const all = (await env.call("GET", "/v1/itineraries", { token })).body;
    expect(all.itineraries.map((i: any) => i.id)).toEqual([b.id, a.id]);
    expect(all.nextBefore).toBeNull();
    expect((await env.call("GET", "/v1/itineraries?limit=101", { token })).status).toBe(400);
  });

  it("concurrent finalisations into the same country get distinct visit numbers", async () => {
    const token = await setup();
    const userId = (await env.call("GET", "/v1/me", { token })).body.user.id as string;
    const [melSyd] = await env.deps.provider.listDepartures({ from: T0, to: T0 + 24 * HOUR, origin: "MEL", destination: "SYD" });
    const booked = await env.call("POST", "/v1/bookings", { token, body: { snapshotId: melSyd!.id, mode: "depart_now", cabin: "economy" } });
    const boarded = await board(token, booked.body.boardingPass.bookingId);
    const sessionId = boarded.body.sessionId as string;
    const [row] = await env.deps.db.select().from(flightSessions).where(eq(flightSessions.id, sessionId));
    const [b1] = await env.deps.db.select().from(bookings).where(eq(bookings.id, row!.bookingId));
    // A second landed session to the same country (inserted directly; normally flights are sequential).
    const [b2] = await env.deps.db.insert(bookings).values({ ...b1!, id: undefined }).returning();
    const [s2] = await env.deps.db
      .insert(flightSessions)
      .values({ bookingId: b2!.id, userId, boardedAt: row!.boardedAt, departure: row!.departure, arrival: row!.arrival, focusStart: row!.focusStart })
      .returning();
    const validatedAt = row!.arrival + MIN;
    await env.deps.db.update(flightSessions).set({ validatedAt }).where(inArray(flightSessions.id, [sessionId, s2!.id]));
    const now = validatedAt + MIN;
    const loaded = await Promise.all([sessionId, s2!.id].map((id) => loadSession(env.deps, id, userId)));
    const done = await Promise.all(loaded.map((l) => finalizeIfDone(env.deps, l, "Asia/Singapore", now)));
    expect(done).toEqual([true, true]);
    // Idempotent: a second finalisation awards nothing.
    expect(await finalizeIfDone(env.deps, loaded[0]!, "Asia/Singapore", now)).toBe(false);
    const marks = await env.deps.db.select().from(travelMarks).where(eq(travelMarks.userId, userId));
    expect(marks.map((m) => m.visitNumber).sort()).toEqual([1, 2]);
  });

  it("cancels a re-timed individual leg that would overlap another booking (itinerary becomes incomplete)", async () => {
    const token = await setup();
    const offer = await searchOffer(token, "origin=MEL&destination=BNE&mode=individual", "QF430>QF520");
    const it = await book(token, offer, ["economy", "economy"]);
    const leg2 = it.legs[1].boardingPass;
    // A single flight right after the journey: fine as booked, but not once leg 2 moves 5 minutes later.
    const single = await env.call("POST", "/v1/bookings", {
      token,
      body: { snapshotId: offer.legs[1].snapshotId, mode: "custom", cabin: "economy", chosenDeparture: leg2.arrival.epochMs + MIN },
    });
    expect(single.status).toBe(201);
    await flyLeg(token, it.id, 0, { at: T0 + 5 * MIN });
    const view = await itinerary(token, it.id);
    expect(view.status).toBe("incomplete");
    expect(view.legs[1].boardingPass.status).toBe("cancelled");
    expect(view.legs[1].boardingPass.departure.epochMs).toBe(leg2.departure.epochMs); // not silently moved
    expect((await env.call("GET", `/v1/bookings/${single.body.boardingPass.bookingId}`, { token })).body.boardingPass.status).toBe("booked");
  });

  it("individual itineraries with a chosen departure fly that date's services (FR-003)", async () => {
    const token = await setup();
    const start = T0 + 2 * DAY + 2 * HOUR;
    const offer = await searchOffer(
      token,
      `origin=MEL&destination=BNE&mode=individual&studyStart=${start}&studyEnd=${start + 12 * HOUR}`,
      "QF430>QF520",
    );
    expect(offer.chosenDeparture).toBe(start);
    const it = await book(token, offer, ["economy", "economy"]);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(start);
    expect(it.legs[0].boardingPass.operatingDate).toBe(date);
    expect(it.legs[0].boardingPass.departure.epochMs).toBe(start);
    expect(it.legs[1].boardingPass.departure.epochMs - it.legs[0].boardingPass.arrival.epochMs).toBe(75 * MIN);
  });
});
