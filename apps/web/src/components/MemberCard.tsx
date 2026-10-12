/**
 * The frequent-flyer card (docs/UI-PLAN.md Phase 9, item 1). One card object in fixed colours:
 * midnight base, a gold rule and gold type from Gold upward, a navy rule and ivory type below.
 * Credit-card proportions; the progress to the next level is a thin line along the bottom.
 */
import { LEVELS, type LevelDef, type NextLevelProgress } from "@aerofocus/core";
import { formatDate } from "../lib/format";
import { hashString } from "./Barcode";
import "./MemberCard.css";

export interface MemberCardProps {
  name: string;
  level: LevelDef;
  next: NextLevelProgress | null;
  memberNumber: string;
  since?: number | null;
  guest?: boolean;
  expiresAt?: number | null;
  timeZone: string;
}

const GOLD_TIERS = new Set<LevelDef["id"]>(["gold", "platinum", "global_voyager"]);

/** "AF 482 193 027": a stable nine-digit number derived from the account or device id. */
export function memberNumberFor(id: string): string {
  const digits = String(hashString(`member:${id}`) % 1_000_000_000).padStart(9, "0");
  return `AF ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/** "12 Oct 2026": a membership date needs its year. */
function formatDateWithYear(instant: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone }).format(instant);
  } catch {
    return formatDate(instant, timeZone);
  }
}

/** Fraction of the way to the next level on its limiting requirement, and the one-line label. */
function progressTo(next: NextLevelProgress | null, level: LevelDef): { fraction: number; label: string } {
  if (!next) return { fraction: 1, label: `${level.name} is the top tier` };
  const r = next.level.requirement;
  const m = next.missing;
  const dims: { fraction: number; label: string }[] = [];
  if (r.focusHours) {
    const h = Math.ceil(m.focusHours * 10) / 10;
    dims.push({ fraction: 1 - m.focusHours / r.focusHours, label: `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)} h to ${next.level.name}` });
  }
  if (r.flights) dims.push({ fraction: 1 - m.flights / r.flights, label: `${m.flights} ${m.flights === 1 ? "flight" : "flights"} to ${next.level.name}` });
  if (r.countries) dims.push({ fraction: 1 - m.countries / r.countries, label: `${m.countries} ${m.countries === 1 ? "country" : "countries"} to ${next.level.name}` });
  if (r.specialAchievements) {
    dims.push({ fraction: 1 - m.specialAchievements / r.specialAchievements, label: `${m.specialAchievements} special ${m.specialAchievements === 1 ? "achievement" : "achievements"} to ${next.level.name}` });
  }
  const limiting = dims.filter((d) => d.fraction < 1).sort((a, b) => a.fraction - b.fraction)[0];
  if (!limiting) return { fraction: 1, label: `${next.level.name} on your next completed flight` };
  return { fraction: Math.max(0, Math.min(1, limiting.fraction)), label: limiting.label };
}

export function MemberCard({ name, level, next, memberNumber, since = null, guest = false, expiresAt = null, timeZone }: MemberCardProps) {
  const gold = GOLD_TIERS.has(level.id);
  const progress = progressTo(next, level);
  // Levels from the API are plain JSON, so match by id rather than by reference.
  const tierIndex = LEVELS.findIndex((l) => l.id === level.id) + 1;
  const sinceLine = guest ? (expiresAt !== null ? `Guest pass, expires ${formatDate(expiresAt, timeZone)}` : "Guest pass") : since !== null ? `Member since ${formatDateWithYear(since, timeZone)}` : null;
  const label = `${guest ? "Guest pass" : "Frequent-flyer card"}, ${name}, ${level.name}, member number ${memberNumber}. ${progress.label}.`;

  return (
    <div className={`member-card ${gold ? "is-gold" : "is-navy"}`} role="img" aria-label={label}>
      <div className="member-card-top" aria-hidden="true">
        <span className="member-card-wordmark">Aerofocus Airlines</span>
        <span className="member-card-tier numeral">Tier {tierIndex} of {LEVELS.length}</span>
      </div>
      <div className="member-card-rule" aria-hidden="true" />
      <div className="member-card-body" aria-hidden="true">
        <span className="member-card-level display">{level.name}</span>
        <span className="member-card-name">{name}</span>
        <span className="member-card-number numeral">{memberNumber}</span>
        {sinceLine && <span className="member-card-since">{sinceLine}</span>}
      </div>
      <div className="member-card-progress" aria-hidden="true">
        <span className="member-card-progress-label">{progress.label}</span>
        <span className="member-card-progress-track">
          <span className="member-card-progress-fill" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
        </span>
      </div>
    </div>
  );
}
