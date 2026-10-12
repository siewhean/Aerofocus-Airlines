import { levelFor, nextLevelProgress, type LevelDef, type NextLevelProgress, type UserStats } from "@aerofocus/core";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { MemberCard, memberNumberFor } from "../components/MemberCard";
import { api, errorMessage } from "../lib/api";
import { apiExt } from "../lib/api-ext";
import { airportView } from "../lib/flights";
import { formatDate, formatDuration, formatHours, percent } from "../lib/format";
import { useSession } from "../lib/session";
import { Button, Notice, Skeleton, useToast } from "../ui";
import "./Profile.css";

interface Data {
  stats: UserStats;
  level: LevelDef;
  next: NextLevelProgress | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The flying record as one typeset sentence; only what has happened is mentioned. */
function recordSentence(s: UserStats): string {
  if (s.completedFlights === 0) return "No flights completed yet. Your record starts with the first one.";
  const parts = [`${formatHours(s.creditedFocusMs)} of focus across ${plural(s.completedFlights, "flight", "flights")}`];
  if (s.countriesCollected > 0) parts[0] += ` and ${plural(s.countriesCollected, "country", "countries")}`;
  if (s.longestCompletedFlightMs > 0) parts.push(`longest flight ${formatDuration(s.longestCompletedFlightMs)}`);
  if (s.currentStreakDays > 0) parts.push(`${s.currentStreakDays}-day streak`);
  return `${parts.join("; ")}.`;
}

export default function Profile() {
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async (): Promise<Data> => {
      if (session.mode === "user") {
        const [s, p] = await Promise.all([api.stats(), apiExt.progression()]);
        return { stats: s.stats, level: p.level, next: p.next };
      }
      const stats = session.guest.stats(session.timeZone);
      const progress = { creditedFocusMs: stats.creditedFocusMs, completedFlights: stats.completedFlights, countries: stats.countriesCollected, specialAchievements: 0 };
      return { stats, level: levelFor(progress), next: nextLevelProgress(progress) };
    })()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [session.mode, session.guest, session.timeZone, session.guestState]);

  const signOut = async () => {
    setLeaving(true);
    try {
      await session.signOut();
      toast.show("Signed out.", "neutral");
      navigate("/");
    } finally {
      setLeaving(false);
    }
  };

  const isUser = session.mode === "user";
  const home = session.homeAirport ? airportView(session.homeAirport) : null;
  const name = isUser ? session.user?.displayName || session.user?.email || "Passenger" : "Guest passenger";
  // The device id for guests is the anonymous presence id; it changes if guest data is cleared.
  const memberId = isUser ? session.user?.id ?? "" : session.guestState?.presenceId ?? "guest";
  // `createdAt` is returned by GET /v1/me (apps/api/src/services/users.ts:24) but not typed in UserView.
  const since = isUser ? ((session.user as { createdAt?: number } | null)?.createdAt ?? null) : null;

  const s = data?.stats;
  const rows: { label: string; value: string }[] = s
    ? [
        { label: "Focus hours", value: formatHours(s.creditedFocusMs) },
        { label: "Flights", value: String(s.completedFlights) },
        { label: "Countries", value: String(s.countriesCollected) },
        { label: "Airports", value: String(s.airportsVisited) },
        { label: "Simulated flying hours", value: formatHours(s.simulatedFlightMs) },
        { label: "Virtual distance", value: `${Math.round(s.virtualDistanceKm).toLocaleString()} km` },
        { label: "Longest flight", value: s.longestCompletedFlightMs > 0 ? formatDuration(s.longestCompletedFlightMs) : "None yet" },
        { label: "Streak", value: plural(s.currentStreakDays, "day", "days") },
        { label: "Completion rate", value: s.completionRate === null ? "No flights yet" : percent(s.completionRate) },
      ]
    : [];

  return (
    <Page title={name}>
      <div className="profile">
        {error && <Notice tone="danger">{error}</Notice>}
        {!data && !error && <Skeleton lines={6} />}
        {data && (
          <>
            <MemberCard
              name={name}
              level={data.level}
              next={data.next}
              memberNumber={memberNumberFor(memberId)}
              since={since}
              guest={!isUser}
              expiresAt={!isUser ? session.guest.expiresAt() : null}
              timeZone={session.timeZone}
            />

            <p className="profile-account small muted">
              {isUser ? `Signed in as ${session.user?.email}. ` : `Your flights live on this device until ${formatDate(session.guest.expiresAt(), session.timeZone)}. `}
              {home ? `Home airport ${home.city} (${home.iata}). ` : "No home airport set. "}
              <Link to="/account/settings">Settings</Link>
            </p>

            <section className="profile-record" aria-labelledby="profile-record-title">
              <h2 id="profile-record-title">Flying record</h2>
              <p className="profile-sentence">{recordSentence(data.stats)}</p>
              <dl className="profile-list">
                {rows.map((r) => (
                  <div key={r.label} className="profile-row">
                    <dt>{r.label}</dt>
                    <dd className="numeral">{r.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="small muted">Flying hours and distance are simulated. Nothing here is physical travel.</p>
            </section>

            <div className="profile-actions">
              {isUser ? (
                <Button variant="quiet" onClick={() => void signOut()} busy={leaving}>
                  Sign out
                </Button>
              ) : (
                <>
                  <Button variant="secondary" to="/account/sign-in">
                    Create an account
                  </Button>
                  <span className="small muted">Keeps your flights beyond this device.</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
