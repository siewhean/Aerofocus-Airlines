import { HEARTBEAT_INTERVAL_MS, type AttendanceSignalKind } from "@aerofocus/core";

export interface AttendanceReporterOptions {
  send: (kind: AttendanceSignalKind) => void | Promise<void>;
  /**
   * "desktop": the browser keeps running in the background, so only periodic beats are sent.
   * "mobile": the OS pauses background apps, so background/resume are reported instead.
   * Sending background/resume on desktop would hide a sleeping laptop, so pick carefully.
   */
  platform: "desktop" | "mobile";
  /** True when the app was started from closed with a flight already open (cold start). */
  reopened?: boolean;
  intervalMs?: number;
  /** Injected for tests; defaults to the browser document. */
  document?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}

/**
 * Reports that the app is open while a flight is in progress (FR-013a). It never inspects screen
 * content, input or other apps (FR-031). Errors from send() are swallowed: the server tolerates
 * gaps up to 5 minutes.
 */
export class AttendanceReporter {
  private timer: ReturnType<typeof globalThis.setInterval> | null = null;
  private readonly onVisibility = (): void => {
    const doc = this.options.document;
    if (!doc || this.options.platform !== "mobile") return;
    this.emit(doc.visibilityState === "hidden" ? "background" : "resume");
  };

  constructor(private readonly options: AttendanceReporterOptions) {}

  start(): void {
    if (this.timer) return;
    this.emit(this.options.reopened ? "reopen" : "beat");
    const set = this.options.setInterval ?? globalThis.setInterval;
    this.timer = set(() => this.emit("beat"), this.options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
    (this.options.document ?? globalThis.document)?.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    if (this.timer) (this.options.clearInterval ?? globalThis.clearInterval)(this.timer);
    this.timer = null;
    (this.options.document ?? globalThis.document)?.removeEventListener("visibilitychange", this.onVisibility);
  }

  private emit(kind: AttendanceSignalKind): void {
    try {
      void Promise.resolve(this.options.send(kind)).catch(() => undefined);
    } catch {
      // ignore: a missed signal is tolerated
    }
  }
}
