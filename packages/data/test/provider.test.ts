import { blockDurationMs, DAY, HOUR, MINUTE } from "@aerofocus/core";
import { describe, expect, it } from "vitest";
import { AIRCRAFT_BY_CODE, AIRLINES_BY_IATA, AIRPORTS_BY_IATA, buildAirlineTierTable, SAMPLE_PATTERNS, SampleScheduleProvider } from "../src";

const provider = new SampleScheduleProvider();
const from = Date.UTC(2026, 9, 12, 0, 0);

describe("sample schedule provider", () => {
  it("every pattern references known airports, airlines and aircraft", () => {
    for (const p of SAMPLE_PATTERNS) {
      expect(AIRPORTS_BY_IATA.has(p.origin), p.origin).toBe(true);
      expect(AIRPORTS_BY_IATA.has(p.destination), p.destination).toBe(true);
      expect(AIRLINES_BY_IATA.has(p.airline), p.airline).toBe(true);
      if (p.aircraft) expect(AIRCRAFT_BY_CODE.has(p.aircraft), p.aircraft).toBe(true);
    }
  });

  it("generates departures in range, marked as sample data", async () => {
    const list = await provider.listDepartures({ from, to: from + DAY });
    expect(list.length).toBeGreaterThan(20);
    for (const s of list) {
      expect(s.departure).toBeGreaterThanOrEqual(from);
      expect(s.departure).toBeLessThan(from + DAY);
      expect(s.sourceStatus).toBe("sample");
    }
  });

  it("keeps block duration stable across a daylight-saving change", async () => {
    const before = await provider.serviceOccurrences("BA", "117", "2026-10-24", "2026-10-24");
    const after = await provider.serviceOccurrences("BA", "117", "2026-10-26", "2026-10-26");
    expect(blockDurationMs(before[0]!)).toBe(485 * MINUTE);
    expect(blockDurationMs(after[0]!)).toBe(485 * MINUTE);
    // Departure is 08:20 local: BST before the change, GMT after.
    expect(new Date(before[0]!.departure).getUTCHours()).toBe(7);
    expect(new Date(after[0]!.departure).getUTCHours()).toBe(8);
  });

  it("respects operating days and round-trips snapshot ids", async () => {
    const occ = await provider.serviceOccurrences("TR", "12", "2026-10-12", "2026-10-18");
    expect(occ.map((o) => o.operatingDate)).toEqual(["2026-10-12", "2026-10-14", "2026-10-16"]);
    expect(await provider.getSnapshot(occ[0]!.id)).toEqual(occ[0]);
    expect(await provider.getSnapshot("sample:XX1:2026-10-12:other")).toBeNull();
  });
});

describe("airline tier table", () => {
  it("covers every region and duration range with starter airlines, and every class unlock is bookable", async () => {
    const week = await provider.listDepartures({ from, to: from + 7 * DAY });
    const table = buildAirlineTierTable(week);
    expect(table.uncovered).toEqual([]);
    expect(table.warnings).toEqual([]);
    for (const iata of ["TR", "AK", "FR", "U2"]) expect(table.tiers.get(iata)).toBe(0);
    // Long-haul from Europe has no budget operator in the sample, so a full-service airline is promoted.
    expect(table.promotedToStarter.length).toBeGreaterThan(0);
    expect(week.every((s) => blockDurationMs(s) < 24 * HOUR)).toBe(true);
  });
});
