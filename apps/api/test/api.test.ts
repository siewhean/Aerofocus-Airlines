import { SampleScheduleProvider, type ScheduleProvider } from "@aerofocus/data";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnv, HOUR, MIN, T0, type TestEnv } from "./helpers";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
  env = undefined as unknown as TestEnv;
});

/** Finds an offer for a flight number in search results. */
async function findOffer(token: string, query: string, flightNumber: string) {
  const res = await env.call("GET", `/v1/flights/search?${query}`, { token });
  expect(res.status).toBe(200);
  const offer = res.body.offers.find((o: any) => o.flightNumber === flightNumber);
  if (!offer) throw new Error(`${flightNumber} not in ${res.body.offers.map((o: any) => o.flightNumber).join(",")}`);
  return offer;
}

describe("accounts", () => {
  it("registers, logs in, reads and updates settings", async () => {
    env = await createTestEnv();
    const token = await env.register("ava@example.com");
    const me = await env.call("GET", "/v1/me", { token });
    expect(me.body.settings).toMatchObject({ timeZone: "Asia/Singapore", passportColour: "navy", shareFlightsByDefault: false });

    expect((await env.call("POST", "/v1/auth/register", { body: { email: "AVA@example.com", password: "another pass", timeZone: "UTC" } })).status).toBe(409);
    expect((await env.call("POST", "/v1/auth/login", { body: { email: "ava@example.com", password: "wrong pass" } })).status).toBe(401);
    const login = await env.call("POST", "/v1/auth/login", { body: { email: "ava@example.com", password: "correct horse" } });
    expect(login.status).toBe(200);

    const patched = await env.call("PATCH", "/v1/me/settings", {
      token,
      body: { homeAirport: "SIN", passportColour: "custom:#112233", displayName: "Ava T" },
    });
    expect(patched.body.settings).toMatchObject({ homeAirport: "SIN", passportColour: "custom:#112233" });
    expect((await env.call("PATCH", "/v1/me/settings", { token, body: { homeAirport: "XXX" } })).status).toBe(400);

    await env.call("POST", "/v1/auth/logout", { token });
    expect((await env.call("GET", "/v1/me", { token })).status).toBe(401);
  });
});

describe("search and booking", () => {
  it("AC-23: study-window search only returns flights that fit, and flags locked airlines (AC-27)", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const start = T0 + HOUR;
    const res = await env.call("GET", `/v1/flights/search?studyStart=${start}&studyEnd=${start + 2 * HOUR}&mode=individual`, { token });
    expect(res.status).toBe(200);
    expect(res.body.offers.length).toBeGreaterThan(0);
    for (const offer of res.body.offers) {
      expect(offer.blockMs).toBeLessThanOrEqual(2 * HOUR);
      expect(offer.departure.local).toMatch(/\+08:00$/);
      expect(offer.dataSource).toBe("sample");
    }
    expect(res.body.offers.some((o: any) => o.airline.locked)).toBe(true);
    expect(res.body.offers.some((o: any) => !o.airline.locked)).toBe(true);
  });

  it("refuses locked airlines and bookings beyond 7 days (AC-26, AC-27)", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const sq = await findOffer(token, "mode=individual&origin=SIN&destination=KUL", "SQ106");
    const locked = await env.call("POST", "/v1/bookings", { token, body: { snapshotId: sq.snapshotId, mode: "depart_now", cabin: "economy" } });
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe("airline_locked");

    const tr = await findOffer(token, "mode=individual&origin=SIN&destination=KUL", "TR450");
    const far = await env.call("POST", "/v1/bookings", {
      token,
      body: { snapshotId: tr.snapshotId, mode: "custom", cabin: "economy", chosenDeparture: T0 + 9 * 24 * HOUR },
    });
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe("outside_booking_window");
  });
});

