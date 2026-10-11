import { afterEach, describe, expect, it } from "vitest";
import { invalidateCommunityCache } from "../src/context";
import { publicFlights } from "../src/routes/community";
import { createTestEnv, MIN, type TestEnv } from "./helpers";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
  env = undefined as unknown as TestEnv;
});

async function offerFor(token: string, query: string, flightNumber: string) {
  const res = await env.call("GET", `/v1/flights/search?${query}`, { token });
  const offer = res.body.offers.find((o: any) => o.flightNumber === flightNumber);
  if (!offer) throw new Error(`${flightNumber} not found`);
  return offer;
}

async function boardIndividual(token: string, query: string, flightNumber: string) {
  const offer = await offerFor(token, query, flightNumber);
  const pass = (await env.call("POST", "/v1/bookings", { token, body: { snapshotId: offer.snapshotId, mode: "depart_now", cabin: "economy" } })).body.boardingPass;
  const sessionId = (await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token })).body.sessionId as string;
  return { pass, sessionId };
}

describe("Phase 2: aircraft and seat maps", () => {
  it("serves representative seat maps and uses them for issued seats", async () => {
    env = await createTestEnv();
    const map = await env.call("GET", "/v1/aircraft/388/seatmap");
    expect(map.status).toBe(200);
    expect(map.body.seatMap).toMatchObject({ id: "388", source: "representative" });
    expect((await env.call("GET", "/v1/aircraft/XXX/seatmap")).status).toBe(404);
    expect((await env.call("GET", "/v1/aircraft")).body.aircraft.length).toBeGreaterThanOrEqual(21);

    const token = await env.register();
    const { pass } = await boardIndividual(token, "mode=individual&origin=SIN&destination=BKK", "TR616");
    expect(pass.seat).toMatchObject({ layout: "representative", isWindow: true, wingView: true });
    // A320neo representative wing rows are 10–16.
    expect(pass.seat.row).toBeGreaterThanOrEqual(10);
    expect(pass.seat.row).toBeLessThanOrEqual(16);
  });
});

describe("Phase 2: route rendering, scenery and inspection", () => {
  it("returns GeoJSON, an accessible timeline, scenery and window lighting", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const { sessionId } = await boardIndividual(token, "mode=individual&origin=SIN&destination=BKK", "TR616");
    env.clock.t += 60 * MIN;

    const route = (await env.call("GET", `/v1/sessions/${sessionId}/route`, { token })).body;
    expect(route.geometry.type).toBe("FeatureCollection");
    const kinds = route.geometry.features.map((f: any) => f.properties.kind);
    expect(kinds).toEqual(expect.arrayContaining(["completed", "remaining", "aircraft", "origin", "destination", "phase"]));
    expect(route.timeline.length).toBeGreaterThan(8);
    expect(route.timeline[0].placeLabel).toBe("Near Singapore");
    expect(route.timeline[route.timeline.length - 1].placeLabel).toBe("Near Bangkok");
    expect(Array.isArray(route.daylightEvents)).toBe(true);

    const scenery = (await env.call("GET", `/v1/sessions/${sessionId}/scenery`, { token })).body;
    expect(scenery.scenery).toMatchObject({ altitudeBand: "cruise", simulated: true });
    expect(["ocean", "land", "coast"]).toContain(scenery.scenery.surface);
    expect(typeof scenery.window.sunOnWindowSide).toBe("boolean");
    expect(scenery.window.condition).toBe("day"); // ~09:00 in Singapore

    const point = (await env.call("GET", `/v1/sessions/${sessionId}/inspect?fraction=0.5`, { token })).body.point;
    expect(typeof point.placeLabel).toBe("string");
  });

  it("previews any flight with geometry, timeline, route facts and seat map", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const offer = await offerFor(token, "mode=community&origin=LAX&destination=SYD", "QF12");
    const plan = (await env.call("GET", `/v1/flights/${encodeURIComponent(offer.snapshotId)}/plan`, { token })).body;
    expect(plan.facts).toMatchObject({ crossedEquator: true, crossedAntimeridian: true });
    expect(plan.seatMap.id).toBe("789");
    const remaining = plan.geometry.features.find((f: any) => f.properties.kind === "remaining");
    expect(remaining.geometry.coordinates.length).toBe(2); // split at the antimeridian
  });
});

