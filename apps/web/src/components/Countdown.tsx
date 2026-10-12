import { formatCountdown } from "../lib/format";
import "./Countdown.css";

interface Props {
  remainingMs: number;
  label?: string;
  size?: "lg" | "md";
  className?: string;
}

/** The large remaining-time figure. Driven by useFlightClock, never by its own timer. */
export function Countdown({ remainingMs, label = "remaining", size = "lg", className }: Props) {
  return (
    <div className={`countdown countdown-${size} ${className ?? ""}`} role="timer" aria-live="off">
      <span className="display numeral countdown-value">{formatCountdown(remainingMs)}</span>
      <span className="countdown-label small muted">{label}</span>
    </div>
  );
}
