import { levelFor, type LevelDef, type UserStats } from "@aerofocus/core";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { StatTiles } from "../components/StatTiles";
import { api, errorMessage } from "../lib/api";
import { apiExt } from "../lib/api-ext";
import { airportView } from "../lib/flights";
import { formatDate } from "../lib/format";
import { useSession } from "../lib/session";
import { Button, Facts, Notice, Section, Skeleton, useToast } from "../ui";

interface Data {
  stats: UserStats;
  level: LevelDef;
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
        return { stats: s.stats, level: p.level };
      }
      const stats = session.guest.stats(session.timeZone);
      return { stats, level: levelFor({ creditedFocusMs: stats.creditedFocusMs, completedFlights: stats.completedFlights, countries: stats.countriesCollected, specialAchievements: 0 }) };
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

  const home = session.homeAirport ? airportView(session.homeAirport) : null;
  const title = session.mode === "user" ? session.user?.displayName || session.user?.email || "Passenger" : "Guest passenger";

  const facts: { label: string; value: string }[] = [];
  if (session.mode === "user" && session.user) facts.push({ label: "Email", value: session.user.email });
  facts.push({ label: "Level", value: data ? data.level.name : "—" });
  facts.push({ label: "Home airport", value: home ? `${home.city} (${home.iata})` : "Not set" });
  // "Member since" is not part of UserView (src/lib/api-ext.ts); omitted until the API exposes it.

  return (
    <Page
      title={title}
      aside={
        session.mode === "user" ? (
          <Button variant="secondary" onClick={() => void signOut()} busy={leaving}>
            Sign out
          </Button>
        ) : (
          <Button variant="primary" to="/account/sign-in">
            Create account
          </Button>
        )
      }
    >
      {session.mode === "guest" && (
        <Notice tone="amber">
          <span>
            Your flights live on this device until {formatDate(session.guest.expiresAt(), session.timeZone)}. Create an account to keep them. <Link to="/account/sign-in">Sign in or create account</Link>
          </span>
        </Notice>
      )}
      <Facts items={facts} />
      <Section title="Statistics" aside={<Link to="/account/settings">Settings</Link>}>
        {error && <Notice tone="danger">{error}</Notice>}
        {!data && !error && <Skeleton lines={5} />}
        {data && <StatTiles stats={data.stats} />}
        <p className="small muted">Flying hours and distance are simulated. Nothing here is physical travel.</p>
      </Section>
    </Page>
  );
}
