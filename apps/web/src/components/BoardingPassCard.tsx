/**
 * The boarding pass (FR-008). One of the two bold objects in the product: a horizontal document
 * with a perforated stub. Every clock time is shown in the passenger's own zone (FR-012).
 */
import type { BoardingPass } from "@aerofocus/client";
import { cabinLabel, formatClock, formatDate, formatDuration } from "../lib/format";
import { Badge, SampleBadge } from "../ui/Badge";
import { Facts } from "../ui/Board";
import { Icon } from "../ui/Icon";
import "./BoardingPassCard.css";

export type PassStatus = "booked" | "boarding_open" | "boarded" | "no_show" | "cancelled";

/** Status as the passenger experiences it now: a "booked" pass whose boarding closed is a no-show. */
export function passStatus(pass: BoardingPass, now: number): PassStatus {
  if (pass.status === "cancelled" || pass.status === "boarded" || pass.status === "no_show") return pass.status;
  const opens = pass.boardingOpensAt.epochMs;
  const closes = pass.boardingClosesAt.epochMs;
  if (now > closes) return "no_show";
  if (now >= opens) return "boarding_open";
  return "booked";
}

const STATUS_LABEL: Record<PassStatus, string> = {
  booked: "Booked",
  boarding_open: "Boarding open",
  boarded: "Boarded",
  no_show: "No-show",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<PassStatus, "neutral" | "signal" | "geo" | "danger"> = {
  booked: "neutral",
  boarding_open: "signal",
  boarded: "geo",
  no_show: "danger",
  cancelled: "neutral",
};

export function StatusBadge({ status }: { status: PassStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

interface Props {
  pass: BoardingPass;
  now: number;
  compact?: boolean;
}

export function BoardingPassCard({ pass, now, compact }: Props) {
  const status = passStatus(pass, now);
  const tz = pass.departure.timeZone;
  const aircraft = pass.aircraft.known ? pass.aircraft.name : <span className="muted">Not confirmed</span>;
  const seat = (
    <span className="pass-seat">
      <span className="code">{pass.seat.seat}</span>
      {pass.seat.wingView && (
        <Badge tone="premium" icon="wing">
          Wing view
        </Badge>
      )}
    </span>
  );

  return (
    <div className={`pass-wrap ${compact ? "is-compact" : ""}`}>
      <article className="pass" aria-label={`Boarding pass for flight ${pass.flightNumber}`}>
        <div className="pass-main">
          <header className="pass-head">
            <span className="pass-airline">{pass.airline.name}</span>
            <span className="pass-brand">Aerofocus Airlines</span>
          </header>
          <div className="pass-body">
            <div className="pass-route">
              <div className="pass-end">
                <span className="code pass-iata">{pass.origin.iata}</span>
                <span className="pass-city">{pass.origin.city}</span>
              </div>
              <span className="pass-plane" aria-hidden="true">
                <Icon name="plane" size={22} />
              </span>
              <div className="pass-end">
                <span className="code pass-iata">{pass.destination.iata}</span>
                <span className="pass-city">{pass.destination.city}</span>
              </div>
              <div className="pass-status">
                <StatusBadge status={status} />
              </div>
            </div>

            <Facts
              items={[
                { label: "Flight", value: <span className="code">{pass.flightNumber}</span> },
                { label: "Date", value: formatDate(pass.departure, tz) },
                { label: "Departs", value: formatClock(pass.departure, tz) },
                { label: "Lands", value: formatClock(pass.arrival, tz) },
                { label: "Boarding opens", value: formatClock(pass.boardingOpensAt, tz) },
                { label: "Study time", value: formatDuration(pass.studyDurationMs) },
                { label: "Aircraft", value: aircraft },
                { label: "Cabin", value: cabinLabel(pass.cabin) },
                { label: "Seat", value: seat },
                { label: "Passenger", value: pass.passengerName ?? "Guest passenger" },
                { label: "Type", value: pass.flightType === "community" ? "Community Flight" : "Individual" },
              ]}
            />

            {pass.studyGoal && (
              <p className="pass-goal">
                <span className="muted">Study goal</span> {pass.studyGoal}
              </p>
            )}

            <footer className="pass-foot small muted">
              <SampleBadge dataSource={pass.dataSource} />
              <span>Virtual journey. You are not aboard the real aircraft.</span>
            </footer>
          </div>
        </div>

        {!compact && (
          <aside className="pass-stub" aria-label="Stub">
            <header className="pass-head pass-head-stub">
              <span className="pass-brand">Boarding pass</span>
            </header>
            <div className="pass-stub-body">
              <span className="code pass-stub-flight">{pass.flightNumber}</span>
              <span className="pass-stub-codes">
                <span className="code">{pass.origin.iata}</span>
                <span className="pass-stub-sep" aria-hidden="true" />
                <span className="code">{pass.destination.iata}</span>
              </span>
              <dl className="pass-stub-facts">
                <div>
                  <dt>Seat</dt>
                  <dd className="code">{pass.seat.seat}</dd>
                </div>
                <div>
                  <dt>Departs</dt>
                  <dd className="numeral">{formatClock(pass.departure, tz)}</dd>
                </div>
                <div>
                  <dt>Cabin</dt>
                  <dd>{cabinLabel(pass.cabin)}</dd>
                </div>
              </dl>
              <div className="pass-strip" aria-hidden="true" />
            </div>
          </aside>
        )}
      </article>
    </div>
  );
}
