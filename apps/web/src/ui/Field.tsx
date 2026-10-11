import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import "./Field.css";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  inline?: boolean;
}

/** Label + control + hint/error, wired with ids. The control is rendered by the child function. */
export function Field({ label, hint, error, children, inline }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${inline ? "field-inline" : ""} ${error ? "has-error" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id, describedBy)}
      {hint && (
        <div id={hintId} className="field-hint">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`control ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`control ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`control control-textarea ${props.className ?? ""}`} />;
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}

export function Toggle({ label, checked, onChange, hint, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <label htmlFor={id}>{label}</label>
        {hint && <div className="field-hint">{hint}</div>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} disabled={disabled}>
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  format?: (v: number) => string;
}

export function Slider({ label, value, min = 0, max = 1, step = 0.05, onChange, format }: SliderProps) {
  const id = useId();
  return (
    <div className="slider-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format ? format(value) : undefined} />
      <output htmlFor={id} className="numeral small">
        {format ? format(value) : Math.round(value * 100)}
      </output>
    </div>
  );
}
