import type { Offer } from "@aerofocus/client";
import { MINUTE, type CabinClass } from "@aerofocus/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { FlightIdent, RouteCodes } from "../components/RouteCodes";
import { api, errorMessage } from "../lib/api";
import { bookFlight } from "../lib/flights";
import { cabinLabel, formatClock, formatDuration, formatRelativeDay } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Button, Facts, Field, Input, Notice, SampleBadge, Section } from "../ui";
import "./Random.css";

const QUICK_PICKS = [45, 90, 180, 360];
const MIN_MINUTES = 30;
const STEP_MINUTES = 15;
/** Draw tokens expire 30 minutes after the draw (docs/API.md "Random Flight"). */
const DRAW_TTL_MS = 30 * MINUTE;

interface Draw {
  offer: Offer;
  cabin: CabinClass;
  drawToken: string;
  expiresAt: number;
}

export default function Random() {
  const session = useSession();
  const navigate = useNavigate();
  const tz = session.timeZone;

  const [minutes, setMinutes] = useState(90);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const valid = Number.isFinite(minutes) && minutes >= MIN_MINUTES;

  const onDraw = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) {
      setError(`Study for at least ${MIN_MINUTES} minutes.`);
      return;
    }
    setDrawing(true);
    setError(null);
    try {
      const res = await api.randomFlight(Math.round(minutes), session.mode === "guest" ? tz : undefined);
      if (!alive.current) return;
      setDraw({ offer: res.offer, cabin: res.cabin, drawToken: res.drawToken, expiresAt: session.now() + DRAW_TTL_MS });
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current) setDrawing(false);
    }
  };

  const onBook = async () => {
    if (!draw) return;
    setBooking(true);
    setError(null);
    try {
      const pass = await bookFlight(session, { offer: draw.offer, mode: "depart_now", cabin: draw.cabin, drawToken: draw.drawToken });
      navigate(`/fly/pass/${pass.bookingId}`);
    } catch (err) {
      if (alive.current) {
        setError(errorMessage(err));
        setBooking(false);
      }
    }
  };

  const now = session.now();

  return (
    <Page title="Random flight" lead="Only tell us how long you want to study. Everything else is up to the airline gods.">
      <form className="random-control" onSubmit={onDraw} noValidate>
        <Field label="Minutes of study" hint={`At least ${MIN_MINUTES} minutes, in steps of ${STEP_MINUTES}.`} error={!valid ? `Enter ${MIN_MINUTES} minutes or more.` : null}>
          {(id, describedBy) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              className="random-minutes numeral"
              type="number"
              inputMode="numeric"
              min={MIN_MINUTES}
              step={STEP_MINUTES}
              value={Number.isFinite(minutes) ? minutes : ""}
              onChange={(e) => setMinutes(e.target.value === "" ? Number.NaN : Number(e.target.value))}
            />
          )}
        </Field>
        <div className="random-picks" role="group" aria-label="Quick picks">
          {QUICK_PICKS.map((m) => (
            <Button key={m} size="sm" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
              {formatDuration(m * MINUTE)}
            </Button>
          ))}
        </div>
        <div className="random-draw">
          <Button type="submit" variant="primary" size="lg" busy={drawing} disabled={!valid}>
            Draw a flight
          </Button>
          {draw && (
            <span className="muted small">
              Draw expires at <span className="numeral">{formatClock(draw.expiresAt, tz)}</span>
            </span>
          )}
        </div>
      </form>

      {error && <Notice tone="danger">{error}</Notice>}

      {draw && (
        <Section title="Your draw" aside={<span aria-live="polite">{formatDuration(draw.offer.blockMs)} in {cabinLabel(draw.cabin)}</span>}>
          <div className="random-result">
            <div className="random-head">
              <div className="random-flight">
                <RouteCodes origin={draw.offer.origin} destination={draw.offer.destination} cities size="lg" />
                <FlightIdent flightNumber={draw.offer.flightNumber} airline={draw.offer.airline.name} locked={draw.offer.airline.locked} />
              </div>
              <div className="random-meta">
                {draw.offer.mode === "community" ? <Badge tone="geo">Community Flight</Badge> : <Badge>Individual</Badge>}
                <SampleBadge dataSource={draw.offer.dataSource} />
              </div>
            </div>
            <Facts
              items={[
                {
                  label: "Departs",
                  value: (
                    <span>
                      {formatClock(draw.offer.departure, tz)} <span className="muted small">{formatRelativeDay(draw.offer.departure, now, tz)}</span>
                    </span>
                  ),
                },
                { label: "Lands", value: formatClock(draw.offer.arrival, tz) },
                { label: "Duration", value: formatDuration(draw.offer.blockMs) },
                { label: "Aircraft", value: draw.offer.aircraft.known ? draw.offer.aircraft.name : <span className="muted">Aircraft not confirmed</span> },
                { label: "Cabin", value: cabinLabel(draw.cabin) },
              ]}
            />
            <div className="random-actions">
              <Button variant="primary" size="lg" busy={booking} onClick={onBook}>
                Book this flight
              </Button>
              <Button size="lg" busy={drawing} onClick={() => onDraw()}>
                Draw again
              </Button>
            </div>
            <p className="muted small">Random flights may use airlines and cabins you have not unlocked yet.</p>
          </div>
        </Section>
      )}
    </Page>
  );
}
