import { UNATTENDED_THRESHOLD_MS } from "@aerofocus/core";
import type { Clock } from "./context";

/** Distinct presence ids one client (IP address) may have counted on one Community Flight. */
export const MAX_IDS_PER_CLIENT_PER_FLIGHT = 3;
/** Ids counted on one Community Flight. */
export const MAX_IDS_PER_FLIGHT = 5_000;
/** Ids tracked across all Community Flights; bounds memory. */
export const MAX_IDS_TOTAL = 100_000;

interface Entry {
  at: number;
  client: string;
}

/**
 * Anonymous, in-memory presence for guests aboard Community Flights (FR-069): they are counted
 * while aboard, and nothing about them is persisted. Entries expire after the unattended threshold.
 *
 * Presence ids are client-generated and unauthenticated, so each client may hold only a few ids
 * per flight; otherwise one client could fill a flight and inflate its public passenger count.
 *
 * Single-process only. Running several API instances needs a shared store (e.g. Redis) instead.
 */
export class GuestPresence {
  /** communityKey -> presenceId -> entry */
  private readonly entries = new Map<string, Map<string, Entry>>();
  /** communityKey -> client -> number of ids that client has counted on that flight */
  private readonly perClient = new Map<string, Map<string, number>>();
  private total = 0;

  constructor(
    private readonly clock: Clock,
    private readonly limits = {
      perClientPerFlight: MAX_IDS_PER_CLIENT_PER_FLIGHT,
      perFlight: MAX_IDS_PER_FLIGHT,
      total: MAX_IDS_TOTAL,
    },
  ) {}

  /**
   * Records presence for `client` (e.g. its IP address). Returns true when the id is counted.
   * An id already counted is refreshed. A new id is not counted (false) when the client's limit,
   * the flight's cap or the global cap is reached; this is never an error for the caller.
   */
  touch(communityKey: string, presenceId: string, client: string): boolean {
    this.prune();
    const now = this.clock.now();
    const existing = this.entries.get(communityKey)?.get(presenceId);
    if (existing) {
      existing.at = now;
      return true;
    }
    const flight = this.entries.get(communityKey);
    const clientCount = this.perClient.get(communityKey)?.get(client) ?? 0;
    if (
      clientCount >= this.limits.perClientPerFlight ||
      (flight?.size ?? 0) >= this.limits.perFlight ||
      this.total >= this.limits.total
    ) {
      return false;
    }
    let ids = flight;
    if (!ids) {
      ids = new Map();
      this.entries.set(communityKey, ids);
    }
    ids.set(presenceId, { at: now, client });
    let clients = this.perClient.get(communityKey);
    if (!clients) {
      clients = new Map();
      this.perClient.set(communityKey, clients);
    }
    clients.set(client, clientCount + 1);
    this.total++;
    return true;
  }

  leave(communityKey: string, presenceId: string): void {
    const flight = this.entries.get(communityKey);
    const entry = flight?.get(presenceId);
    if (!flight || !entry) return;
    this.remove(communityKey, flight, presenceId, entry);
  }

  count(communityKey: string): number {
    this.prune();
    return this.entries.get(communityKey)?.size ?? 0;
  }

  keys(): string[] {
    this.prune();
    return [...this.entries.keys()];
  }

  /** Expired ids also free their client's slots on that flight. */
  private prune(): void {
    const cutoff = this.clock.now() - UNATTENDED_THRESHOLD_MS;
    for (const [key, flight] of this.entries) {
      for (const [id, entry] of flight) if (entry.at < cutoff) this.remove(key, flight, id, entry);
    }
  }

  private remove(communityKey: string, flight: Map<string, Entry>, presenceId: string, entry: Entry): void {
    flight.delete(presenceId);
    this.total--;
    if (flight.size === 0) this.entries.delete(communityKey);
    const clients = this.perClient.get(communityKey);
    if (!clients) return;
    const left = (clients.get(entry.client) ?? 1) - 1;
    if (left > 0) clients.set(entry.client, left);
    else clients.delete(entry.client);
    if (clients.size === 0) this.perClient.delete(communityKey);
  }
}
