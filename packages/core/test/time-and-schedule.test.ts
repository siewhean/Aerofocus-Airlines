import { describe, expect, it } from "vitest";
import {
  blockDurationMs,
  durationBucketFor,
  HOUR,
  localDate,
  MINUTE,
  resolveOperatingSnapshot,
  toZonedIsoString,
  zonedToInstant,
} from "../src";
import { snapshot } from "./fixtures";

describe("time zones", () => {
  it("converts local wall-clock time to UTC", () => {
    expect(zonedToInstant("2026-10-12", "23:55", "Asia/Singapore")).toBe(Date.UTC(2026, 9, 12, 15, 55));
  });

  it("handles daylight saving: London is UTC+1 before and UTC+0 after 25 Oct 2026", () => {
    expect(zonedToInstant("2026-10-24", "12:00", "Europe/London")).toBe(Date.UTC(2026, 9, 24, 11, 0));
    expect(zonedToInstant("2026-10-26", "12:00", "Europe/London")).toBe(Date.UTC(2026, 9, 26, 12, 0));
  });

  it("formats instants in the user's time zone with offset (FR-012)", () => {
    const t = Date.UTC(2026, 9, 12, 6, 5);
    expect(toZonedIsoString(t, "Asia/Singapore")).toBe("2026-10-12T14:05:00+08:00");
    expect(toZonedIsoString(t, "America/New_York")).toBe("2026-10-12T02:05:00-04:00");
    expect(localDate(Date.UTC(2026, 9, 12, 17, 0), "Asia/Singapore")).toBe("2026-10-13");
  });
});

describe("schedule durations", () => {
  it("AC-01: two airlines on the same route keep their own published durations", () => {
    const a = snapshot({ operatingAirline: "SQ", arrival: snapshot().departure + 845 * MINUTE });
    const b = snapshot({ operatingAirline: "BA", arrival: snapshot().departure + 860 * MINUTE });
    expect(blockDurationMs(a)).toBe(845 * MINUTE);
    expect(blockDurationMs(b)).toBe(860 * MINUTE);
  });

  it("rejects arrival before departure", () => {
    expect(() => blockDurationMs(snapshot({ arrival: snapshot().departure }))).toThrow();
  });

  it("resolves the exact operating date, else the nearest one", () => {
    const occ = ["2026-10-12", "2026-10-14", "2026-10-16"].map((d) => snapshot({ id: d, operatingDate: d }));
    expect(resolveOperatingSnapshot(occ, "2026-10-14")?.id).toBe("2026-10-14");
    expect(resolveOperatingSnapshot(occ, "2026-10-15")?.id).toBe("2026-10-14");
    expect(resolveOperatingSnapshot(occ, "2026-10-30")).toBeNull();
  });

  it("buckets durations", () => {
    expect(durationBucketFor(55 * MINUTE).id).toBe("under_1h");
    expect(durationBucketFor(HOUR).id).toBe("1h_to_2h");
    expect(durationBucketFor(14 * HOUR).id).toBe("over_8h");
  });
});
