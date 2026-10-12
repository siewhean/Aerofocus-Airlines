/**
 * Focus state while aboard (FR-011, FR-013a): status, next break, counters and break controls.
 * All figures come from the session view; the panel never computes focus time itself.
 */
import type { FlightView } from "../lib/flightSession";
import { formatClock, formatDuration } from "../lib/format";
import { Badge, Button, Icon, Notice } from "../ui";
import "./FocusPanel.css";

interface Props {
  view: FlightView;
  timeZone: string;
  busy?: boolean;
  onBreakStart: () => void;
  onBreakEnd: () => void;
}

export function focusLabel(state: FlightView["focus"]["state"]): { text: string; tone: "signal" | "amber" } {
  switch (state) {
    case "focus":
      return { text: "Focus on", tone: "signal" };
    case "break":
      return { text: "On a break", tone: "amber" };
    default:
      return { text: "Waiting for you", tone: "amber" };
  }
}

/** Just the status pill, for the minimal focus mode. */
export function FocusPill({ state }: { state: FlightView["focus"]["state"] }) {
  const { text, tone } = focusLabel(state);
  return <Badge tone={tone}>{text}</Badge>;
}

export function FocusPanel({ view, timeZone, busy = false, onBreakStart, onBreakEnd }: Props) {
  const { focus, boardingPass, studyGoal } = view;
  const manual = boardingPass.breakSchedule.mode === "manual";
  const nextBreak = focus.nextBreakAt !== null ? `Next break at ${formatClock(focus.nextBreakAt, timeZone)}` : manual ? "No breaks scheduled" : "No more breaks";

  return (
    <section className="focus-panel" aria-label="Focus">
      <div className="focus-row">
        <FocusPill state={focus.state} />
        <span className="focus-next muted">{focus.state === "focus" ? nextBreak : manual ? "Ends when you say" : "Ends on schedule"}</span>
        <span className="focus-counter numeral">
          <span className="muted small">Focused</span> {formatDuration(focus.focusMs)}
        </span>
        <span className="focus-counter numeral">
          <span className="muted small">Breaks</span> {formatDuration(focus.breakMs)}
        </span>
        <div className="focus-actions">
          {focus.state === "focus" && (
            <Button variant="secondary" icon={<Icon name="pause" />} onClick={onBreakStart} busy={busy}>
              Take a break
            </Button>
          )}
          {focus.state === "break" && manual && (
            <Button variant="primary" onClick={onBreakEnd} busy={busy}>
              End break
            </Button>
          )}
        </div>
      </div>
      {studyGoal && (
        <p className="focus-goal small muted">
          <span>Goal</span> {studyGoal}
        </p>
      )}
      {focus.unattendedNow && <Notice tone="amber">We can't see the app right now; this time will need confirming at arrival.</Notice>}
    </section>
  );
}
