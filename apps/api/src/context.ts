import type { PublicFlightDescriptor, TravelMarkDesign } from "@aerofocus/core";
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
  /**
   * Identify clients by the X-Forwarded-For entry appended by our own proxy instead of the socket
   * address. Enable only behind a reverse proxy that appends the real client address; otherwise
   * clients can spoof it.
   */
  trustProxy: boolean;
  /** Number of trusted proxies; the client is the entry this many positions from the right (≥ 1). */
  trustProxyHops: number;
  /** Source of randomness for seats and random flights; injectable for tests. */
  random: () => number;
  /**
   * Short-lived cache of public flights for the community map (FR-062). Cleared on any visibility
   * change, boarding or exit so hiding a flight takes effect immediately (AC-16).
   */
  communityCache: { at: number; flights: PublicFlightDescriptor[] } | null;
  /** Bumped on every invalidation so an in-flight load cannot write back stale data. */
  communityCacheGeneration: number;
}

/** Clears the community map cache, e.g. after a visibility change (AC-16). */
export function invalidateCommunityCache(deps: AppDeps): void {
  deps.communityCache = null;
  deps.communityCacheGeneration++;
}

export interface BuildDepsInput {
  db: Db;
  provider: ScheduleProvider;
  clock?: Clock;
  signingSecret?: string;
  corsOrigins?: string[];
  trustProxy?: boolean;
  trustProxyHops?: number;
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
    trustProxy: input.trustProxy ?? false,
    trustProxyHops: parseTrustedHops(input.trustProxyHops),
    random: input.random ?? Math.random,
    communityCache: null,
    communityCacheGeneration: 0,
  };
}

/** Validates the trusted proxy hop count: a positive integer, default 1. */
export function parseTrustedHops(value: number | string | undefined): number {
  if (value === undefined || value === "") return 1;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`TRUST_PROXY_HOPS must be an integer >= 1, got ${String(value)}`);
  return n;
}
