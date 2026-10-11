import type { TravelMarkDesign } from "@aerofocus/core";
import { buildAirlineTierTable, ONE_WEEK_MS, TRAVEL_MARK_DESIGNS, type AirlineTierTable, type ScheduleProvider } from "@aerofocus/data";
import { randomBytes } from "node:crypto";
import type { Db } from "./db/client";
import { GuestPresence } from "./presence";

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface AppDeps {
  db: Db;
  provider: ScheduleProvider;
  clock: Clock;
  /** Airline unlock tiers (FR-065) built from the catalogue. */
  tierTable: AirlineTierTable;
  designs: readonly TravelMarkDesign[];
  /** Signs Random Flight draws so they can bypass unlocks only when genuinely drawn. */
  signingSecret: Buffer;
  presence: GuestPresence;
  /** Allowed browser origins for CORS. */
  corsOrigins: string[];
  /** Source of randomness for seats and random flights; injectable for tests. */
  random: () => number;
}

export interface BuildDepsInput {
  db: Db;
  provider: ScheduleProvider;
  clock?: Clock;
  signingSecret?: string;
  corsOrigins?: string[];
  random?: () => number;
}

export async function buildDeps(input: BuildDepsInput): Promise<AppDeps> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const week = await input.provider.listDepartures({ from: now, to: now + ONE_WEEK_MS });
  const tierTable = buildAirlineTierTable(week);
  return {
    db: input.db,
    provider: input.provider,
    clock,
    tierTable,
    designs: TRAVEL_MARK_DESIGNS,
    signingSecret: input.signingSecret ? Buffer.from(input.signingSecret) : randomBytes(32),
    presence: new GuestPresence(clock),
    corsOrigins: input.corsOrigins ?? ["*"],
    random: input.random ?? Math.random,
  };
}