describe("Phase 2: community map", () => {
  it("clusters public flights by zoom and allows anonymous inspection", async () => {
    env = await createTestEnv();
    const a = await env.register();
    const b = await env.register();
    const fa = await boardIndividual(a, "mode=individual&origin=SIN&destination=BKK", "TR616");
    const fb = await boardIndividual(b, "mode=individual&origin=SIN&destination=KUL", "TR450");
    env.clock.t += 20 * MIN;
    for (const [token, id] of [[a, fa.sessionId], [b, fb.sessionId]] as const) {
      await env.call("POST", `/v1/sessions/${id}/heartbeat`, { token, body: {} });
      await env.call("PATCH", `/v1/sessions/${id}/visibility`, { token, body: { isPublic: true } });
    }

    const world = (await env.call("GET", "/v1/community/flights?zoom=1")).body;
    expect(world.total).toBe(2);
    expect(world.items).toHaveLength(1);
    expect(world.items[0]).toMatchObject({ type: "cluster", count: 2 });

    const local = (await env.call("GET", "/v1/community/flights?zoom=16")).body;
    expect(local.items.every((i: any) => i.type === "flight")).toBe(true);

    const none = (await env.call("GET", "/v1/community/flights?zoom=3&bbox=-10,40,10,60")).body;
    expect(none.items).toHaveLength(0);

    const publicId = local.items[0].flight.id;
    const inspect = (await env.call("GET", `/v1/community/flights/public/${publicId}`)).body;
    expect(Object.keys(inspect.flight).sort()).toEqual(["blockMs", "departure", "destination", "id", "kind", "origin"]);
    expect(inspect.path.features.map((f: any) => f.properties.kind)).toEqual(expect.arrayContaining(["completed", "remaining", "aircraft"]));

    // Hiding takes effect immediately despite the cache (AC-16).
    await env.call("PATCH", `/v1/sessions/${fa.sessionId}/visibility`, { token: a, body: { isPublic: false } });
    expect((await env.call("GET", "/v1/community/flights")).body.flights).toHaveLength(1);
  });
});

describe("Phase 2: personal globe and achievements", () => {
  it("shows completed legs on the globe and categorised achievements", async () => {
    env = await createTestEnv();
    const token = await env.register();
    const { sessionId } = await boardIndividual(token, "mode=individual&origin=KUL&destination=PEN", "AK6012");
    const start = (await env.call("GET", `/v1/sessions/${sessionId}`, { token })).body.flight.departure.epochMs;
    for (let m = 1; m <= 55; m++) {
      env.clock.t = start + m * MIN;
      await env.call("POST", `/v1/sessions/${sessionId}/heartbeat`, { token, body: {} });
    }
    env.clock.t = start + 56 * MIN;
    expect((await env.call("POST", `/v1/sessions/${sessionId}/validate`, { token, body: {} })).body.focus.outcome).toBe("complete");

    const globe = (await env.call("GET", "/v1/me/globe", { token })).body;
    expect(globe.legCount).toBe(1);
    const leg = globe.features.find((f: any) => f.properties.kind === "leg");
    expect(leg.properties).toMatchObject({ flightNumber: "AK6012", origin: "KUL", destination: "PEN", destinationCountry: "MY" });
    expect(globe.features.filter((f: any) => f.properties.kind === "airport")).toHaveLength(2);
    expect((await env.call("GET", "/v1/me/globe?airline=SQ", { token })).body.legCount).toBe(0);

    const achievements = (await env.call("GET", "/v1/me/achievements", { token })).body.achievements;
    expect(achievements.find((a: any) => a.id === "first_flight")).toMatchObject({ category: "milestone" });
    expect(achievements.find((a: any) => a.id === "first_flight").earnedAt).not.toBeNull();
    expect(achievements.find((a: any) => a.id === "dateline_crosser").earnedAt).toBeNull();
  });
});

