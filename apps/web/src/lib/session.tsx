/**
 * Session provider: who is flying (guest or signed-in user), the API client, the server clock,
 * rules, settings and UI preferences. Guest mode uses GuestStore (packages/client/src/guest.ts:69-74)
 * with `now` wired to the server clock (docs/API.md "Guest mode").
 */
import { GuestStore, type GuestState } from "@aerofocus/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiRequestError, clock, storeToken } from "./api";
import { apiExt, type RulesResponse, type SettingsView, type UserView } from "./api-ext";
import { browserTimeZone } from "./format";
import { DEFAULT_PREFS, loadLocalPrefs, mergePrefs, saveLocalPrefs, type UiPreferences } from "./prefs";
import { setInterfaceBrightness } from "./theme";

export interface SessionContextValue {
  ready: boolean;
  mode: "guest" | "user";
  user: UserView | null;
  settings: SettingsView | null;
  /** The user's own time zone (FR-012): profile setting, else the device. */
  timeZone: string;
  homeAirport: string | null;
  rules: RulesResponse | null;
  guest: GuestStore;
  guestState: GuestState | null;
  prefs: UiPreferences;
  updatePrefs: (patch: Partial<UiPreferences>) => void;
  updateSettings: (patch: Partial<SettingsView>) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string | null) => Promise<{ imported: number; rejected: number }>;
  signOut: () => Promise<void>;
  refreshGuest: () => void;
  refreshUser: () => Promise<void>;
  now: () => number;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function createGuestStore(): GuestStore {
  const memory = new Map<string, string>();
  const storage = (() => {
    try {
      localStorage.getItem("probe");
      return localStorage;
    } catch {
      return { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
    }
  })();
  return new GuestStore(storage, () => clock.now());
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const guest = useMemo(createGuestStore, []);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserView | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [guestState, setGuestState] = useState<GuestState | null>(null);
  const [prefs, setPrefs] = useState<UiPreferences>(DEFAULT_PREFS);
  const prefsSource = useRef<"local" | "server">("local");

  const refreshGuest = useCallback(() => {
    setGuestState(guest.load());
  }, [guest]);

  const refreshUser = useCallback(async () => {
    if (!api.token) {
      setUser(null);
      setSettings(null);
      return;
    }
    try {
      const me = await apiExt.me();
      setUser(me.user);
      setSettings(me.settings);
      prefsSource.current = "server";
      setPrefs(mergePrefs(me.settings.uiPreferences));
    } catch (e) {
      // Only a rejected token signs the user out; offline or 5xx keeps the session (review finding 2).
      if (e instanceof ApiRequestError && e.status === 401) {
        api.token = null;
        storeToken(null);
        setUser(null);
        setSettings(null);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await clock.sync();
      } catch {
        /* offline: device clock is used until the next sync */
      }
      setPrefs(loadLocalPrefs());
      try {
        setRules(await apiExt.rules());
      } catch {
        /* rules unavailable; pages show a connection notice */
      }
      await refreshUser();
      if (!cancelled) {
        setGuestState(guest.load());
        setReady(true);
      }
    })();
    const resync = setInterval(() => clock.sync().catch(() => undefined), 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(resync);
    };
  }, [guest, refreshUser]);

  useEffect(() => {
    setInterfaceBrightness(prefs.lighting.interfaceBrightness);
  }, [prefs.lighting.interfaceBrightness]);

  const updatePrefs = useCallback(
    (patch: Partial<UiPreferences>) => {
      setPrefs((prev) => {
        const next = mergePrefs({ ...prev, ...patch, audio: { ...prev.audio, ...(patch.audio ?? {}) }, lighting: { ...prev.lighting, ...(patch.lighting ?? {}) } });
        saveLocalPrefs(next);
        if (prefsSource.current === "server" && api.token) {
          apiExt.updateSettings({ uiPreferences: next as unknown as Record<string, unknown> }).catch(() => undefined);
        }
        return next;
      });
    },
    [],
  );

  const updateSettings = useCallback(async (patch: Partial<SettingsView>) => {
    const res = await apiExt.updateSettings(patch);
    setSettings(res.settings);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await api.login({ email, password });
      storeToken(api.token);
      await refreshUser();
    },
    [refreshUser],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string | null) => {
      await api.register({ email, password, displayName, timeZone: browserTimeZone() });
      storeToken(api.token);
      // Guest conversion (FR-071, AC-21): import, then clear the device copy.
      let imported = 0;
      let rejected = 0;
      const records = guest.exportForImport();
      if (records.length > 0) {
        const res = await api.importGuest(records);
        imported = res.imported;
        rejected = res.rejected.length;
        guest.clear();
      }
      await refreshUser();
      setGuestState(guest.load());
      return { imported, rejected };
    },
    [guest, refreshUser],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* already invalid */
    }
    api.token = null;
    storeToken(null);
    prefsSource.current = "local";
    setUser(null);
    setSettings(null);
    setPrefs(loadLocalPrefs());
  }, []);

  const timeZone = settings?.timeZone ?? browserTimeZone();

  const value = useMemo<SessionContextValue>(
    () => ({
      ready,
      mode: user ? "user" : "guest",
      user,
      settings,
      timeZone,
      homeAirport: settings?.homeAirport ?? readLocal("aerofocus.homeAirport"),
      rules,
      guest,
      guestState,
      prefs,
      updatePrefs,
      updateSettings,
      signIn,
      register,
      signOut,
      refreshGuest,
      refreshUser,
      now: () => clock.now(),
    }),
    [ready, user, settings, timeZone, rules, guest, guestState, prefs, updatePrefs, updateSettings, signIn, register, signOut, refreshGuest, refreshUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
