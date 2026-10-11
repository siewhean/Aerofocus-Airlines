import type { CabinClass, GuestFlightImport } from "@aerofocus/core";
import { AIRCRAFT_BY_CODE } from "@aerofocus/data";
import { useEffect, useMemo, useState } from "react";
import { Page } from "../app/Shell";
import { errorMessage } from "../lib/api";
import { apiExt, type HistoryItem } from "../lib/api-ext";
import { cabinLabel, formatDate, formatDuration } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Board, Button, Cell, Empty, Field, Notice, Select, Skeleton } from "../ui";
import "./History.css";

type Status = HistoryItem["status"];

interface Row {
  id: string;
  departure: number;
  flightNumber: string;
  origin: string;
  destination: string;
  aircraft: string;
  cabin: CabinClass | null;
  scheduledBlockMs: number;
  creditedFocusMs: number;
  breakMs: number | null;
  status: Status;
  goalCompleted: boolean | null;
  studyGoal: string | null;
}

const STATUS_COPY: Record<Status, { label: string; tone: "signal" | "danger" | "amber" | "geo" | "neutral" }> = {
  complete: { label: "Complete", tone: "signal" },
  invalid: { label: "Invalid", tone: "danger" },
  ended_early: { label: "Ended early", tone: "amber" },
  in_flight: { label: "In flight", tone: "geo" },
  no_show: { label: "No-show", tone: "neutral" },
};

function fromServer(item: HistoryItem): Row {
  return {
    id: item.sessionId,
    departure: item.departure,
    flightNumber: item.flightNumber,
    origin: item.origin,
    destination: item.destination,
    aircraft: item.aircraft.name,
    cabin: item.cabin,
    scheduledBlockMs: item.scheduledBlockMs,
    creditedFocusMs: item.creditedFocusMs,
    breakMs: item.breakMs ?? null,
    status: item.status,
    goalCompleted: item.goalCompleted ?? null,
    studyGoal: item.studyGoal ?? null,
  };
}

function fromGuest(r: GuestFlightImport, i: number): Row {
  const type = r.aircraftType ? AIRCRAFT_BY_CODE.get(r.aircraftType) : undefined;
  return {
    id: `guest-${i}-${r.snapshotId}-${r.departure}`,
    departure: r.departure,
    // Device records keep the operating airline but not the flight number (packages/core/src/guest.ts:17-22).
    flightNumber: r.airline,
    origin: r.origin,
    destination: r.destination,
    aircraft: type?.name ?? r.aircraftType ?? "—",
    cabin: null,
    scheduledBlockMs: r.blockMs,
    creditedFocusMs: r.creditedFocusMs,
    breakMs: r.breakMs,
    status: r.outcome,
    goalCompleted: r.goalCompleted,
    studyGoal: r.studyGoal,
  };
}

function goalWord(row: Row): string {
  if (row.goalCompleted === true) return "Reached";
  if (row.goalCompleted === false) return "Not reached";
  return "—";
}

export default function History() {
  const session = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (session.mode === "guest") {
      const history = session.guest.load().history;
      setRows(history.map(fromGuest).sort((a, b) => b.departure - a.departure));
      return;
    }
    apiExt
      .history(200)
      .then((res) => {
        if (!cancelled) setRows(res.flights.map(fromServer));
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [session.mode, session.guest, session.guestState]);

  const visible = useMemo(() => (rows ?? []).filter((r) => filter === "all" || r.status === filter), [rows, filter]);

  return (
    <Page
      title="Flight history"
      lead="Every flight you boarded, with what it earned."
      aside={
        rows && rows.length > 0 ? (
          <Field label="Status" inline>
            {(id) => (
              <Select id={id} value={filter} onChange={(e) => setFilter(e.target.value as Status | "all")} className="hist-filter">
                <option value="all">All</option>
                {(Object.keys(STATUS_COPY) as Status[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_COPY[s].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : undefined
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {!rows && !error && <Skeleton lines={5} />}
      {rows && rows.length === 0 && (
        <Empty title="No flights yet" action={<Button variant="primary" to="/fly/search">Book a flight</Button>}>
          Tell us when you can study and we will find a flight that fits.
        </Empty>
      )}
      {rows && rows.length > 0 && visible.length === 0 && <Empty title="No flights with that status">Choose another status to see more of your log.</Empty>}
      {visible.length > 0 && (
        <Board caption="Flight history">
          <thead>
            <tr>
              <Cell head>Date</Cell>
              <Cell head>Flight</Cell>
              <Cell head>Route</Cell>
              <Cell head>Aircraft</Cell>
              <Cell head>Cabin</Cell>
              <Cell head num>
                Scheduled
              </Cell>
              <Cell head num>
                Focused
              </Cell>
              <Cell head num>
                Breaks
              </Cell>
              <Cell head>Status</Cell>
              <Cell head>Goal</Cell>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const s = STATUS_COPY[r.status];
              return (
                <tr key={r.id}>
                  <Cell className="numeral">{formatDate(r.departure, session.timeZone)}</Cell>
                  <Cell>
                    <span className="code">{r.flightNumber}</span>
                  </Cell>
                  <Cell>
                    <span className="code hist-route">
                      {r.origin}
                      <span className="hist-route-sep" aria-hidden="true" />
                      <span className="visually-hidden"> to </span>
                      {r.destination}
                    </span>
                  </Cell>
                  <Cell>{r.aircraft}</Cell>
                  <Cell>{r.cabin ? cabinLabel(r.cabin) : "—"}</Cell>
                  <Cell num>{formatDuration(r.scheduledBlockMs)}</Cell>
                  <Cell num>{formatDuration(r.creditedFocusMs)}</Cell>
                  <Cell num>{r.breakMs === null ? "—" : formatDuration(r.breakMs)}</Cell>
                  <Cell>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </Cell>
                  <Cell>
                    <span title={r.studyGoal ?? undefined}>{goalWord(r)}</span>
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </Board>
      )}
    </Page>
  );
}
