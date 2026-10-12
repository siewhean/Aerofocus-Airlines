/**
 * UI-owned preferences (FR-024 lighting, FR-037 audio, FR-038 announcements, FR-026 graphics).
 * Stored in `uiPreferences` on the server for signed-in users and in localStorage for guests.
 */
export interface UiPreferences {
  audio: {
    master: number;
    engine: number;
    ventilation: number;
    passengers: number;
    voice: number;
    music: number;
    notifications: number;
    effects: number;
    muted: boolean;
  };
  announcements: "full" | "essential" | "captions";
  lighting: {
    readingLight: boolean;
    cabinBrightness: number; // 0–1
    interfaceBrightness: number; // 0.5–1
    reducedEffects: boolean;
  };
  graphics: "auto" | "high" | "low";
  focusMode: "cabin" | "compact" | "minimal" | "ambient" | "map";
  skipBoardingIntro: boolean;
  showOtherFlights: boolean;
  /** Dark mode: follow the system, or force light / dark (owner rule 4). */
  appearance: "system" | "light" | "dark";
}

export const DEFAULT_PREFS: UiPreferences = {
  audio: { master: 0.6, engine: 0.5, ventilation: 0.4, passengers: 0.2, voice: 0.8, music: 0, notifications: 0.8, effects: 0.5, muted: true },
  announcements: "captions",
  lighting: { readingLight: false, cabinBrightness: 0.7, interfaceBrightness: 1, reducedEffects: false },
  graphics: "auto",
  focusMode: "cabin",
  skipBoardingIntro: false,
  showOtherFlights: true,
  appearance: "system",
};

const KEY = "aerofocus.prefs.v1";

export function loadLocalPrefs(): UiPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return mergePrefs(JSON.parse(raw) as Partial<UiPreferences>);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveLocalPrefs(prefs: UiPreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function mergePrefs(partial: Partial<UiPreferences> | Record<string, unknown> | null | undefined): UiPreferences {
  const p = (partial ?? {}) as Partial<UiPreferences>;
  return {
    ...DEFAULT_PREFS,
    ...p,
    audio: { ...DEFAULT_PREFS.audio, ...(p.audio ?? {}) },
    lighting: { ...DEFAULT_PREFS.lighting, ...(p.lighting ?? {}) },
  };
}
