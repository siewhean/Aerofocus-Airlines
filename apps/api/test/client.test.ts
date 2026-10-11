import { ApiClient, ApiRequestError, AttendanceReporter, GuestStore, ServerClock, type StorageLike } from "@aerofocus/client";
import { seededRng } from "@aerofocus/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createTestEnv, HOUR, MIN, T0, type TestEnv } from "./helpers";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
  env = undefined as unknown as TestEnv;
});

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function clientFor(e: TestEnv): ApiClient {
  const app = createApp(e.deps);
  return new ApiClient({ baseUrl: "http://api.test", fetch: ((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input).replace("http://api.test", ""), init)) as typeof fetch });
}

describe("@aerofocus/client", () => {
  it("guest flies on the device, then imports history into a new account (AC-21)", async () => {
    env = await createTestEnv();
    const api = clientFor(env);
    const storage = memoryStorage();
    const guest = new GuestStore(storage, () => env.clock.now(), seededRng(5), () => "6f1c1a52-6d2c-4a0e-9a59-2f1f7a1b2c3d");

    const { offers } = await api.search({ mode: "individual", origin: "KUL", destination: "PEN", timeZone: "Asia/Kuala_Lumpur" });
    const offer = offers.find((o) => o.flightNumber === "AK6012")!;
    const { snapshot } = await api.flightPlan(offer.snapshotId);

    const booked = guest.book({ snapshot, mode: "depart_now", cabin: "economy", timeZone: "Asia/Kuala_Lumpur", airlineTier: offer.airline.tier });
    expect(booked.ok).toBe(true);
    expect(guest.board().ok).toBe(true);
    const departure = guest.load().session!.departure;
    for (let m = 1; m <= 55; m++) {
      env.clock.t = departure + m * MIN;
      guest.act({ type: "signal", kind: "beat" });
    }
    env.clock.t = departure + 56 * MIN;
    expect(guest.view()?.prompt).toBe("validate");
    expect(guest.act({ type: "validate", goalCompleted: true }).ok).toBe(true);
    const history = guest.exportForImport();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ outcome: "complete", destinationCountry: "MY" });

    await api.register({ email: "guest@example.com", password: "correct horse", timeZone: "Asia/Kuala_Lumpur" });
    const result = await api.importGuest(history);
    expect(result.imported).toBe(1);
    expect((await api.passport()).marks).toHaveLength(1);
    await expect(api.importGuest(history)).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("AC-34: guest data expires 2 weeks after the last flight", async () => {
    let now = T0;
    const storage = memoryStorage();
    const guest = new GuestStore(storage, () => now, seededRng(1), () => "id");
    guest.load();
    now = T0 + 14 * 24 * HOUR;
    expect(guest.load().createdAt).toBe(now);
  });

  it("server clock offset hides device clock changes (AC-30)", async () => {
    let device = T0 - 3 * HOUR; // device is 3 hours slow
    const clock = new ServerClock(async () => T0, () => device);
    await clock.sync();
    expect(clock.now()).toBe(T0);
    device += MIN;
    expect(clock.now()).toBe(T0 + MIN);
  });

  it("attendance reporter sends beats, and background/resume only on mobile", async () => {
    const sent: string[] = [];
    let tick: (() => void) | null = null;
    const listeners: Record<string, () => void> = {};
    const doc = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (type: string, fn: () => void) => void (listeners[type] = fn),
      removeEventListener: vi.fn(),
    };
    const reporter = new AttendanceReporter({
      platform: "mobile",
      send: (k) => void sent.push(k),
      document: doc as never,
      setInterval: ((fn: () => void) => ((tick = fn), 1)) as never,
      clearInterval: (() => undefined) as never,
    });
    reporter.start();
    tick!();
    doc.visibilityState = "hidden";
    listeners.visibilitychange!();
    doc.visibilityState = "visible";
    listeners.visibilitychange!();
    reporter.stop();
    expect(sent).toEqual(["beat", "beat", "background", "resume"]);
  });
});
