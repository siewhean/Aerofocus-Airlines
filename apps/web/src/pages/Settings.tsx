import { DEFAULT_BREAK_SCHEDULE, type BreakSchedule } from "@aerofocus/core";
import type { AirportView } from "@aerofocus/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { BreakScheduleFields } from "../components/BreakScheduleFields";
import { api, errorMessage } from "../lib/api";
import type { SettingsView } from "../lib/api-ext";
import { browserTimeZone, formatDate } from "../lib/format";
import { notificationPermission, requestNotificationPermission } from "../lib/notify";
import type { UiPreferences } from "../lib/prefs";
import { useSession, writeLocal } from "../lib/session";
import { Button, Dialog, Field, Input, Notice, Section, Select, Slider, Textarea, Toggle, useToast } from "../ui";
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

function AccountNote({ what }: { what: string }) {
  return (
    <p className="small muted">
      {what} needs an account. <Link to="/account/sign-in">Create one</Link> to save it.
    </p>
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
    permission === "unsupported" ? "This browser does not support notifications." : permission === "granted" ? "Browser notifications are allowed." : permission === "denied" ? "Browser notifications are blocked. Change this in your browser settings." : "Browser notifications have not been allowed yet.";

  return (
    <Page title="Settings" lead="Changes save as you make them.">
      <div className="settings">
        <Section title="Profile">
          {isUser ? (
            <div className="settings-grid">
              <Field label="Display name" hint="Shown on your profile. Leave blank to use your email.">
                {(id, describedBy) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="text"
                    maxLength={60}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onBlur={() => {
                      const next = displayName.trim() || null;
                      if (next !== (settings?.displayName ?? null)) void save({ displayName: next });
                    }}
                  />
                )}
              </Field>
              <Field label="Time zone" hint="All times in the app are shown in this zone.">
                {(id, describedBy) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={settings?.timeZone ?? deviceZone}
                    onChange={(e) => {
                      const v = e.target.value === "__device" ? deviceZone : e.target.value;
                      void save({ timeZone: v });
                    }}
                  >
                    <option value="__device">Use my device ({deviceZone})</option>
                    {zoneOptions.map((z) => (
                      <option key={z} value={z}>
                        {z.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          ) : (
            <>
              <p className="small muted">Times are shown in your device zone, {deviceZone}.</p>
              <AccountNote what="A display name or a different time zone" />
            </>
          )}
          <Field label="Home airport" hint="Searches start here by default.">
            {(id, describedBy) => (
              <Select id={id} aria-describedby={describedBy} value={session.homeAirport ?? ""} onChange={(e) => void onHomeAirport(e.target.value)} disabled={airports === null}>
                <option value="">Not set</option>
                {(airports ?? []).map((a) => (
                  <option key={a.iata} value={a.iata}>
                    {a.city} ({a.iata}) – {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Section>

        <Section title="Passport colour">
          <p>
            Choose the cover on the <Link to="/collection/passport">passport page</Link>. Changing it never alters earned marks.
          </p>
        </Section>

        <Section title="Breaks">
          {isUser ? (
            <>
              <BreakScheduleFields value={breaks} onChange={setBreaks} presets={presets} />
              <div>
                <Button variant="primary" onClick={() => void save({ breakSchedule: breaks })} disabled={settings ? sameBreaks(breaks, settings.breakSchedule) : false}>
                  Save break defaults
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="small muted">You can still set a break rhythm for each flight when you book it.</p>
              <AccountNote what="A saved break default" />
            </>
          )}
        </Section>

        <Section title="Audio">
          <Toggle label="Mute all sound" checked={prefs.audio.muted} onChange={(v) => setAudio({ muted: v })} />
          <Slider label="Master" value={prefs.audio.master} onChange={(v) => setAudio({ master: v })} format={pct} />
          <Slider label="Engine" value={prefs.audio.engine} onChange={(v) => setAudio({ engine: v })} format={pct} />
          <Slider label="Ventilation" value={prefs.audio.ventilation} onChange={(v) => setAudio({ ventilation: v })} format={pct} />
          <Slider label="Passengers" value={prefs.audio.passengers} onChange={(v) => setAudio({ passengers: v })} format={pct} />
          <Slider label="Voice" value={prefs.audio.voice} onChange={(v) => setAudio({ voice: v })} format={pct} />
          <Slider label="Music" value={prefs.audio.music} onChange={(v) => setAudio({ music: v })} format={pct} />
          <Slider label="Notifications" value={prefs.audio.notifications} onChange={(v) => setAudio({ notifications: v })} format={pct} />
          <Slider label="Effects" value={prefs.audio.effects} onChange={(v) => setAudio({ effects: v })} format={pct} />
        </Section>

        <Section title="Lighting">
          <Toggle label="Reading light" checked={prefs.lighting.readingLight} onChange={(v) => setLighting({ readingLight: v })} />
          <Toggle label="Reduced effects" hint="Fewer cloud layers and transitions in the cabin." checked={prefs.lighting.reducedEffects} onChange={(v) => setLighting({ reducedEffects: v })} />
          <Slider label="Cabin brightness" value={prefs.lighting.cabinBrightness} onChange={(v) => setLighting({ cabinBrightness: v })} format={pct} />
          <Slider label="Interface brightness" min={0.5} max={1} value={prefs.lighting.interfaceBrightness} onChange={(v) => setLighting({ interfaceBrightness: v })} format={pct} />
        </Section>

        <Section title="Announcements">
          <Field label="Cabin announcements" hint="Captions show the text without playing audio.">
            {(id, describedBy) => (
              <Select id={id} aria-describedby={describedBy} value={prefs.announcements} onChange={(e) => setPrefs({ announcements: e.target.value as UiPreferences["announcements"] })}>
                <option value="full">Full</option>
                <option value="essential">Essential only</option>
                <option value="captions">Captions only</option>
              </Select>
            )}
          </Field>
        </Section>

        <Section title="Appearance">
          <Field label="Dark mode" hint="System follows your device. The cabin is always night-lit.">
            {(id, describedBy) => (
              <Select id={id} aria-describedby={describedBy} value={prefs.appearance} onChange={(e) => setPrefs({ appearance: e.target.value as UiPreferences["appearance"] })}>
                <option value="system">Follow the system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            )}
          </Field>
        </Section>

        <Section title="Graphics">
          <Field label="Graphics quality" hint="Auto follows your device and battery.">
            {(id, describedBy) => (
              <Select id={id} aria-describedby={describedBy} value={prefs.graphics} onChange={(e) => setPrefs({ graphics: e.target.value as UiPreferences["graphics"] })}>
                <option value="auto">Auto</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </Select>
            )}
          </Field>
        </Section>

        <Section title="Community privacy">
          {isUser && settings ? (
            <>
              <Toggle label="Share my flights by default" hint="Shows an anonymous position on the community map. You can change this per flight." checked={settings.shareFlightsByDefault} onChange={(v) => void save({ shareFlightsByDefault: v })} />
              <Toggle label="Show other passengers' flights" hint="Hiding them never affects your own flight." checked={settings.showCommunityFlights} onChange={(v) => void save({ showCommunityFlights: v })} />
            </>
          ) : (
            <>
              <Toggle label="Show other passengers' flights" hint="Hiding them never affects your own flight." checked={prefs.showOtherFlights} onChange={(v) => setPrefs({ showOtherFlights: v })} />
              <AccountNote what="Sharing your own flights" />
            </>
          )}
        </Section>

        <Section title="Notifications">
          {isUser && settings ? (
            <>
              <Toggle label="Boarding reminder" checked={settings.notifications.boardingReminder} onChange={(v) => void save({ notifications: { ...settings.notifications, boardingReminder: v } })} />
              <Toggle label="Break ending" checked={settings.notifications.breakEnd} onChange={(v) => void save({ notifications: { ...settings.notifications, breakEnd: v } })} />
              <Toggle label="Landing" checked={settings.notifications.landing} onChange={(v) => void save({ notifications: { ...settings.notifications, landing: v } })} />
              <Field label="Channel">
                {(id) => (
                  <Select id={id} value={settings.notifications.channel} onChange={(e) => void save({ notifications: { ...settings.notifications, channel: e.target.value as SettingsView["notifications"]["channel"] } })}>
                    <option value="push">Browser notification</option>
                    <option value="sound">Sound</option>
                    <option value="both">Both</option>
                    <option value="none">None</option>
                  </Select>
                )}
              </Field>
            </>
          ) : (
            <AccountNote what="Choosing which reminders you get" />
          )}
          <div className="settings-inline">
            <Button variant="secondary" onClick={() => void allowNotifications()} disabled={permission === "granted" || permission === "unsupported" || permission === "denied"}>
              Allow browser notifications
            </Button>
            <span className="small muted">{permissionCopy}</span>
          </div>
        </Section>

        <Section title="Account">
          {isUser ? (
            <div className="settings-inline">
              <Button variant="secondary" onClick={() => void signOut()} busy={leaving}>
                Sign out
              </Button>
              <span className="small muted">Signed in as {session.user?.email}.</span>
            </div>
          ) : (
            <>
              <p className="small muted">Guest flights stay on this device until {formatDate(session.guest.expiresAt(), session.timeZone)}.</p>
              <div className="settings-inline">
                <Button variant="secondary" onClick={() => setExportOpen(true)}>
                  Export my guest data
                </Button>
                <Button variant="danger" onClick={() => setClearOpen(true)} disabled={!session.guestState || (session.guestState.history.length === 0 && !session.guestState.booking && !session.guestState.session)}>
                  Clear guest data
                </Button>
              </div>
            </>
          )}
        </Section>
      </div>

      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title="Your guest data" wide>
        <p className="small muted">Everything stored on this device. Copy it somewhere safe if you want a backup.</p>
        <Field label="Guest data (JSON)">
          {(id) => <Textarea id={id} readOnly value={guestJson} rows={14} className="settings-export" onFocus={(e) => e.currentTarget.select()} />}
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