describe("a complete individual flight", () => {
  it("books, boards, studies with breaks, lands, validates and earns a passport mark", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const offer = await findOffer(token, "mode=individual&origin=SIN&destination=BKK", "TR616");
    const booked = await env.call("POST", "/v1/bookings", {
      token,
      body: {
        snapshotId: offer.snapshotId, mode: "depart_now", cabin: "economy", studyGoal: "Revise chapter 4",
        breakSchedule: { mode: "auto", focusMinutes: 50, breakMinutes: 10, longBreakEvery: 0, longBreakMinutes: 30 },
      },
    });
    expect(booked.status).toBe(201);
    const pass = booked.body.boardingPass;
    expect(pass).toMatchObject({ flightType: "individual", cabin: "economy", studyGoal: "Revise chapter 4", passengerName: "Ava" });
    expect(pass.seat).toMatchObject({ isWindow: true, wingView: true });
    expect(pass.studyDurationMs).toBe(150 * MIN);

    const board = await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token });
    expect(board.status).toBe(201);
    const id = board.body.sessionId;

    // Heartbeat every minute for the whole flight.
    const s0 = (await env.call("GET", `/v1/sessions/${id}`, { token })).body;
    const departure = s0.flight.departure.epochMs as number;
    const arrival = s0.flight.arrival.epochMs as number;
    expect(arrival - departure).toBe(150 * MIN);
    for (let m = 1; departure + m * MIN < arrival; m++) {
      const t = departure + m * MIN;
      env.clock.t = t;
      if (m === 61) {
        const prompt = (await env.call("GET", `/v1/sessions/${id}`, { token })).body;
        expect(prompt.focus.prompt).toBe("confirm_back");
        await env.call("POST", `/v1/sessions/${id}/back`, { token });
      } else if (m === 122) {
        await env.call("POST", `/v1/sessions/${id}/back`, { token });
      } else {
        await env.call("POST", `/v1/sessions/${id}/heartbeat`, { token, body: { kind: "beat" } });
      }
    }

    // AC-10: a fresh read restores the flight from timestamps.
    env.clock.t = departure + 30 * MIN;
    const mid = (await env.call("GET", `/v1/sessions/${id}`, { token })).body;
    expect(mid.flight.remainingMs).toBe(120 * MIN);
    expect(mid.focus.state).toBe("focus");

    // AC-06: inspecting a future point does not change the countdown.
    const point = (await env.call("GET", `/v1/sessions/${id}/inspect?offsetMs=${100 * MIN}`, { token })).body.point;
    expect(point.localTime).toMatch(/\+08:00$/);
    expect((await env.call("GET", `/v1/sessions/${id}`, { token })).body.flight.remainingMs).toBe(120 * MIN);

    env.clock.t = arrival + 2 * MIN;
    const landed = (await env.call("GET", `/v1/sessions/${id}`, { token })).body;
    expect(landed.focus.prompt).toBe("validate");
    const validated = await env.call("POST", `/v1/sessions/${id}/validate`, { token, body: { goalCompleted: true } });
    expect(validated.status).toBe(200);
    expect(validated.body.focus.outcome).toBe("complete");
    // 150 min flight, two 10-minute breaks, each "I'm back" confirmed 1 minute after the break ended.
    expect(validated.body.focus.creditedFocusMs).toBe(150 * MIN - 20 * MIN - 2 * MIN);

    const passport = (await env.call("GET", "/v1/me/passport", { token })).body;
    expect(passport.marks).toHaveLength(1);
    expect(passport.marks[0]).toMatchObject({ country: "TH", airport: "BKK", flightNumber: "TR616", designId: "generic-arrival" });

    // NFR-007: validating again does not award twice.
    expect((await env.call("POST", `/v1/sessions/${id}/validate`, { token, body: {} })).status).toBe(409);
    expect((await env.call("GET", "/v1/me/passport", { token })).body.marks).toHaveLength(1);

    const progression = (await env.call("GET", "/v1/me/progression", { token })).body;
    expect(progression.stats.completedFlights).toBe(1);
    const history = (await env.call("GET", "/v1/me/history", { token })).body.flights;
    expect(history[0]).toMatchObject({ status: "complete", goalCompleted: true, flightNumber: "TR616" });
    const achievements = (await env.call("GET", "/v1/me/achievements", { token })).body.achievements;
    expect(achievements.find((a: any) => a.id === "first_flight").earnedAt).not.toBeNull();
  });

  it("AC-24: a flight not validated within 10 minutes is invalid with no focus or mark", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const offer = await findOffer(token, "mode=individual&origin=KUL&destination=PEN", "AK6012");
    const pass = (await env.call("POST", "/v1/bookings", { token, body: { snapshotId: offer.snapshotId, mode: "depart_now", cabin: "economy" } })).body.boardingPass;
    const id = (await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token })).body.sessionId;
    env.clock.t += 2 * HOUR;
    const s = (await env.call("GET", `/v1/sessions/${id}`, { token })).body;
    expect(s.focus.outcome).toBe("invalid");
    expect(s.focus.creditedFocusMs).toBe(0);
    expect((await env.call("POST", `/v1/sessions/${id}/validate`, { token, body: {} })).status).toBe(409);
    expect((await env.call("GET", "/v1/me/passport", { token })).body.marks).toHaveLength(0);
  });

  it("AC-11: leaving early keeps only focus completed before the last break", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const offer = await findOffer(token, "mode=individual&origin=SIN&destination=BKK", "TR616");
    const pass = (
      await env.call("POST", "/v1/bookings", {
        token,
        body: {
          snapshotId: offer.snapshotId, mode: "depart_now", cabin: "economy",
          breakSchedule: { mode: "manual", focusMinutes: 50, breakMinutes: 10, longBreakEvery: 0, longBreakMinutes: 30 },
        },
      })
    ).body.boardingPass;
    const id = (await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token })).body.sessionId;
    const start = (await env.call("GET", `/v1/sessions/${id}`, { token })).body.flight.departure.epochMs;
    const at = async (minute: number, path: string) => {
      env.clock.t = start + minute * MIN;
      return env.call("POST", `/v1/sessions/${id}/${path}`, { token, body: {} });
    };
    for (let m = 1; m <= 40; m++) await at(m, "heartbeat");
    await at(40, "break/start");
    await at(45, "break/end");
    for (let m = 46; m <= 70; m++) await at(m, "heartbeat");
    const exit = await at(70, "exit");
    expect(exit.body.focus.outcome).toBe("ended_early");
    expect(exit.body.focus.creditedFocusMs).toBe(40 * MIN);
    expect((await env.call("GET", "/v1/me/passport", { token })).body.marks).toHaveLength(0);
  });
});

