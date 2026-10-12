/**
 * The boarding pass (FR-008) as the printed object: an IATA-proportioned card (8 × 3.25 in) with a
 * tear-off stub and a PDF417-style block on desktop, the mobile-wallet form on phones. The paper
 * colours are fixed because the pass is an object, not interface chrome. Every clock time is in the
 * passenger's own zone (FR-012).
 */
import type { BoardingPass } from "@aerofocus/client";
import type { ReactNode } from "react";
import { cabinLabel, formatClock, formatDate, formatDuration } from "../lib/format";
import { Badge, SampleBadge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { Barcode, hashString } from "./Barcode";
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

/** The status as a UI badge, for lists and boards outside the pass itself. */
export function StatusBadge({ status }: { status: PassStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** The same status printed on the pass: a small inked tag, the way an agent stamps a document. */
function StatusTag({ status }: { status: PassStatus }) {
  return <span className={`bp-tag bp-tag-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** A stable gate for the booking: letter A–F and a number 1–40 (the schedule carries no gate). */
export function passGate(bookingId: string): string {
  const h = hashString(`gate:${bookingId}`);
  return `${String.fromCharCode(65 + (h % 6))}${1 + ((h >>> 4) % 40)}`;
}

/** A stable three-digit boarding sequence number, 001–999. */
export function passSequence(bookingId: string): string {
  return String(1 + (hashString(`seq:${bookingId}`) % 999)).padStart(3, "0");
}

interface Props {
  pass: BoardingPass;
  now: number;
  compact?: boolean;
}

function Field({ label, children, className, wide }: { label: string; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={`bp-field ${wide ? "is-wide" : ""} ${className ?? ""}`}>
      <span className="bp-label">{label}</span>
      <span className="bp-value">{children}</span>
    </div>
  );
}

export function BoardingPassCard({ pass, now, compact }: Props) {
  const status = passStatus(pass, now);
  const tz = pass.departure.timeZone;
  const gate = passGate(pass.bookingId);
  const sequence = passSequence(pass.bookingId);
  const name = pass.passengerName ?? "Guest passenger";
  const date = formatDate(pass.departure, tz);
  const boarding = formatClock(pass.boardingOpensAt, tz);
  const departs = formatClock(pass.departure, tz);
  const flightType = pass.flightType === "community" ? "Community Flight" : "Individual";
  const ariaLabel = `Boarding pass for flight ${pass.flightNumber}, ${pass.origin.iata} to ${pass.destination.iata}, ${date}, seat ${pass.seat.seat}, gate ${gate}. ${STATUS_LABEL[status]}.`;

  if (compact) {
    return (
      <article className="bp bp-compact" aria-label={ariaLabel}>
        <div className="bp-strip bp-compact-strip">
          <span className="bp-airline">{pass.airline.name}</span>
          <span className="bp-strip-title">Boarding pass</span>
        </div>
        <div className="bp-compact-body">
          <span className="bp-compact-codes">
            <span className="code bp-compact-code">{pass.origin.iata}</span>
            <span className="bp-plane" aria-hidden="true">
              <Icon name="plane" size={14} />
            </span>
            <span className="code bp-compact-code">{pass.destination.iata}</span>
          </span>
          <Field label="Flight">
            <span className="code">{pass.flightNumber}</span>
          </Field>
          <Field label="Date">
            <span className="numeral">{date}</span>
          </Field>
          <Field label="Seat">
            <span className="code">{pass.seat.seat}</span>
          </Field>
          <Field label="Gate">
            <span className="code">{gate}</span>
          </Field>
          <StatusTag status={status} />
        </div>
      </article>
    );
  }

  return (
    <div className="bp-wrap">
      <article className="bp" aria-label={ariaLabel}>
        <div className="bp-main">
          <div className="bp-strip">
            <span className="bp-airline">{pass.airline.name}</span>
            <span className="bp-strip-title">Boarding pass</span>
          </div>

          <div className="bp-body">
            {/* Phone form: the two codes large with the aircraft between, cities beneath. */}
            <div className="bp-route">
              <div className="bp-end">
                <span className="code bp-iata">{pass.origin.iata}</span>
                <span className="bp-city">{pass.origin.city}</span>
              </div>
              <span className="bp-plane" aria-hidden="true">
                <Icon name="plane" size={22} />
              </span>
              <div className="bp-end is-to">
                <span className="code bp-iata">{pass.destination.iata}</span>
                <span className="bp-city">{pass.destination.city}</span>
              </div>
            </div>

            <div className="bp-grid">
              <Field label="Passenger name" className="bp-name" wide>
                {name}
              </Field>
              <Field label="Flight" className="bp-flight">
                <span className="code">{pass.flightNumber}</span>
              </Field>
              <Field label="Date" className="bp-date">
                <span className="numeral">{date}</span>
              </Field>
              <div className="bp-tag-slot">
                <StatusTag status={status} />
              </div>

              <Field label="From" className="bp-from">
                <span className="bp-city-line">{pass.origin.city}</span>
                <span className="code bp-iata">{pass.origin.iata}</span>
              </Field>
              <Field label="To" className="bp-to">
                <span className="bp-city-line">{pass.destination.city}</span>
                <span className="code bp-iata">{pass.destination.iata}</span>
              </Field>
              <Field label="Boarding time" className="bp-boarding">
                <span className="numeral">{boarding}</span>
              </Field>
              <Field label="Departure" className="bp-departs">
                <span className="numeral">{departs}</span>
              </Field>

              <Field label="Gate" className="bp-gate">
                <span className="code">{gate}</span>
              </Field>
              <Field label="Seat" className="bp-seat">
                <span className="code">{pass.seat.seat}</span>
                {pass.seat.wingView && <span className="bp-note">Wing view</span>}
              </Field>
              <Field label="Class" className="bp-class">
                {cabinLabel(pass.cabin)}
              </Field>
              <Field label="Sequence" className="bp-seq">
                <span className="numeral">{sequence}</span>
              </Field>
              <Field label="Study time" className="bp-study">
                <span className="numeral">{formatDuration(pass.studyDurationMs)}</span>
              </Field>
            </div>

            {pass.studyGoal && (
              <p className="bp-goal">
                <span className="bp-label">Study goal</span> {pass.studyGoal}
              </p>
            )}

            <div className="bp-foot">
              <span className="bp-foot-type">{flightType}</span>
              <span className="bp-foot-note">Virtual journey on a real schedule. You are not aboard the real aircraft.</span>
              <SampleBadge dataSource={pass.dataSource} />
            </div>

            {/* Phone form only: the 2D block centred at the bottom. */}
            <div className="bp-qr">
              <Barcode seed={pass.bookingId} kind="qr" width={132} label="Not a real barcode" />
            </div>
          </div>
        </div>

        <aside className="bp-stub" aria-label="Tear-off stub">
          <div className="bp-strip bp-stub-strip">
            <span className="bp-airline">{pass.airline.name}</span>
            <span className="bp-strip-title">Boarding pass</span>
          </div>
          <div className="bp-stub-body">
            <Field label="Name" wide>
              {name}
            </Field>
            <div className="bp-stub-codes">
              <span className="code">{pass.origin.iata}</span>
              <span className="bp-plane" aria-hidden="true">
                <Icon name="plane" size={13} />
              </span>
              <span className="code">{pass.destination.iata}</span>
            </div>
            <Field label="Flight">
              <span className="code">{pass.flightNumber}</span>
            </Field>
            <Field label="Date">
              <span className="numeral">{date}</span>
            </Field>
            <Field label="Seat">
              <span className="code">{pass.seat.seat}</span>
            </Field>
            <Field label="Gate">
              <span className="code">{gate}</span>
            </Field>
            <Field label="Boarding">
              <span className="numeral">{boarding}</span>
            </Field>
            <Field label="Seq">
              <span className="numeral">{sequence}</span>
            </Field>
            <div className="bp-stub-barcode">
              <Barcode seed={pass.bookingId} kind="pdf417" width={200} height={52} label="Not a real barcode" />
            </div>
          </div>
          <span className="bp-stub-edge" aria-hidden="true">
            Aerofocus Airlines
          </span>
        </aside>
      </article>
    </div>
  );
}
