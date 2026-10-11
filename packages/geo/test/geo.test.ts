import { AIRPORTS } from "@aerofocus/data";
import { describe, expect, it } from "vitest";
import { cloudCoverAt, countryAt, describePosition, sceneryAt, surfaceAt } from "../src";

describe("world geography (Natural Earth 1:50m)", () => {
  it("identifies countries and open water", () => {
    expect(countryAt({ lat: 3.14, lon: 101.69 })?.name).toBe("Malaysia");
    expect(countryAt({ lat: 48.86, lon: 2.35 })?.name).toBe("France");
    expect(countryAt({ lat: -20, lon: 80 })).toBeNull(); // Indian Ocean
    expect(countryAt({ lat: 40, lon: -40 })).toBeNull(); // North Atlantic
  });

  it("detects coastlines", () => {
    expect(surfaceAt({ lat: 13.08, lon: 80.29 }).surface).toBe("coast"); // Chennai waterfront
    expect(surfaceAt({ lat: 23, lon: 78 }).surface).toBe("land"); // central India
    expect(surfaceAt({ lat: -20, lon: 80 }).surface).toBe("ocean");
  });

  it("labels positions without inventing detail (FR-021)", () => {
    expect(describePosition({ lat: 1.36, lon: 103.99 }, AIRPORTS)).toBe("Near Singapore");
    expect(describePosition({ lat: 23, lon: 78 }, AIRPORTS)).toBe("Over India");
    expect(describePosition({ lat: -20, lon: 80 }, AIRPORTS)).toBe("Over the ocean");
  });
});

describe("scenery (FR-022)", () => {
  it("is deterministic and bounded", () => {
    const t = Date.UTC(2026, 9, 12, 6);
    const a = cloudCoverAt({ lat: 10, lon: 90 }, t, 7);
    expect(cloudCoverAt({ lat: 10, lon: 90 }, t, 7)).toEqual(a);
    expect(a.coverage).toBeGreaterThanOrEqual(0);
    expect(a.coverage).toBeLessThanOrEqual(1);
  });

  it("changes smoothly between nearby points", () => {
    const t = Date.UTC(2026, 9, 12, 6);
    const a = cloudCoverAt({ lat: 10, lon: 90 }, t).coverage;
    const b = cloudCoverAt({ lat: 10.05, lon: 90.05 }, t).coverage;
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });

  it("describes the view from the window", () => {
    const s = sceneryAt({ position: { lat: 23, lon: 78 }, instant: Date.UTC(2026, 9, 12, 6), phase: "cruise", altitudeFt: 36_000, airports: AIRPORTS });
    expect(s).toMatchObject({ surface: "land", country: "India", altitudeBand: "cruise", simulated: true, nearAirport: null });
    expect(s.daylight.condition).toBe("day");
  });
});
