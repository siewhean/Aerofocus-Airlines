/**
 * Membership: the tiers page of the loyalty programme (docs/UI-PLAN.md Phase 9, item 2). The level
 * ladder is one column of tiers with the current tier marked by the gold rule; achievements are
 * small stamp-like marks, inked when earned and outlined when not, grouped under plain headings.
 */
import { LEVELS, levelFor, nextLevelProgress, type LevelDef, type LevelRequirement, type NextLevelProgress, type ProgressStats } from "@aerofocus/core";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { Page } from "../app/Shell";
import { hashString } from "../components/Barcode";
import { errorMessage } from "../lib/api";
import { apiExt, type AchievementView, type AirlineView } from "../lib/api-ext";
import { cabinLabel, formatDate } from "../lib/format";
import { useSession } from "../lib/session";
import { Notice, Skeleton } from "../ui";
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
const AIRLINES_SHOWN = 4;

function requirementSentence(req: LevelRequirement): string {
  const parts: string[] = [];
  if (req.focusHours) parts.push(`${req.focusHours} focus ${req.focusHours === 1 ? "hour" : "hours"}`);
  if (req.flights) parts.push(`${req.flights} ${req.flights === 1 ? "flight" : "flights"}`);
  if (req.countries) parts.push(`${req.countries} ${req.countries === 1 ? "country" : "countries"}`);
  if (req.specialAchievements) parts.push(`${req.specialAchievements} special ${req.specialAchievements === 1 ? "achievement" : "achievements"}`);
  return parts.length ? `Requires ${parts.join(" and ")}.` : "Everyone starts here.";
}

/** "Opens: Premium Economy and Scoot, AirAsia, VietJet Air, IndiGo and 3 more." */
function opensSentence(level: LevelDef, airlines: AirlineView[] | null): string {
  const parts: string[] = [];
  if (level.unlocksCabin) parts.push(cabinLabel(level.unlocksCabin));
  if (airlines === null) {
    parts.push(`airline group ${level.airlineTier}`);
  } else {
    const names = airlines.filter((a) => a.tier === level.airlineTier).map((a) => a.name);
    if (names.length > 0) {
      const shown = names.slice(0, AIRLINES_SHOWN);
      const rest = names.length - shown.length;
      parts.push(rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0]!);
    }
  }
  return parts.length ? `Opens: ${parts.join(" and ")}.` : "Opens nothing new.";
}

function missingSentence(next: NextLevelProgress): string {
  const m = next.missing;
  const parts: string[] = [];
  if (m.focusHours > 0) parts.push(`${Math.ceil(m.focusHours * 10) / 10} more focus hours`);
  if (m.flights > 0) parts.push(`${m.flights} more ${m.flights === 1 ? "flight" : "flights"}`);
  if (m.countries > 0) parts.push(`${m.countries} more ${m.countries === 1 ? "country" : "countries"}`);
  if (m.specialAchievements > 0) parts.push(`${m.specialAchievements} more special ${m.specialAchievements === 1 ? "achievement" : "achievements"}`);
  return parts.length ? `Still needed: ${parts.join(", ")}.` : "Reached on your next completed flight.";
}