describe("Community Flights", () => {
  it("shares one flight between passengers, shows only a passenger count, and allows late boarding until takeoff", async () => {
    env = await createTestEnv();
    const alice = await env.register();
    const bob = await env.register();
    const carol = await env.register();
    const offer = await findOffer(alice, "mode=community&origin=SIN&destination=KUL", "TR450");
    const departure = offer.departure.epochMs as number;

    const book = async (token: string) =>
      (await env.call("POST", "/v1/bookings", { token, body: { snapshotId: offer.snapshotId, mode: "community", cabin: "economy" } })).body.boardingPass;
    const [pa, pb, pc] = [await book(alice), await book(bob), await book(carol)];
    expect(pa.boardingOpensAt.epochMs).toBe(departure - 15 * MIN);

    env.clock.t = departure - 20 * MIN;
    expect((await env.call("POST", `/v1/bookings/${pa.bookingId}/board`, { token: alice })).body.error.code).toBe("too_early");

    env.clock.t = departure - 10 * MIN;
    const sa = (await env.call("POST", `/v1/bookings/${pa.bookingId}/board`, { token: alice })).body.sessionId;
    env.clock.t = departure + 10 * MIN; // late, before takeoff
    const sb = (await env.call("POST", `/v1/bookings/${pb.bookingId}/board`, { token: bob })).body.sessionId;
    env.clock.t = departure + 16 * MIN; // after takeoff
    const late = await env.call("POST", `/v1/bookings/${pc.bookingId}/board`, { token: carol });
    expect(late.body.error.code).toBe("no_show");

    await env.call("POST", `/v1/sessions/${sa}/heartbeat`, { token: alice, body: {} });
    await env.call("POST", `/v1/sessions/${sb}/heartbeat`, { token: bob, body: {} });
    const bobView = (await env.call("GET", `/v1/sessions/${sb}`, { token: bob })).body;
    expect(bobView.flight.departure.epochMs).toBe(departure);
    expect((await env.call("PATCH", `/v1/sessions/${sb}/visibility`, { token: bob, body: { isPublic: true } })).status).toBe(409);

    const map = (await env.call("GET", "/v1/community/flights")).body.flights;
    expect(map).toHaveLength(1);
    expect(map[0]).toMatchObject({ kind: "community", passengerCount: 2, origin: { iata: "SIN" }, destination: { iata: "KUL" } });
    expect(Object.keys(map[0]).sort()).toEqual(["blockMs", "departure", "destination", "id", "kind", "origin", "passengerCount"]);

    // A guest can join anonymously.
    const presence = await env.call("POST", "/v1/community/presence", {
      body: { communityKey: map[0].id, presenceId: "6f1c1a52-6d2c-4a0e-9a59-2f1f7a1b2c3d" },
    });
    expect(presence.status).toBe(200);
    expect((await env.call("GET", "/v1/community/flights")).body.flights[0].passengerCount).toBe(3);
  });
});

