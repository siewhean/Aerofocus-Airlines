import { isValidPassportColour, localDate, PASSPORT_COLOURS } from "@aerofocus/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "../app/Shell";
import { coverHex, PassportBook } from "../components/PassportBook";
import { errorMessage } from "../lib/api";
import { apiExt, type TravelMarkView } from "../lib/api-ext";
import { countryName, formatDate } from "../lib/format";
import { useSession, writeLocal } from "../lib/session";
import { Board, Cell, Empty, Facts, Field, Input, Notice, Section, Skeleton, useToast } from "../ui";
import "./Passport.css";

const GUEST_COVER_KEY = "aerofocus.passportColour";

const COLOUR_LABELS: Record<(typeof PASSPORT_COLOURS)[number], string> = {
  navy: "Navy",
  burgundy: "Burgundy",
  forest_green: "Forest green",
  black: "Black",
  brown: "Brown",
  white: "White",
};

function readGuestCover(): string {
  try {
    const v = localStorage.getItem(GUEST_COVER_KEY);
    return v && isValidPassportColour(v) ? v : "navy";
  } catch {
    return "navy";
  }
}

interface Data {
  cover: string;
  marks: TravelMarkView[];
}

export default function Passport() {
  const session = useSession();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<Data> => {
    if (session.mode === "user") {
      const res = await apiExt.passport();
      return { cover: res.cover, marks: res.marks };
    }
    // Guests: one virtual mark per completed flight on this device (FR-049), newest last.
    const history = session.guest.load().history.filter((r) => r.outcome === "complete");
    const marks: TravelMarkView[] = history.map((r, i) => ({
      id: `guest-${i}-${r.snapshotId}-${r.arrival}`,
      country: r.destinationCountry,
      airport: r.destination,
      airline: r.airline,
      aircraftType: r.aircraftType,
      arrivalDate: localDate(r.arrival, session.timeZone),
      createdAt: r.arrival,
    }));
    return { cover: readGuestCover(), marks };
  }, [session.mode, session.guest, session.timeZone]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    load()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [load, session.guestState]);

  const setCover = async (next: string) => {
    if (!isValidPassportColour(next) || !data) return;
    const previous = data.cover;
    // The cover is cosmetic: marks are untouched (AC-12).
    setData({ ...data, cover: next });
    if (session.mode === "guest") {
      writeLocal(GUEST_COVER_KEY, next);
      return;
    }
    setSaving(true);
    try {
      await session.updateSettings({ passportColour: next });
      toast.show("Saved", "signal");
    } catch (e) {
      setData((d) => (d ? { ...d, cover: previous } : d));
      toast.show(errorMessage(e), "danger");
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const list = [...data.marks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.arrivalDate.localeCompare(a.arrivalDate));
    if (!q) return list;
    return list.filter((m) => [m.country, countryName(m.country), m.airport, m.flightNumber ?? "", m.airline ?? ""].some((s) => s.toLowerCase().includes(q)));
  }, [data, query]);

  const countries = useMemo(() => new Set(data?.marks.map((m) => m.country) ?? []).size, [data]);
  const airports = useMemo(() => new Set(data?.marks.map((m) => m.airport) ?? []).size, [data]);

  const customValue = data?.cover.startsWith("custom:") ? data.cover.slice("custom:".length) : "#1f2b4d";

  return (
    <Page title="Passport" lead="Every validated flight adds a virtual arrival record. Cover colour is yours to choose.">
      {error && <Notice tone="danger">{error}</Notice>}
      {!data && !error && <Skeleton lines={4} />}
      {data && (
        <>
          <Section title="Cover colour" aside={saving ? "Saving" : undefined}>
            <div className="pp-colours" role="group" aria-label="Cover colour">
              {PASSPORT_COLOURS.map((c) => {
                const active = data.cover === c;
                return (
                  <button key={c} type="button" className={`pp-swatch ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => void setCover(c)} disabled={saving}>
                    <span className="pp-swatch-chip" style={{ background: coverHex(c) }} aria-hidden="true" />
                    <span>{COLOUR_LABELS[c]}</span>
                  </button>
                );
              })}
              <label className={`pp-swatch pp-swatch-custom ${data.cover.startsWith("custom:") ? "is-active" : ""}`}>
                <input type="color" value={customValue} onChange={(e) => void setCover(`custom:${e.target.value}`)} disabled={saving} aria-label="Custom colour" />
                <span className="pp-swatch-chip" style={{ background: customValue }} aria-hidden="true" />
                <span>Custom</span>
              </label>
            </div>
            <p className="small muted">Changing the cover never alters the marks you have earned.</p>
          </Section>

          <PassportBook cover={data.cover} marks={data.marks} timeZone={session.timeZone} />

          <Facts
            items={[
              { label: "Countries", value: countries },
              { label: "Airports visited", value: airports },
              { label: "Total marks", value: data.marks.length },
            ]}
          />

          <Section title="All marks">
            <Field label="Search marks" hint="Country, airport or flight number.">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Japan, NRT, SQ" className="pp-search" />}
            </Field>
            {data.marks.length === 0 ? (
              <Empty title="No marks yet">Complete and validate a flight to receive your first virtual arrival record.</Empty>
            ) : filtered.length === 0 ? (
              <Empty title="No marks match">Try a country name, an airport code or a flight number.</Empty>
            ) : (
              <Board caption="Travel marks">
                <thead>
                  <tr>
                    <Cell head>Date</Cell>
                    <Cell head>Country</Cell>
                    <Cell head>Airport</Cell>
                    <Cell head>Flight</Cell>
                    <Cell head>Airline</Cell>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr key={m.id}>
                      <Cell className="numeral">{markDate(m.arrivalDate)}</Cell>
                      <Cell>{countryName(m.country)}</Cell>
                      <Cell>
                        <span className="code">{m.airport}</span>
                      </Cell>
                      <Cell>{m.flightNumber ?? "—"}</Cell>
                      <Cell>{m.airline ?? "—"}</Cell>
                    </tr>
                  ))}
                </tbody>
              </Board>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}

function markDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return formatDate(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12), "UTC");
}
