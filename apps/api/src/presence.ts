import { UNATTENDED_THRESHOLD_MS } from "@aerofocus/core";
import type { Clock } from "./context";

/**
 * Anonymous, in-memory presence for guests aboard Community Flights (FR-069): they are counted
 * while aboard, and nothing about them is persisted. Entries expire after the unattended threshold.
 *
 * Single-process only. Running several API instances needs a shared store (e.g. Redis) instead.
 */
export class GuestPresence {
  private readonly entries = new Map<string, Map<string, number>>();

  /** maxPerFlight bounds memory: presence ids are client-generated and unauthenticated. */
  constructor(
    private readonly clock: Clock,
    private readonly maxPerFlight = 5_000,
  ) {}

  /** Records presence. Returns false when the flight is at capacity and this id is new. */
  touch(communityKey: string, presenceId: string): boolean {
    this.prune();
    let flight = this.entries.get(communityKey);
    if (!flight) {
      flight = new Map();
      this.entries.set(communityKey, flight);
    }
    if (!flight.has(presenceId) && flight.size >= this.maxPerFlight) return false;
    flight.set(presenceId, this.clock.now());
    return true;
  }

  leave(communityKey: string, presenceId: string): void {
    this.entries.get(communityKey)?.delete(presenceId);
  }

  count(communityKey: string): number {
    this.prune();
    return this.entries.get(communityKey)?.size ?? 0;
  }

  keys(): string[] {
    this.prune();
    return [...this.entries.keys()];
  }

  private prune(): void {
    const cutoff = this.clock.now() - UNATTENDED_THRESHOLD_MS;
    for (const [key, flight] of this.entries) {
      for (const [id, at] of flight) if (at < cutoff) flight.delete(id);
      if (flight.size === 0) this.entries.delete(key);
    }
  }
}
