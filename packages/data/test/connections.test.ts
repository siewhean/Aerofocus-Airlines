import { DAY, HOUR, MAX_LAYOVER_MS, MINUTE, searchConnections, validateItinerary, type ScheduleSnapshot } from "@aerofocus/core";
import { describe, expect, it } from "vitest";
import { AIRPORTS_BY_IATA, SampleScheduleProvider } from "../src";

const provider = new SampleScheduleProvider();
const from = Date.UTC(2026, 9, 12, 0, 0);
const route = (legs: readonly ScheduleSnapshot[]): string => [legs[0]!.origin, ...legs.map((l) => l.destination)].join("-");

describe("sample connections (Phase 3)", async () => {
  const week = await provider.listDepartures({ from, to: from + 7 * DAY });
  const search = (origin: string, destination: string) =>
    searchConnections({ departures: week, origin, destination, airportsByIata: AIRPORTS_BY_IATA });

  it.each([
    ["SIN", "LHR", "SIN-DOH-LHR"],
    ["SIN", "LHR", "SIN-DXB-LHR"],
    ["KUL", "SYD", "KUL-SIN-SYD"],
    ["SIN", "JFK", "SIN-LHR-JFK"],
    ["MEL", "BNE", "MEL-SYD-BNE"],
  ])("finds %s→%s via %s with feasible 1.5–8 h layovers", (origin, destination, path) => {
    const options = search(origin, destination).filter((o) => route(o.legs) === path);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(validateItinerary(o.legs, AIRPORTS_BY_IATA)).toEqual([]);
    for (const o of options) expect(o.layovers[0]!.layoverMs).toBeGreaterThanOrEqual(o.layovers[0]!.minimumConnectionMs);
    const min = path === "MEL-SYD-BNE" ? 45 * MINUTE : 90 * MINUTE;
    expect(options.some((o) => o.layovers[0]!.layoverMs >= min && o.layovers[0]!.layoverMs <= 8 * HOUR)).toBe(true);
  });

  it("includes a short domestic connection using the domestic minimum", () => {
    const domestic = search("MEL", "BNE").find((o) => o.layovers[0]?.domestic);
    expect(domestic?.layovers[0]).toMatchObject({ airport: "SYD", minimumConnectionMs: 45 * MINUTE, layoverMs: 75 * MINUTE });
  });

  it("returns only chained, non-revisiting, in-range connections sorted by journey time", () => {
    const results = search("SIN", "LHR");
    expect(results.some((r) => r.direct)).toBe(true);
    for (let i = 1; i < results.length; i++) expect(results[i]!.totalMs).toBeGreaterThanOrEqual(results[i - 1]!.totalMs);
    for (const r of results) {
      expect(r.legs.length).toBeLessThanOrEqual(3);
      for (const l of r.layovers) expect(l.layoverMs).toBeLessThanOrEqual(MAX_LAYOVER_MS);
      const airports = route(r.legs).split("-");
      expect(new Set(airports).size).toBe(airports.length);
    }
  });
});