/** Two or three letters for the mark: initials of the name, or the first letters of a single word. */
function markInitials(name: string): string {
  const words = name.replace(/-/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join("");
  return name.slice(0, 2).toUpperCase();
}

/**
 * A lighter sibling of the passport stamp's ink look (components/Stamp.tsx): a double ring, the
 * initials, and for earned marks the same worn-edge displacement in the premium ink.
 */
function AchievementMark({ name, earned, special }: { name: string; earned: boolean; special: boolean }) {
  const rawId = useId();
  const uid = `am${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const h = hashString(`mark:${name}`);
  const rotation = (h % 1101) / 100 - 5.5;
  const seed = h % 1000;
  const initials = markInitials(name);
  const fontSize = initials.length >= 3 ? 20 : 24;
  const ink = earned ? "var(--premium)" : "var(--line)";
  const text = earned ? "var(--premium)" : "var(--text-3)";
  return (
    <svg className={`ach-mark ${earned ? "is-earned" : ""}`} width={64} height={64} viewBox="0 0 64 64" aria-hidden="true" style={{ transform: `rotate(${rotation.toFixed(2)}deg)` }} overflow="visible">
      {earned && (
        <defs>
          <filter id={`${uid}-worn`} x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} result="edge" />
            <feDisplacementMap in="SourceGraphic" in2="edge" scale={1.2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      )}
      <g filter={earned ? `url(#${uid}-worn)` : undefined} opacity={earned ? 0.92 : 1}>
        <circle cx={32} cy={32} r={29.5} fill="none" stroke={ink} strokeWidth={earned ? 2.2 : 1.4} />
        <circle cx={32} cy={32} r={24.5} fill="none" stroke={ink} strokeWidth={0.9} />
        {special && <circle cx={32} cy={32} r={27} fill="none" stroke={ink} strokeWidth={0.6} strokeDasharray="1.5 2.5" />}
        <text x={32} y={32} dy="0.36em" textAnchor="middle" fontFamily="var(--font)" fontWeight={700} fontSize={fontSize} letterSpacing={0.5} fill={text} style={{ fontStretch: "85%" }}>
          {initials}
        </text>
      </g>
    </svg>
  );
}

interface Data {
  stats: ProgressStats;
  level: LevelDef;
  next: NextLevelProgress | null;
  achievements: AchievementView[];
  airlines: AirlineView[] | null;
}

export default function Rewards() {
  const session = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async (): Promise<Data> => {
      // The airline list only decorates the ladder; a failure there must not hide the page.
      const airlines = apiExt
        .airlines()
        .then((r) => r.airlines)
        .catch(() => null);
      if (session.mode === "user") {
        const [prog, ach, al] = await Promise.all([apiExt.progression(), apiExt.achievements(), airlines]);
        return { stats: prog.stats, level: prog.level, next: prog.next, achievements: ach.achievements, airlines: al };
      }
      const s = session.guest.stats(session.timeZone);
      const stats: ProgressStats = { creditedFocusMs: s.creditedFocusMs, completedFlights: s.completedFlights, countries: s.countriesCollected, specialAchievements: 0 };
      const [catalogue, al] = await Promise.all([apiExt.achievementCatalogue(), airlines]);
      return { stats, level: levelFor(stats), next: nextLevelProgress(stats), achievements: catalogue.achievements.map((a) => ({ ...a, earnedAt: null })), airlines: al };
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
  // Levels from the API are plain JSON, so match by id rather than by reference.
  const currentIndex = data ? LEVELS.findIndex((l) => l.id === data.level.id) : -1;

  return (
    <Page title="Membership" lead="Seven tiers, each opening a cabin or a group of airlines. Achievements mark the flights worth remembering.">
      {error && <Notice tone="danger">{error}</Notice>}
      {!data && !error && <Skeleton lines={6} />}
      {data && (
        <div className="membership">
          <section className="tiers" aria-labelledby="tiers-title">
            <h2 id="tiers-title">Tiers</h2>
            <ol className="tier-list">
              {LEVELS.map((level, i) => {
                const state = i < currentIndex ? "reached" : i === currentIndex ? "current" : i === currentIndex + 1 ? "next" : "ahead";
                return (
                  <li key={level.id} className={`tier is-${state}`} aria-current={state === "current" ? "true" : undefined}>
                    <div className="tier-head">
                      <h3 className="tier-name">{level.name}</h3>
                      {state === "current" && <span className="tier-yours">Your tier</span>}
                      {state === "reached" && <span className="tier-reached small muted">Reached</span>}
                    </div>
                    <p className="tier-line">{requirementSentence(level.requirement)}</p>
                    <p className="tier-line">{opensSentence(level, data.airlines)}</p>
                    {state === "next" && data.next && <p className="tier-line tier-missing">{missingSentence(data.next)}</p>}
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="achievements" aria-labelledby="ach-title">
            <div className="ach-head">
              <h2 id="ach-title">Achievements</h2>
              {session.mode === "user" && (
                <span className="small muted numeral">
                  {earnedCount} of {data.achievements.length} earned
                </span>
              )}
            </div>
            {session.mode === "guest" && (
              <p className="small muted">
                Achievements are recorded on an account. <Link to="/account/sign-in">Create one</Link> to start earning them.
              </p>
            )}
            {groups.map((g) => (
              <div key={g.category} className="ach-group">
                <h3>{g.label}</h3>
                <ul className="ach-list">
                  {g.items.map((a) => {
                    const earned = Boolean(a.earnedAt);
                    return (
                      <li key={a.id} className={`ach ${earned ? "is-earned" : "is-outlined"}`}>
                        <AchievementMark name={a.name} earned={earned} special={a.special} />
                        <div className="ach-text">
                          <span className="ach-name">{a.name}</span>
                          <span className="ach-desc small">{a.description}</span>
                          <span className="ach-when small">{earned && a.earnedAt ? <span className="numeral">Earned {formatDate(a.earnedAt, session.timeZone)}</span> : a.special ? "Not yet; counts as special" : "Not yet"}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </Page>
  );
}
