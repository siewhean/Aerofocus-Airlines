/**
 * Cabin announcements (FR-036, FR-038). Captions are always shown; a chime plays for "essential"
 * and "full"; speech only for "full". The hook announces on phase changes and on focus-state
 * changes, never on first render, so restoring a flight after a reload stays quiet.
 */
import type { FlightPhase } from "@aerofocus/core";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { speak, type CabinAudio } from "../lib/audio";
import type { UiPreferences } from "../lib/prefs";

export type FocusState = "focus" | "break" | "awaiting_return";

const PHASE_ANNOUNCEMENTS: Record<FlightPhase, string> = {
  taxi_out: "We're pushing back. Focus time starts now.",
  takeoff: "Cleared for takeoff.",
  climb: "Climbing to cruising altitude.",
  cruise: "We've reached cruising altitude. Settle in.",
  descent: "We're starting our descent.",
  approach: "Cabin crew, prepare for landing.",
  landing: "Touchdown.",
  taxi_in: "Welcome to {city}. Please validate your arrival within 10 minutes.",
};

const FOCUS_ANNOUNCEMENTS: Record<FocusState, string> = {
  focus: "Break's over. Focus resumes.",
  break: "Break time. Step away from the desk; the flight continues without you.",
  awaiting_return: "Break's over. Tell us when you're back.",
};

export interface AnnouncementOptions {
  /** False until the flight view has loaded; the first enabled render sets the baseline silently. */
  enabled: boolean;
  phase: FlightPhase | null;
  focusState: FocusState | null;
  destinationCity: string;
  mode: UiPreferences["announcements"];
  audio: RefObject<CabinAudio | null>;
  voiceVolume: number;
  chimeVolume: number;
  durationMs?: number;
}

export function useAnnouncements(options: AnnouncementOptions): string | null {
  const [caption, setCaption] = useState<string | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const prevPhase = useRef<FlightPhase | null | undefined>(undefined);
  const prevFocus = useRef<FocusState | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((text: string) => {
    const o = latest.current;
    setCaption(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCaption(null), o.durationMs ?? 8000);
    if (o.mode !== "captions") o.audio.current?.chime(o.chimeVolume);
    if (o.mode === "full") speak(text, o.voiceVolume);
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    if (prevPhase.current === undefined) {
      prevPhase.current = options.phase;
      return;
    }
    if (options.phase === prevPhase.current) return;
    prevPhase.current = options.phase;
    if (options.phase) announce(PHASE_ANNOUNCEMENTS[options.phase].replace("{city}", options.destinationCity));
  }, [options.enabled, options.phase, options.destinationCity, announce]);

  useEffect(() => {
    if (!options.enabled) return;
    if (prevFocus.current === undefined) {
      prevFocus.current = options.focusState;
      return;
    }
    if (options.focusState === prevFocus.current) return;
    prevFocus.current = options.focusState;
    if (options.focusState) announce(FOCUS_ANNOUNCEMENTS[options.focusState]);
  }, [options.enabled, options.focusState, announce]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* unsupported */
      }
    },
    [],
  );

  return caption;
}

/** Always mounted so the live region exists before the first caption arrives. Styles live in Flight.css. */
export function CaptionStrip({ caption }: { caption: string | null }) {
  return (
    <div className={`caption-strip ${caption ? "is-visible" : ""}`} role="status" aria-live="polite">
      {caption}
    </div>
  );
}