describe("individual flight sharing", () => {
  it("AC-16 / AC-18: private by default, public on request, hidden again immediately", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const offer = await findOffer(token, "mode=individual&origin=SIN&destination=BKK", "TR616");
    const pass = (await env.call("POST", "/v1/bookings", { token, body: { snapshotId: offer.snapshotId, mode: "depart_now", cabin: "economy" } })).body.boardingPass;
    const id = (await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token })).body.sessionId;
    env.clock.t += 5 * MIN;
    await env.call("POST", `/v1/sessions/${id}/heartbeat`, { token, body: {} });
    expect((await env.call("GET", "/v1/community/flights")).body.flights).toHaveLength(0);

    await env.call("PATCH", `/v1/sessions/${id}/visibility`, { token, body: { isPublic: true } });
    const shown = (await env.call("GET", "/v1/community/flights")).body.flights;
    expect(shown).toHaveLength(1);
    expect(shown[0].kind).toBe("individual");
    expect(shown[0].id).not.toBe(id);

    await env.call("PATCH", `/v1/sessions/${id}/visibility`, { token, body: { isPublic: false } });
    expect((await env.call("GET", "/v1/community/flights")).body.flights).toHaveLength(0);

    // Hidden while unattended, back when the user returns.
    await env.call("PATCH", `/v1/sessions/${id}/visibility`, { token, body: { isPublic: true } });
    env.clock.t += 20 * MIN;
    expect((await env.call("GET", "/v1/community/flights")).body.flights).toHaveLength(0);
    await env.call("POST", `/v1/sessions/${id}/heartbeat`, { token, body: {} });
    expect((await env.call("GET", "/v1/community/flights")).body.flights).toHaveLength(1);
  });
});

describe("Random Flight", () => {
  it("draws a fitting flight that may use locked airlines, and rejects tampered draws", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const draw = (await env.call("POST", "/v1/flights/random", { token, body: { studyMinutes: 90 } })).body;
    expect(draw.offer.blockMs).toBeLessThanOrEqual(90 * MIN);
    const booked = await env.call("POST", "/v1/bookings", {
      token,
      body: { snapshotId: draw.offer.snapshotId, mode: "depart_now", cabin: draw.cabin, drawToken: draw.drawToken },
    });
    expect(booked.status).toBe(201);
    expect(booked.body.boardingPass.isRandomDraw).toBe(true);

    const tampered = await env.call("POST", "/v1/bookings", {
      token,
      body: { snapshotId: draw.offer.snapshotId, mode: "depart_now", cabin: draw.cabin === "first" ? "economy" : "first", drawToken: draw.drawToken },
    });
    expect(tampered.status).toBe(400);
  });
});

describe("guest import (AC-21)", () => {
  it("imports valid device history and rejects tampered records", async () => {
    env = await createTestEnv();
    const provider = env.deps.provider;
    const [snapshot] = await provider.serviceOccurrences("TR", "450", "2026-10-10", "2026-10-10");
    const s = snapshot!;
    const token = await env.register();
    const record = {
      snapshotId: s.id, outcome: "complete", departure: s.departure, arrival: s.arrival, blockMs: s.arrival - s.departure,
      creditedFocusMs: 50 * MIN, breakMs: 10 * MIN, creditedFlightMs: s.arrival - s.departure, origin: "SIN", destination: "KUL",
      destinationCountry: "MY", airline: "TR", aircraftType: "32N", distanceKm: 300, validatedAt: s.arrival, studyGoal: null, goalCompleted: null,
    };
    const res = await env.call("POST", "/v1/me/import-guest", {
      token,
      body: { records: [record, { ...record, departure: record.departure + MIN }, { ...record, snapshotId: "sample:TR450:2030-01-01:x" }] },
    });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.rejected.map((r: any) => r.reason).sort()).toEqual(["duration_mismatch", "unknown_snapshot"]);
    expect((await env.call("GET", "/v1/me/passport", { token })).body.marks).toHaveLength(1);
    expect((await env.call("GET", "/v1/me/stats", { token })).body.stats.completedFlights).toBe(1);
  });
});

describe("resilience", () => {
  it("AC-22: a booked flight completes when the schedule provider is unavailable", async () => {
    const real = new SampleScheduleProvider();
    let down = false;
    const flaky: ScheduleProvider = {
      name: real.name,
      dataVersion: real.dataVersion,
      listDepartures: (q) => (down ? Promise.reject(new Error("down")) : real.listDepartures(q)),
      getSnapshot: (id) => (down ? Promise.reject(new Error("down")) : real.getSnapshot(id)),
      serviceOccurrences: (...a) => (down ? Promise.reject(new Error("down")) : real.serviceOccurrences(...a)),
    };
    env = await createTestEnv({ provider: flaky });
    const token = await env.register();
    const offer = await findOffer(token, "mode=individual&origin=KUL&destination=PEN", "AK6012");
    const pass = (await env.call("POST", "/v1/bookings", { token, body: { snapshotId: offer.snapshotId, mode: "depart_now", cabin: "economy" } })).body.boardingPass;
    const id = (await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token })).body.sessionId;
    down = true;
    env.clock.t += 30 * MIN;
    expect((await env.call("GET", `/v1/sessions/${id}`, { token })).status).toBe(200);
  });

  it("AC-30: progress follows server time, not the device clock", async () => {
    env = await createTestEnv();
    expect((await env.call("GET", "/v1/time")).body.now).toBe(T0);
  });
});
