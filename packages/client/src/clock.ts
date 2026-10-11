import type { Instant } from "@aerofocus/core";

/**
 * Keeps an offset between the device clock and server time, so flight progress does not move when
 * the device clock is wrong or changed (FR-012, AC-30). Call sync() on start and occasionally.
 */
export class ServerClock {
  private offsetMs = 0;

  constructor(
    private readonly fetchServerTime: () => Promise<Instant>,
    private readonly deviceNow: () => Instant = () => Date.now(),
  ) {}

  /** Estimates the offset using the request round-trip midpoint. */
  async sync(): Promise<number> {
    const sentAt = this.deviceNow();
    const serverNow = await this.fetchServerTime();
    const receivedAt = this.deviceNow();
    this.offsetMs = serverNow - (sentAt + (receivedAt - sentAt) / 2);
    return this.offsetMs;
  }

  now(): Instant {
    return this.deviceNow() + this.offsetMs;
  }

  get offset(): number {
    return this.offsetMs;
  }
}
