/** Break schedule editor (FR-033). Shape from packages/core/src/focus.ts:4-12. */
import type { BreakSchedule } from "@aerofocus/core";
import { useState, type ChangeEvent } from "react";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";

interface Props {
  value: BreakSchedule;
  onChange: (v: BreakSchedule) => void;
  presets: BreakSchedule[];
}

type NumKey = Exclude<keyof BreakSchedule, "mode">;

const sameRhythm = (a: BreakSchedule, b: BreakSchedule) => a.focusMinutes === b.focusMinutes && a.breakMinutes === b.breakMinutes;

export function BreakScheduleFields({ value, onChange, presets }: Props) {
  const set = <K extends keyof BreakSchedule>(key: K, v: BreakSchedule[K]) => onChange({ ...value, [key]: v });
  // Controlled string drafts: commit only in-range values while typing, clamp on blur, so "25" is
  // never cut to "5" mid-keystroke and presets still refresh the fields.
  const [drafts, setDrafts] = useState<Partial<Record<NumKey, string>>>({});
  const num = (key: NumKey, min: number, max: number) => ({
    value: drafts[key] ?? String(value[key]),
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setDrafts((d) => ({ ...d, [key]: raw }));
      const n = Number(raw);
      if (raw !== "" && Number.isFinite(n) && n >= min && n <= max) set(key, Math.floor(n));
    },
    onBlur: (e: ChangeEvent<HTMLInputElement>) => {
      const n = Number(e.target.value);
      const clamped = Number.isFinite(n) && e.target.value !== "" ? Math.min(max, Math.max(min, Math.floor(n))) : min;
      setDrafts((d) => ({ ...d, [key]: undefined }));
      set(key, clamped);
    },
  });

  return (
    <div className="breaks">
      <div className="breaks-presets" role="group" aria-label="Break presets">
        {presets.map((p) => {
          const active = sameRhythm(p, value);
          return (
            <Button key={`${p.focusMinutes}-${p.breakMinutes}`} size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} onClick={() => { setDrafts({}); onChange({ ...value, focusMinutes: p.focusMinutes, breakMinutes: p.breakMinutes }); }}>
              {p.focusMinutes} / {p.breakMinutes}
            </Button>
          );
        })}
      </div>
      <div className="breaks-grid">
        <Field label="Break mode" hint={value.mode === "auto" ? "Breaks start and end on schedule." : "You start and end each break yourself."}>
          {(id, describedBy) => (
            <Select id={id} aria-describedby={describedBy} value={value.mode} onChange={(e) => set("mode", e.target.value as BreakSchedule["mode"])}>
              <option value="auto">Automatic</option>
              <option value="manual">Manual</option>
            </Select>
          )}
        </Field>
        <Field label="Focus minutes">
          {(id) => <Input id={id} type="number" inputMode="numeric" min={5} max={240} step={5} {...num("focusMinutes", 5, 240)} />}
        </Field>
        <Field label="Break minutes">
          {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={60} {...num("breakMinutes", 1, 60)} />}
        </Field>
        <Field label="Long break every" hint="Number of breaks. 0 means never.">
          {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="numeric" min={0} max={12} {...num("longBreakEvery", 0, 12)} />}
        </Field>
        <Field label="Long break minutes">
          {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={120} disabled={value.longBreakEvery === 0} {...num("longBreakMinutes", 1, 120)} />}
        </Field>
      </div>
    </div>
  );
}
