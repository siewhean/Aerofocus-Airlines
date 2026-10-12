/**
 * Preferences written as prose (docs/UI-PLAN.md Phase 9, item 4): short sections, each a sentence
 * or two with its controls inline. Everything saves as it changes; server-backed settings confirm
 * with a toast, device preferences apply at once.
 */
import { DEFAULT_BREAK_SCHEDULE, type BreakSchedule } from "@aerofocus/core";
import type { AirportView } from "@aerofocus/client";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { BreakScheduleFields } from "../components/BreakScheduleFields";
import { api, errorMessage } from "../lib/api";
import type { SettingsView } from "../lib/api-ext";
import { browserTimeZone, formatDate } from "../lib/format";
import { notificationPermission, requestNotificationPermission } from "../lib/notify";
import type { UiPreferences } from "../lib/prefs";
import { useSession, writeLocal } from "../lib/session";
import { Button, Dialog, Field, Input, Select, Slider, Textarea, Toggle, useToast } from "../ui";
import "./Settings.css";

const COMMON_ZONES = [
  "UTC",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Istanbul",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

const APPEARANCE: { value: UiPreferences["appearance"]; label: string }[] = [
  { value: "system", label: "Follow the system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function AccountNote({ what }: { what: string }) {
  return (
    <p className="prefs-note small muted">
      {what} needs an account. <Link to="/account/sign-in">Create one</Link> to save it.
    </p>
  );
}

/** A section of the preferences page: a plain heading and prose. */
function Prefs({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="prefs" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="prefs-body">{children}</div>
    </section>
  );
}

export default function Settings() {
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const isUser = session.mode === "user";
  const settings = session.settings;
  const prefs = session.prefs;

  const [airports, setAirports] = useState<AirportView[] | null>(null);
  const [displayName, setDisplayName] = useState(settings?.displayName ?? "");
  const [breaks, setBreaks] = useState<BreakSchedule>(settings?.breakSchedule ?? session.rules?.defaultBreakSchedule ?? DEFAULT_BREAK_SCHEDULE);
  const [permission, setPermission] = useState(notificationPermission());
  const [exportOpen, setExportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setDisplayName(settings?.displayName ?? "");
  }, [settings?.displayName]);
  useEffect(() => {
    if (settings?.breakSchedule) setBreaks(settings.breakSchedule);
  }, [settings?.breakSchedule]);

  useEffect(() => {
    let cancelled = false;
    api
      .airports()
      .then((res) => {
        if (!cancelled) setAirports([...res.airports].sort((a, b) => a.city.localeCompare(b.city)));
      })
      .catch(() => {
        if (!cancelled) setAirports([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Saves a server-backed patch and confirms with a toast; errors are shown, never swallowed. */
  const save = useCallback(
    async (patch: Partial<SettingsView>) => {
      try {
        await session.updateSettings(patch);
        toast.show("Saved", "signal");
      } catch (e) {
        toast.show(errorMessage(e), "danger");
      }
    },
    [session, toast],
  );

  const setPrefs = (patch: Partial<UiPreferences>) => session.updatePrefs(patch);
  const setAudio = (patch: Partial<UiPreferences["audio"]>) => setPrefs({ audio: { ...prefs.audio, ...patch } });
  const setLighting = (patch: Partial<UiPreferences["lighting"]>) => setPrefs({ lighting: { ...prefs.lighting, ...patch } });

  const presets = useMemo<BreakSchedule[]>(() => {
    const base = session.rules?.defaultBreakSchedule ?? DEFAULT_BREAK_SCHEDULE;
    return [
      { ...base, focusMinutes: 50, breakMinutes: 10 },
      { ...base, focusMinutes: 25, breakMinutes: 5 },
      { ...base, focusMinutes: 90, breakMinutes: 15 },
    ];
  }, [session.rules?.defaultBreakSchedule]);

  const deviceZone = browserTimeZone();
  const zoneOptions = useMemo(() => {
    const set = new Set(COMMON_ZONES);
    if (settings?.timeZone) set.add(settings.timeZone);
    return [...set].sort();
  }, [settings?.timeZone]);

  const sameBreaks = (a: BreakSchedule, b: BreakSchedule) =>
    a.mode === b.mode && a.focusMinutes === b.focusMinutes && a.breakMinutes === b.breakMinutes && a.longBreakEvery === b.longBreakEvery && a.longBreakMinutes === b.longBreakMinutes;

  const onHomeAirport = async (iata: string) => {
    const value = iata || null;
    if (isUser) {
      await save({ homeAirport: value });
    } else {
      writeLocal("aerofocus.homeAirport", value);
      session.refreshGuest();
      toast.show("Saved", "signal");
    }
  };

  const allowNotifications = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
  };

  const signOut = async () => {
    setLeaving(true);
    try {
      await session.signOut();
      navigate("/");
    } finally {
      setLeaving(false);
    }
  };

  const clearGuest = () => {
    session.guest.clear();
    session.refreshGuest();
    setClearOpen(false);
    toast.show("Guest data cleared.", "neutral");
  };

  const guestJson = useMemo(() => (exportOpen ? JSON.stringify(session.guest.load(), null, 2) : ""), [exportOpen, session.guest]);

  const permissionCopy =
    permission === "unsupported" ? "This browser does not support notifications." : permission === "granted" ? "This browser allows notifications." : permission === "denied" ? "This browser blocks notifications; change that in its site settings." : "This browser has not been asked yet.";

  const nameId = useId();
  const zoneId = useId();
  const homeId = useId();
  const announceId = useId();
  const graphicsId = useId();
  const channelId = useId();
  const hasGuestData = Boolean(session.guestState && (session.guestState.history.length > 0 || session.guestState.booking || session.guestState.session));

  return (
    <Page title="Settings" lead="Your preferences, in a few sentences. Changes save as you make them.">
      <div className="prefs-page">
        <Prefs title="Passenger">
          {isUser ? (
            <>
              <p className="prefs-line">
                <label htmlFor={nameId}>The name on your boarding pass is</label>{" "}
                <Input
                  id={nameId}
                  type="text"
                  maxLength={60}
                  className="prefs-inline-input"
                  placeholder={session.user?.email ?? ""}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onBlur={() => {
                    const next = displayName.trim() || null;
                    if (next !== (settings?.displayName ?? null)) void save({ displayName: next });
                  }}
                />
                . Leave it blank to use your email.
              </p>
              <p className="prefs-line">
                <label htmlFor={zoneId}>Times are shown in</label>{" "}
                <Select
                  id={zoneId}
                  className="prefs-inline-select"
                  value={settings?.timeZone ?? deviceZone}
                  onChange={(e) => {
                    const v = e.target.value === "__device" ? deviceZone : e.target.value;
                    void save({ timeZone: v });
                  }}
                >
                  <option value="__device">my device zone ({deviceZone})</option>
                  {zoneOptions.map((z) => (
                    <option key={z} value={z}>
                      {z.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
                .
              </p>
            </>
          ) : (
            <>
              <p className="prefs-line">Times are shown in your device zone, {deviceZone}.</p>
              <AccountNote what="A display name or a different time zone" />
            </>
          )}
          <p className="prefs-line">
            <label htmlFor={homeId}>Searches start from</label>{" "}
            <Select id={homeId} className="prefs-inline-select" value={session.homeAirport ?? ""} onChange={(e) => void onHomeAirport(e.target.value)} disabled={airports === null}>
              <option value="">anywhere</option>
              {(airports ?? []).map((a) => (
                <option key={a.iata} value={a.iata}>
                  {a.city} ({a.iata})
                </option>
              ))}
            </Select>
            .
          </p>
          <p className="prefs-line">
            The cover colour of your passport is chosen on the <Link to="/collection/passport">passport page</Link>; changing it never alters earned stamps.
          </p>
        </Prefs>

        <Prefs title="Appearance">
          <p className="prefs-line">The ground pages can follow your device or stay light or dark. The cabin is always night-lit.</p>
          <div className="prefs-segmented" role="group" aria-label="Appearance">
            {APPEARANCE.map((o) => {
              const active = prefs.appearance === o.value;
              return (
                <button key={o.value} type="button" className={`prefs-segment ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => setPrefs({ appearance: o.value })}>
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="prefs-line">
            <label htmlFor={graphicsId}>Graphics quality is</label>{" "}
            <Select id={graphicsId} className="prefs-inline-select" value={prefs.graphics} onChange={(e) => setPrefs({ graphics: e.target.value as UiPreferences["graphics"] })}>
              <option value="auto">automatic</option>
              <option value="high">high</option>
              <option value="low">low</option>
            </Select>
            . Automatic follows your device and battery.
          </p>
        </Prefs>

        <Prefs title="Sound">
          <p className="prefs-line">The cabin has an engine bed, ventilation, other passengers, announcements and chimes. Each has its own level.</p>
          <div className="prefs-toggles">
            <Toggle label="Mute all sound" checked={prefs.audio.muted} onChange={(v) => setAudio({ muted: v })} />
          </div>
          <div className={`prefs-sliders ${prefs.audio.muted ? "is-muted" : ""}`}>
            <Slider label="Master" value={prefs.audio.master} onChange={(v) => setAudio({ master: v })} format={pct} />
            <Slider label="Engine" value={prefs.audio.engine} onChange={(v) => setAudio({ engine: v })} format={pct} />
            <Slider label="Ventilation" value={prefs.audio.ventilation} onChange={(v) => setAudio({ ventilation: v })} format={pct} />
            <Slider label="Passengers" value={prefs.audio.passengers} onChange={(v) => setAudio({ passengers: v })} format={pct} />
            <Slider label="Voice" value={prefs.audio.voice} onChange={(v) => setAudio({ voice: v })} format={pct} />
            <Slider label="Music" value={prefs.audio.music} onChange={(v) => setAudio({ music: v })} format={pct} />
            <Slider label="Notifications" value={prefs.audio.notifications} onChange={(v) => setAudio({ notifications: v })} format={pct} />
            <Slider label="Effects" value={prefs.audio.effects} onChange={(v) => setAudio({ effects: v })} format={pct} />
          </div>
        </Prefs>

        <Prefs title="Lighting">
          <p className="prefs-line">The reading light above your seat can stay on, and the cabin and interface each have their own brightness.</p>
          <div className="prefs-toggles">
            <Toggle label="Reading light" checked={prefs.lighting.readingLight} onChange={(v) => setLighting({ readingLight: v })} />
            <Toggle label="Reduced effects" hint="Fewer cloud layers and transitions in the cabin." checked={prefs.lighting.reducedEffects} onChange={(v) => setLighting({ reducedEffects: v })} />
          </div>
          <div className="prefs-sliders">
            <Slider label="Cabin brightness" value={prefs.lighting.cabinBrightness} onChange={(v) => setLighting({ cabinBrightness: v })} format={pct} />
            <Slider label="Interface brightness" min={0.5} max={1} value={prefs.lighting.interfaceBrightness} onChange={(v) => setLighting({ interfaceBrightness: v })} format={pct} />
          </div>
        </Prefs>

        <Prefs title="Announcements">
          <p className="prefs-line">
            <label htmlFor={announceId}>Cabin announcements are</label>{" "}
            <Select id={announceId} className="prefs-inline-select" value={prefs.announcements} onChange={(e) => setPrefs({ announcements: e.target.value as UiPreferences["announcements"] })}>
              <option value="full">played in full</option>
              <option value="essential">essential only</option>
              <option value="captions">captions only</option>
            </Select>
            . Captions show the text without playing audio.
          </p>
        </Prefs>

        <Prefs title="Breaks">
          {isUser ? (
            <>
              <p className="prefs-line">Your usual rhythm, offered first when you book. You can still change it for each flight.</p>
              <BreakScheduleFields value={breaks} onChange={setBreaks} presets={presets} />
              <div>
                <Button variant="primary" onClick={() => void save({ breakSchedule: breaks })} disabled={settings ? sameBreaks(breaks, settings.breakSchedule) : false}>
                  Save break defaults
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="prefs-line">You can set a break rhythm for each flight when you book it.</p>
              <AccountNote what="A saved break default" />
            </>
          )}
        </Prefs>

        <Prefs title="Privacy">
          <p className="prefs-line">Shared flights appear as an anonymous position on the community map. Hiding other passengers never affects your own flight.</p>
          <div className="prefs-toggles">
            {isUser && settings ? (
              <>
                <Toggle label="Share my flights by default" hint="You can change this per flight." checked={settings.shareFlightsByDefault} onChange={(v) => void save({ shareFlightsByDefault: v })} />
                <Toggle label="Show other passengers' flights" checked={settings.showCommunityFlights} onChange={(v) => void save({ showCommunityFlights: v })} />
              </>
            ) : (
              <Toggle label="Show other passengers' flights" checked={prefs.showOtherFlights} onChange={(v) => setPrefs({ showOtherFlights: v })} />
            )}
          </div>
          {!isUser && <AccountNote what="Sharing your own flights" />}
        </Prefs>

        <Prefs title="Notifications">
          {isUser && settings ? (
            <>
              <p className="prefs-line">
                <label htmlFor={channelId}>Reminders arrive as</label>{" "}
                <Select id={channelId} className="prefs-inline-select" value={settings.notifications.channel} onChange={(e) => void save({ notifications: { ...settings.notifications, channel: e.target.value as SettingsView["notifications"]["channel"] } })}>
                  <option value="push">a browser notification</option>
                  <option value="sound">a sound</option>
                  <option value="both">a notification and a sound</option>
                  <option value="none">nothing</option>
                </Select>
                .
              </p>
              <div className="prefs-toggles">
                <Toggle label="Boarding reminder" checked={settings.notifications.boardingReminder} onChange={(v) => void save({ notifications: { ...settings.notifications, boardingReminder: v } })} />
                <Toggle label="Break ending" checked={settings.notifications.breakEnd} onChange={(v) => void save({ notifications: { ...settings.notifications, breakEnd: v } })} />
                <Toggle label="Landing" checked={settings.notifications.landing} onChange={(v) => void save({ notifications: { ...settings.notifications, landing: v } })} />
              </div>
            </>
          ) : (
            <AccountNote what="Choosing which reminders you get" />
          )}
          <p className="prefs-line prefs-inline">
            <span>{permissionCopy}</span>
            {permission === "default" && (
              <Button variant="secondary" size="sm" onClick={() => void allowNotifications()}>
                Allow browser notifications
              </Button>
            )}
          </p>
        </Prefs>

        <Prefs title="Account">
          {isUser ? (
            <p className="prefs-line prefs-inline">
              <span>Signed in as {session.user?.email}.</span>
              <Button variant="quiet" onClick={() => void signOut()} busy={leaving}>
                Sign out
              </Button>
            </p>
          ) : (
            <>
              <p className="prefs-line">
                Guest flights stay on this device until {formatDate(session.guest.expiresAt(), session.timeZone)}. <Link to="/account/sign-in">Create an account</Link> to keep them.
              </p>
              <div className="prefs-inline">
                <Button variant="secondary" onClick={() => setExportOpen(true)}>
                  Export my guest data
                </Button>
                <Button variant="danger" onClick={() => setClearOpen(true)} disabled={!hasGuestData}>
                  Clear guest data
                </Button>
              </div>
            </>
          )}
        </Prefs>
      </div>

      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title="Your guest data" wide>
        <p className="small muted">Everything stored on this device. Copy it somewhere safe if you want a backup.</p>
        <Field label="Guest data (JSON)">
          {(id) => <Textarea id={id} readOnly value={guestJson} rows={14} className="prefs-export" onFocus={(e) => e.currentTarget.select()} />}
        </Field>
      </Dialog>

      <Dialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear guest data?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setClearOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={clearGuest}>
              Clear guest data
            </Button>
          </>
        }
      >
        <p>This removes every guest flight, booking and in-progress session from this device. It cannot be undone.</p>
      </Dialog>
    </Page>
  );
}
