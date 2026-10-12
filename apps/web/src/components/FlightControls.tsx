/**
 * Bottom control bar for the flight (FR-024 lighting, FR-034 focus modes, FR-037 sound, FR-014 exit).
 * Preferences go through `updatePrefs`, which persists to the server for users and localStorage
 * for guests (lib/session.tsx).
 */
import { useState, type KeyboardEvent } from "react";
import type { UiPreferences } from "../lib/prefs";
import { Button, Dialog, Field, Icon, Select, Slider, Toggle } from "../ui";
import "./FlightControls.css";

export type FocusMode = UiPreferences["focusMode"];

const MODES: { value: FocusMode; label: string }[] = [
  { value: "cabin", label: "Cabin" },
  { value: "compact", label: "Compact" },
  { value: "minimal", label: "Minimal" },
  { value: "ambient", label: "Ambient" },
  { value: "map", label: "Map" },
];

interface SegmentedProps<T extends string> {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}

/** Radio-group semantics with roving focus; arrow keys move between options. */
export function Segmented<T extends string>({ label, value, options, onChange, size = "md" }: SegmentedProps<T>) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = options[(index + dir + options.length) % options.length];
    if (next) {
      onChange(next.value);
      const group = e.currentTarget.parentElement;
      (group?.children[(index + dir + options.length) % options.length] as HTMLButtonElement | undefined)?.focus();
    }
  };
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (value === null && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  prefs: UiPreferences;
  updatePrefs: (patch: Partial<UiPreferences>) => void;
  audioOn: boolean;
  onAudioToggle: () => void;
  onLeave: () => void;
  busy?: boolean;
  /** Minimal mode: switcher and leave only. */
  tiny?: boolean;
}

export function FlightControls({ prefs, updatePrefs, audioOn, onAudioToggle, onLeave, busy = false, tiny = false }: Props) {
  const [open, setOpen] = useState<"lighting" | "sound" | "leave" | null>(null);
  const close = () => setOpen(null);
  const setLighting = (patch: Partial<UiPreferences["lighting"]>) => updatePrefs({ lighting: { ...prefs.lighting, ...patch } });
  const setAudio = (patch: Partial<UiPreferences["audio"]>) => updatePrefs({ audio: { ...prefs.audio, ...patch } });
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className={`flight-controls ${tiny ? "is-tiny" : ""}`}>
      <Segmented label="Focus mode" value={prefs.focusMode} options={MODES} onChange={(focusMode) => updatePrefs({ focusMode })} size="sm" />
      <div className="flight-controls-actions">
        {!tiny && (
          <>
            <Button variant="quiet" icon={<Icon name="sun" />} onClick={() => setOpen("lighting")} aria-haspopup="dialog">
              Lighting
            </Button>
            <Button variant="quiet" icon={<Icon name={audioOn && !prefs.audio.muted ? "volume" : "mute"} />} onClick={() => setOpen("sound")} aria-haspopup="dialog">
              Sound
            </Button>
          </>
        )}
        <Button variant="danger" size={tiny ? "sm" : "md"} icon={<Icon name="exit" />} onClick={() => setOpen("leave")} aria-haspopup="dialog">
          Leave flight
        </Button>
      </div>

      <Dialog open={open === "lighting"} onClose={close} title="Lighting">
        <Toggle label="Reading light" checked={prefs.lighting.readingLight} onChange={(readingLight) => setLighting({ readingLight })} hint="A warm pool of light on your side of the cabin." />
        <Slider label="Cabin brightness" value={prefs.lighting.cabinBrightness} min={0} max={1} step={0.05} onChange={(cabinBrightness) => setLighting({ cabinBrightness })} format={pct} />
        <Slider label="Interface brightness" value={prefs.lighting.interfaceBrightness} min={0.5} max={1} step={0.05} onChange={(interfaceBrightness) => setLighting({ interfaceBrightness })} format={pct} />
        <Toggle label="Reduced effects" checked={prefs.lighting.reducedEffects} onChange={(reducedEffects) => setLighting({ reducedEffects })} hint="Stops cloud drift and softens the window." />
      </Dialog>

      <Dialog
        open={open === "sound"}
        onClose={close}
        title="Sound"
        footer={
          <Button variant="primary" icon={<Icon name={audioOn ? "mute" : "volume"} />} onClick={onAudioToggle}>
            {audioOn ? "Sound off" : "Sound on"}
          </Button>
        }
      >
        <p className="small muted">Engine, ventilation and cabin sounds are synthesised on your device. Nothing is downloaded.</p>
        <Toggle label="Mute" checked={prefs.audio.muted} onChange={(muted) => setAudio({ muted })} />
        <Slider label="Master" value={prefs.audio.master} onChange={(master) => setAudio({ master })} format={pct} />
        <Slider label="Engine" value={prefs.audio.engine} onChange={(engine) => setAudio({ engine })} format={pct} />
        <Slider label="Ventilation" value={prefs.audio.ventilation} onChange={(ventilation) => setAudio({ ventilation })} format={pct} />
        <Slider label="Passengers" value={prefs.audio.passengers} onChange={(passengers) => setAudio({ passengers })} format={pct} />
        <Slider label="Voice" value={prefs.audio.voice} onChange={(voice) => setAudio({ voice })} format={pct} />
        <Slider label="Notifications" value={prefs.audio.notifications} onChange={(notifications) => setAudio({ notifications })} format={pct} />
        <Field label="Announcements" hint="Captions are always shown.">
          {(id, describedBy) => (
            <Select id={id} aria-describedby={describedBy} value={prefs.announcements} onChange={(e) => updatePrefs({ announcements: e.target.value as UiPreferences["announcements"] })}>
              <option value="full">Spoken, with chime</option>
              <option value="essential">Chime only</option>
              <option value="captions">Captions only</option>
            </Select>
          )}
        </Field>
      </Dialog>

      <Dialog
        open={open === "leave"}
        onClose={close}
        title="Leave this flight early?"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Stay aboard
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={() => {
                close();
                onLeave();
              }}
            >
              Leave flight
            </Button>
          </>
        }
      >
        <p>Only focus intervals completed before your last break are kept. The interval in progress is not credited, and there's no arrival stamp.</p>
      </Dialog>
    </div>
  );
}
