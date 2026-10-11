/**
 * Local-frame flight state (docs/API.md "How the UI should drive a flight", step 1).
 * Computes `flightStateAt(plan, clock.now())` on an animation frame, throttled to once a second,
 * so the countdown never relies on timers alone (NFR-001) and never drifts from server time (AC-30).
 */
import { flightStateAt, type FlightPlan, type FlightState } from "@aerofocus/core";
import { useEffect, useState } from "react";
import { clock } from "./api";

export function useFlightClock(plan: FlightPlan | null, intervalMs = 1000): { state: FlightState | null; now: number } {
  const [snapshot, setSnapshot] = useState<{ state: FlightState | null; now: number }>(() => {
    const now = clock.now();
    return { state: plan ? flightStateAt(plan, now) : null, now };
  });

  useEffect(() => {
    if (!plan) {
      setSnapshot({ state: null, now: clock.now() });
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last >= intervalMs) {
        last = t;
        const now = clock.now();
        setSnapshot({ state: flightStateAt(plan, now), now });
      }
      raf = requestAnimationFrame(tick);
    };
    const now = clock.now();
    setSnapshot({ state: flightStateAt(plan, now), now });
    raf = requestAnimationFrame(tick);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const n = clock.now();
        setSnapshot({ state: flightStateAt(plan, n), now: n });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [plan, intervalMs]);

  return snapshot;
}
