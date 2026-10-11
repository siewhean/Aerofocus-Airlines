import { LEVELS, levelFor, nextLevelProgress, type LevelDef, type LevelRequirement, type NextLevelProgress, type ProgressStats } from "@aerofocus/core";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Page } from "../app/Shell";
import { errorMessage } from "../lib/api";
import { apiExt, type AchievementView } from "../lib/api-ext";
import { cabinLabel, formatDate } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Board, Cell, Notice, Section, Skeleton } from "../ui";
import "./Rewards.css";

const CATEGORY_LABELS: Record<string, string> = {
  milestone: "Milestones",
  collection: "Collection",
  route: "Routes",
  consistency: "Consistency",
  community: "Community",
  journey: "Journeys",
};
const CATEGORY_ORDER = ["milestone", "collection", "route", "consistency", "community", "journey"];

function requirementSentence(req: LevelRequirement): string {
  const parts: string[] = [];
  if (req.focusHours) parts.push(`${req.focusHours} focus ${req.focusHours === 1 ? "hour" : "hours"}`);
  if (req.flights) parts.push(`${req.flights} ${req.flights === 1 ? "flight" : "flights"}`);
  if (req.countries) parts.push(`${req.countries} ${req.countries === 1 ? "country" : "countries"}`);
  if (req.specialAchievements) parts.push(`${req.specialAchievements} special ${req.specialAchievements === 1 ? "achievement" : "achievements"}`);
  return parts.length ? parts.join(" and ") : "Everyone starts here";
}

function unlockSentence(level: LevelDef, index: number): string {
  const parts: string[] = [];
  if (level.unlocksCabin) parts.push(`${cabinLabel(level.unlocksCabin)} cabin`);
  if (index === 0) parts.push("budget airlines");
  else if (level.airlineTier > LEVELS[index - 1]!.airlineTier) parts.push(`airline group ${level.airlineTier}`);
  return parts.length ? `Unlocks ${parts.join(" and ")}` : "No new unlocks";
}

function missingSentence(next: NextLevelProgress): string {
  const m = next.missing;
  const parts: string[] = [];
  if (m.focusHours > 0) parts.push(`${Math.ceil(m.focusHours * 10) / 10} more focus hours`);
  if (m.flights > 0) parts.push(`${m.flights} more ${m.flights === 1 ? "flight" : "flights"}`);
  if (m.countries > 0) parts.push(`${m.countries} more ${m.countries === 1 ? "country" : "countries"}`);
  if (m.specialAchievements > 0) parts.push(`${m.specialAchievements} more special ${m.specialAchievements === 1 ? "achievement" : "achievements"}`);
  return parts.length ? `Still needed: ${parts.join(", ")}.` : "Ready on your next completed flight.";
}

interface Data {
  stats: ProgressStats;
  level: LevelDef;
  next: NextLevelProgress | null;
  achievements: AchievementView[];
}

export default function Rewards() {
  const session = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      if (session.mode === "user") {
        const [prog, ach] = await Promise.all([apiExt.progression(), apiExt.achievements()]);
        return { stats: prog.stats, level: prog.level, next: prog.next, achievements: ach.achievements };
      }
      const s = session.guest.stats(session.timeZone);
      const stats: ProgressStats = { creditedFocusMs: s.creditedFocusMs, completedFlights: s.completedFlights, countries: s.countriesCollected, specialAchievements: 0 };
      const catalogue = await apiExt.achievementCatalogue();
      return { stats, level: levelFor(stats), next: nextLevelProgress(stats), achievements: catalogue.achievements.map((a) => ({ ...a, earnedAt: null })) };
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

  const groups = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, AchievementView[]>();
    for (const a of data.achievements) by.set(a.category, [...(by.get(a.category) ?? []), a]);
    const known = CATEGORY_ORDER.filter((c) => by.has(c));
    const extra = [...by.keys()].filter((c) => !CATEGORY_ORDER.includes(c));
    return [...known, ...extra].map((c) => ({ category: c, label: CATEGORY_LABELS[c] ?? c, items: by.get(c)! }));
  }, [data]);

  const earnedCount = data ? data.achievements.filter((a) => a.earnedAt).length : 0;

  return (
    <Page title="Achievements" lead="Levels unlock cabins and airline groups. Achievements mark the flights worth remembering.">
      {error && <Notice tone="danger">{error}</Notice>}
      {!data && !error && <Skeleton lines={5} />}
      {data && (
        <>
          <Section title="Level ladder" aside={`You are ${data.level.name}`}>
            <ol className="ladder">
              {LEVELS.map((level, i) => {
                const currentIndex = LEVELS.indexOf(data.level);
                const state = i < currentIndex ? "reached" : i === currentIndex ? "current" : i === currentIndex + 1 ? "next" : "ahead";
                return (
                  <li key={level.id} className={`ladder-step is-${state}`} aria-current={state === "current" ? "step" : undefined}>
                    <span className="ladder-dot" aria-hidden="true" />
                    <div className="ladder-text">
                      <div className="ladder-title">
                        <span className="ladder-name">{level.name}</span>
                        {state === "current" && <Badge tone="signal">Current</Badge>}
                        {state === "next" && <Badge tone="neutral">Next</Badge>}
                      </div>
                      <div className="small muted">{requirementSentence(level.requirement)}</div>
                      <div className="small">{unlockSentence(level, i)}</div>
                      {state === "next" && data.next && <div className="small ladder-missing">{missingSentence(data.next)}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>

          <Section title="Achievements" aside={session.mode === "user" ? `${earnedCount} of ${data.achievements.length} earned` : undefined}>
            {session.mode === "guest" && (
              <Notice>
                <span>
                  Create an account to earn achievements. <Link to="/account/sign-in">Create account</Link>
                </span>
              </Notice>
            )}
            {groups.map((g) => (
              <div key={g.category} className="ach-group">
                <h3>{g.label}</h3>
                <Board caption={`${g.label} achievements`}>
                  <thead>
                    <tr>
                      <Cell head>Achievement</Cell>
                      <Cell head>How to earn it</Cell>
                      <Cell head>Status</Cell>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((a) => {
                      const earned = Boolean(a.earnedAt);
                      return (
                        <tr key={a.id} className={earned ? "" : "is-locked"}>
                          <Cell>
                            <span className="ach-name">
                              {a.name}
                              {a.special && <Badge tone="premium">Special</Badge>}
                            </span>
                          </Cell>
                          <Cell>{a.description}</Cell>
                          <Cell>{earned && a.earnedAt ? <span className="numeral">Earned {formatDate(a.earnedAt, session.timeZone)}</span> : <span className="muted">Not yet</span>}</Cell>
                        </tr>
                      );
                    })}
                  </tbody>
                </Board>
              </div>
            ))}
          </Section>
        </>
      )}
    </Page>
  );
}