describe("community cache security", () => {
  it("guest presence with fresh ids cannot force a reload on every request", async () => {
    env = await createTestEnv();
    const a = await env.register();
    const offer = await offerFor(a, "mode=community&origin=SIN&destination=KUL", "TR450");
    const pass = (await env.call("POST", "/v1/bookings", { token: a, body: { snapshotId: offer.snapshotId, mode: "community", cabin: "economy" } })).body.boardingPass;
    env.clock.t = offer.departure.epochMs - 5 * MIN;
    const id = (await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token: a })).body.sessionId;
    env.clock.t = offer.departure.epochMs + 5 * MIN;
    await env.call("POST", `/v1/sessions/${id}/heartbeat`, { token: a, body: {} });
    expect((await env.call("GET", "/v1/community/flights")).body.flights[0].passengerCount).toBe(1);

    const key = (await env.call("GET", "/v1/community/flights")).body.flights[0].id;
    for (let i = 0; i < 20; i++) {
      await env.call("POST", "/v1/community/presence", { body: { communityKey: key, presenceId: crypto.randomUUID() } });
    }
    // Still served from cache within the TTL...
    expect((await env.call("GET", "/v1/community/flights")).body.flights[0].passengerCount).toBe(1);
    // ...and refreshed after it; one client gets at most 3 guest ids counted.
    env.clock.t += 3_000;
    expect((await env.call("GET", "/v1/community/flights")).body.flights[0].passengerCount).toBe(4);
  });

  it("a flight hidden while the map is loading never reappears from the cache (AC-16)", async () => {
    env = await createTestEnv();
    const stale = [{ id: "hidden", kind: "individual" as const, origin: { iata: "SIN", lat: 1, lon: 103 }, destination: { iata: "BKK", lat: 13, lon: 100 }, departure: 0, blockMs: 1 }];
    let release!: () => void;
    const slowLoad = () => new Promise<typeof stale>((resolve) => (release = () => resolve(stale)));
    const pending = publicFlights(env.deps, env.clock.now(), slowLoad);
    // The user hides their flight while the load is still running.
    invalidateCommunityCache(env.deps);
    release();
    expect(await pending).toEqual(stale); // that one response may be stale…
    expect(env.deps.communityCache).toBeNull(); // …but it is never cached for others
  });
});

describe("guest presence limits", () => {
  async function flyingCommunityKey() {
    const a = await env.register();
    const offer = await offerFor(a, "mode=community&origin=SIN&destination=KUL", "TR450");
    const pass = (await env.call("POST", "/v1/bookings", { token: a, body: { snapshotId: offer.snapshotId, mode: "community", cabin: "economy" } })).body.boardingPass;
    env.clock.t = offer.departure.epochMs - 5 * MIN;
    const id = (await env.call("POST", `/v1/bookings/${pass.bookingId}/board`, { token: a })).body.sessionId;
    env.clock.t = offer.departure.epochMs + 5 * MIN;
    await env.call("POST", `/v1/sessions/${id}/heartbeat`, { token: a, body: {} });
    return (await env.call("GET", "/v1/community/flights")).body.flights[0].id as string;
  }

  it("one client can have only 3 ids counted per flight and is never rejected", async () => {
    env = await createTestEnv();
    const key = await flyingCommunityKey();
    const ids = Array.from({ length: 50 }, () => crypto.randomUUID());
    const results = [];
    for (const presenceId of ids) results.push(await env.call("POST", "/v1/community/presence", { body: { communityKey: key, presenceId } }));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.map((r) => r.body.counted)).toEqual([true, true, true, ...Array(47).fill(false)]);
    expect(results.at(-1)!.body.passengerCount).toBe(3);

    // Ids already counted keep refreshing normally.
    const again = await env.call("POST", "/v1/community/presence", { body: { communityKey: key, presenceId: ids[0] } });
    expect(again.body).toEqual({ passengerCount: 3, counted: true });
  });

  it("expired ids free the client's slots", async () => {
    env = await createTestEnv();
    const key = await flyingCommunityKey();
    for (let i = 0; i < 5; i++) await env.call("POST", "/v1/community/presence", { body: { communityKey: key, presenceId: crypto.randomUUID() } });
    const blocked = await env.call("POST", "/v1/community/presence", { body: { communityKey: key, presenceId: crypto.randomUUID() } });
    expect(blocked.body).toEqual({ passengerCount: 3, counted: false });

    env.clock.t += 5 * MIN + 1_000; // past the unattended threshold without a ping
    const fresh = await env.call("POST", "/v1/community/presence", { body: { communityKey: key, presenceId: crypto.randomUUID() } });
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({ passengerCount: 1, counted: true });
  });
});
